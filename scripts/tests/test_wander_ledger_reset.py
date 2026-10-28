"""Exercise the operator reset against the real SQLite schema with fictional data."""

import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import wander_ledger_reset as reset


class LedgerResetTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name) / "operation"
        self.db = sqlite3.connect(Path(self.temp.name) / "fixture.db", isolation_level=None)
        self.addCleanup(self.db.close)
        self.db.executescript((Path(__file__).parents[2] / "store/migration/sqlite/LATEST.sql").read_text())
        self.account = "a" * 32
        self.endpoint = "https://api.cloudflare.com/client/v4/accounts/" + self.account + "/ai/v1"
        self.key = reset.digest(self.endpoint)
        self.operation = "fictional-reset-test"
        self.db.execute("INSERT INTO user(id,username,role,password_hash) VALUES(1,'fictional','ADMIN','synthetic-disabled-password')")
        self.db.execute("INSERT INTO system_setting(name,value) VALUES('AI',?)", (json.dumps({"providers": [{"id": "cf", "endpoint": self.endpoint, "apiKey": "synthetic"}]}),))
        reset.put_document(self.db, 1, "wander-config", {"enabled": True, "providerId": "cf", "dailyNeurons": 8000, "freePlanConfirmed": True}, 0)
        self.db.execute("INSERT INTO memo(id,uid,creator_id,content) VALUES(1,'one',1,'fictional original'),(2,'two',1,'another fictional original')")
        self.db.execute("UPDATE record_graph_source SET state='ready',dirty=0,processed_revision=revision,representation='{\"validated\":true}' WHERE memo_id=1")
        self.db.execute("UPDATE record_graph_source SET state='quota-paused',error_code='daily-budget',next_attempt_ts=253402300799 WHERE memo_id=2")
        self.db.execute("INSERT INTO record_graph_budget VALUES(?,'2026-10-28',7992000000)", (self.key,))
        self.db.execute("INSERT INTO record_graph_budget VALUES('other-account','2026-10-28',123)")
        self.db.execute("INSERT INTO record_graph_runtime VALUES('provider-quota',0,0,253402300799,'cloudflare-daily-quota')")
        self.before = reset.fingerprints(self.db)

    def prepare(self):
        return reset.prepare(self.db, self.account, self.operation, self.directory)

    def finalize(self):
        with patch.object(reset, "inspect_stopped", return_value={"commit": "b" * 40}):
            return reset.finalize(self.db, self.account, self.operation, self.directory, "fictional-container", "b" * 40)

    def test_preserves_originals_ready_jobs_and_provider_quota(self):
        result = self.prepare()
        self.assertEqual(result["state"], "paused")
        self.assertEqual(reset.fingerprints(self.db), self.before)
        self.assertFalse(reset.document(self.db, 1, "wander-config")[0]["enabled"])
        self.assertEqual(self.db.execute("SELECT dirty FROM record_graph_source WHERE memo_id=1").fetchone()[0], 0)
        self.assertEqual(self.prepare()["state"], "already-prepared")
        result = self.finalize()
        self.assertEqual(result["cleared"], {"budgetRows": 1, "callRows": 0})
        self.assertEqual(reset.fingerprints(self.db), self.before)
        self.assertTrue(reset.document(self.db, 1, "wander-config")[0]["enabled"])
        self.assertEqual(self.db.execute("SELECT dirty FROM record_graph_source WHERE memo_id=1").fetchone()[0], 0)
        self.assertEqual(self.db.execute("SELECT state,next_attempt_ts FROM record_graph_source WHERE memo_id=2").fetchone(), ("pending", 0))
        self.assertEqual(self.db.execute("SELECT reserved FROM record_graph_budget WHERE account_key='other-account'").fetchone()[0], 123)
        self.assertEqual(self.db.execute("SELECT blocked_until FROM record_graph_runtime WHERE connection_key='provider-quota'").fetchone()[0], 253402300799)
        self.assertEqual(self.finalize()["state"], "already-complete")
        with sqlite3.connect(self.directory / "before-reset.sqlite") as old:
            self.assertEqual(old.execute("SELECT reserved FROM record_graph_budget WHERE account_key=?", (self.key,)).fetchone()[0], 7992000000)
        self.assertEqual((self.directory / "before-reset.sqlite").stat().st_mode & 0o777, 0o600)

    def test_concurrent_setting_change_refuses_reset_and_preserves_ledger(self):
        self.prepare()
        config, version = reset.document(self.db, 1, "wander-config")
        reset.put_document(self.db, 1, "wander-config", {**config, "dailyNeurons": 7000}, version)
        with self.assertRaisesRegex(RuntimeError, "configuration changed"):
            self.finalize()
        self.assertEqual(self.db.execute("SELECT reserved FROM record_graph_budget WHERE account_key=?", (self.key,)).fetchone()[0], 7992000000)
        self.assertTrue(reset.document(self.db, 1, "wander-maintenance")[0]["paused"])
        self.assertEqual(reset.document(self.db, 1, "wander-config")[0]["dailyNeurons"], 7000)

    def test_running_or_wrong_container_cannot_reset(self):
        self.prepare()
        (self.directory / "verified-runtime.json").write_text(json.dumps({"container": "expected", "image": "expected-image", "commit": "b" * 40}))
        for state, labels in [(True, {"org.opencontainers.image.revision": "b" * 40}), (False, {})]:
            with self.subTest(running=state), patch.object(reset.subprocess, "check_output", return_value=json.dumps([
                {"Id": "different", "Image": "different-image", "State": {"Running": state}, "Config": {"Labels": labels}}
            ]).encode()):
                with self.assertRaises(RuntimeError):
                    reset.finalize(self.db, self.account, self.operation, self.directory, "fictional", "b" * 40)
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM record_graph_budget").fetchone()[0], 2)

    def test_attestation_binds_live_source_to_stopped_image(self):
        self.prepare()
        container = {"Id": "expected", "Image": "expected-image", "State": {"Running": True, "Health": {"Status": "healthy"}}}
        profile = {"commit": "b" * 40, "version": "1.8.1"}
        with patch.object(reset.subprocess, "check_output", side_effect=[json.dumps([container]).encode(), json.dumps(profile).encode(), json.dumps([container]).encode()]):
            result = reset.attest_runtime("fixture", "b" * 40, self.directory)
        self.assertEqual(result["commit"], "b" * 40)
        container["State"]["Running"] = False
        with patch.object(reset.subprocess, "check_output", return_value=json.dumps([container]).encode()):
            self.assertEqual(reset.inspect_stopped("fixture", "b" * 40, self.directory)["image"], "expected-image")


if __name__ == "__main__":
    unittest.main()
