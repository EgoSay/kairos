#!/usr/bin/env python3
"""Explicit, recoverable SQLite ledger reset during an authorized Kairos repair.

Prepare pauses both the old worker and the repaired worker. Finalize requires a
stopped, source-identified repaired container; no server process may write between
the reset and the next start. This is not a migration or a recurring maintenance job.
"""

import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import re
import sqlite3
import subprocess
import time


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def document(db, owner, kind):
    row = db.execute(
        "SELECT payload,version FROM journal_document WHERE owner_id=? AND kind=? AND document_key='main'",
        (owner, kind),
    ).fetchone()
    return (json.loads(row[0]), row[1]) if row else ({}, 0)


def put_document(db, owner, kind, payload, version):
    db.execute(
        "INSERT INTO journal_document VALUES(?,?,'main',?,?,?) "
        "ON CONFLICT(owner_id,kind,document_key) DO UPDATE SET payload=excluded.payload,version=excluded.version,updated_ts=excluded.updated_ts",
        (owner, kind, json.dumps(payload, separators=(",", ":")), version + 1, int(time.time())),
    )


def targets(db, account):
    value = db.execute("SELECT value FROM system_setting WHERE name='AI'").fetchone()
    providers = json.loads(value[0]).get("providers", []) if value else []
    endpoints = {
        p["id"]: p["endpoint"] for p in providers
        if re.fullmatch(r"https://api\.cloudflare\.com/client/v4/accounts/" + re.escape(account) + r"/ai/v1/?", p.get("endpoint", ""))
    }
    result = []
    for owner, payload, version in db.execute("SELECT owner_id,payload,version FROM journal_document WHERE kind='wander-config' AND document_key='main'"):
        config = json.loads(payload)
        if config.get("providerId") in endpoints:
            result.append((owner, config, version, digest(endpoints[config["providerId"]])))
    if not result:
        raise RuntimeError("no configured owner matches the requested Cloudflare account")
    return sorted(result)


def preserve_jobs_config(db, owner, config, version):
    # The normal setting trigger intentionally invalidates all jobs. An operator
    # pause/resume must preserve them in the same transaction while advancing the
    # epoch/config version, which fences already running inference.
    rows = db.execute(
        "SELECT dirty,lease_until,lease_token,attempts,next_attempt_ts,memo_id,revision FROM record_graph_source WHERE owner_id=?", (owner,)
    ).fetchall()
    put_document(db, owner, "wander-config", config, version)
    db.executemany(
        "UPDATE record_graph_source SET dirty=?,lease_until=?,lease_token=?,attempts=?,next_attempt_ts=? WHERE memo_id=? AND revision=?", rows
    )


def fingerprints(db):
    result = {}
    queries = {
        "originals": "SELECT * FROM memo ORDER BY id",
        "representations": "SELECT memo_id,owner_id,revision,processed_revision,profile,representation FROM record_graph_source ORDER BY memo_id",
        "edges": "SELECT * FROM record_graph_edge ORDER BY owner_id,a,b",
    }
    for name, query in queries.items():
        h = hashlib.sha256()
        count = 0
        for row in db.execute(query):
            h.update(json.dumps(tuple(row), ensure_ascii=False, default=str).encode())
            h.update(b"\n")
            count += 1
        result[name] = {"count": count, "sha256": h.hexdigest()}
    return result


def backup(db, directory, phase):
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    if directory.stat().st_mode & 0o077:
        raise RuntimeError("backup directory must be private (mode 0700)")
    path = directory / (phase + ".sqlite")
    # Never overwrite an earlier backup, including after an interrupted operation.
    if path.exists():
        raise RuntimeError("backup already exists; inspect the operation before retrying")
    fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    os.close(fd)
    with sqlite3.connect(path) as destination:
        db.backup(destination)
        if destination.execute("PRAGMA quick_check").fetchone()[0] != "ok":
            raise RuntimeError("backup integrity check failed")
    return str(path)


def attest_runtime(container, commit, directory):
    value = json.loads(subprocess.check_output(["docker", "inspect", container]))[0]
    if not value["State"]["Running"] or value["State"].get("Health", {}).get("Status") != "healthy":
        raise RuntimeError("verify a healthy repaired container before stopping it")
    profile = json.loads(subprocess.check_output(["docker", "exec", container, "wget", "-q", "-O", "-", "http://127.0.0.1:5230/api/v1/instance/profile"]))
    if profile.get("commit") != commit:
        raise RuntimeError("running source identity does not match the reviewed repair commit")
    again = json.loads(subprocess.check_output(["docker", "inspect", container]))[0]
    if (again["Id"], again["Image"]) != (value["Id"], value["Image"]):
        raise RuntimeError("container changed during source verification")
    result = {"container": value["Id"], "image": value["Image"], "commit": commit, "version": profile.get("version"), "observedAt": int(time.time())}
    path = directory / "verified-runtime.json"
    if path.exists():
        previous = json.loads(path.read_text())
        if any(previous.get(key) != result[key] for key in ("container", "image", "commit")):
            raise RuntimeError("an attestation for a different container exists; inspect it before replacement")
        return previous
    with path.open("x", encoding="utf-8") as output:
        json.dump(result, output)
    path.chmod(0o600)
    return result


def inspect_stopped(container, commit, directory):
    value = json.loads(subprocess.check_output(["docker", "inspect", container]))[0]
    if value["State"]["Running"] or value["State"].get("Restarting"):
        raise RuntimeError("stop the repaired application container before finalizing")
    # Production images do not carry revision labels. Bind the stopped container
    # to its previously verified live profile by immutable container and image ID.
    verified = json.loads((directory / "verified-runtime.json").read_text())
    if (verified["container"], verified["image"], verified["commit"]) != (value["Id"], value["Image"], commit):
        raise RuntimeError("container source identity does not match the reviewed repair commit")
    return {"container": value["Id"], "image": value["Image"], "commit": commit}


def prepare(db, account, operation, directory):
    current = targets(db, account)
    existing = [document(db, owner, "wander-maintenance")[0] for owner, *_ in current]
    if all(m.get("operationId") == operation and m.get("resetState") in ("paused", "complete") for m in existing):
        return {"state": "already-prepared", "operationId": operation}
    if any(m.get("paused") for m in existing):
        raise RuntimeError("another maintenance pause exists")
    saved = backup(db, directory, "before-pause")
    db.execute("BEGIN IMMEDIATE")
    try:
        before = fingerprints(db)
        current = targets(db, account)
        owners = [owner for owner, *_ in current]
        for owner, config, version, key in current:
            maintenance, mv = document(db, owner, "wander-maintenance")
            if maintenance.get("paused"):
                raise RuntimeError("maintenance changed while preparing")
            maintenance.update({"paused": True, "operationId": operation, "resetState": "paused", "accountKey": key,
                                "owners": owners, "previousEnabled": bool(config.get("enabled")), "pausedConfigVersion": version + 1,
                                "pausedAt": int(time.time()), "backup": saved})
            put_document(db, owner, "wander-maintenance", maintenance, mv)
            preserve_jobs_config(db, owner, {**config, "enabled": False}, version)
        if fingerprints(db) != before:
            raise RuntimeError("original or prepared graph changed during pause")
        db.commit()
        return {"state": "paused", "operationId": operation, "owners": owners, "backup": saved, "preserved": before}
    except BaseException:
        db.rollback()
        raise


def finalize(db, account, operation, directory, container, commit, provider_neurons=None, provider_observed_at=None, approximate=False):
    current = targets(db, account)
    states = [document(db, owner, "wander-maintenance")[0] for owner, *_ in current]
    if all(m.get("operationId") == operation and m.get("resetState") == "complete" for m in states):
        return {"state": "already-complete", "operationId": operation}
    identity = inspect_stopped(container, commit, directory)
    columns = {r[1] for r in db.execute("PRAGMA table_info(record_graph_source)")}
    if "status_version" not in columns:
        raise RuntimeError("the repaired schema has not been installed")
    if (provider_neurons is None) != (provider_observed_at is None):
        raise RuntimeError("provider baseline requires both usage and observation time")
    baseline = {"resetAt": int(time.time())}
    if provider_neurons is not None:
        if not math.isfinite(provider_neurons) or not 0 <= provider_neurons or not 0 < provider_observed_at <= time.time():
            raise RuntimeError("invalid provider observation")
        baseline.update(providerNeurons=provider_neurons, providerObservedAt=provider_observed_at, providerApproximate=approximate)
    saved = backup(db, directory, "before-reset")
    db.execute("BEGIN IMMEDIATE")
    try:
        current = targets(db, account)
        owners = [owner for owner, *_ in current]
        before = fingerprints(db)
        keys = set()
        for owner, config, version, key in current:
            maintenance, mv = document(db, owner, "wander-maintenance")
            if (maintenance.get("operationId") != operation or maintenance.get("resetState") != "paused"
                    or not maintenance.get("paused") or config.get("enabled")
                    or maintenance.get("pausedConfigVersion") != version or maintenance.get("accountKey") != key
                    or maintenance.get("owners") != owners):
                raise RuntimeError("pause/configuration changed; refusing to overwrite current intent")
            keys.add(key)
            preserve_jobs_config(db, owner, {**config, "enabled": maintenance["previousEnabled"]}, version)
            # No worker is alive. Release its leases and only application-budget
            # waits, preserving real provider-quota and network circuit cooldowns.
            db.execute("UPDATE record_graph_source SET lease_until=0,lease_token='' WHERE owner_id=?", (owner,))
            db.execute("UPDATE record_graph_source SET state='pending',error_code='',next_attempt_ts=0,status_version=status_version+1 "
                       "WHERE owner_id=? AND dirty=1 AND state='quota-paused' AND error_code IN ('daily-budget','quota')", (owner,))
            maintenance.update(paused=False, resetState="complete", baseline=baseline, resetBackup=saved)
            put_document(db, owner, "wander-maintenance", maintenance, mv)
        cleared = {"budgetRows": 0, "callRows": 0}
        for key in keys:
            cleared["callRows"] += db.execute("DELETE FROM record_graph_call WHERE account_key=?", (key,)).rowcount
            cleared["budgetRows"] += db.execute("DELETE FROM record_graph_budget WHERE account_key=?", (key,)).rowcount
        if fingerprints(db) != before:
            raise RuntimeError("original or prepared graph changed during reset")
        db.commit()
        return {"state": "complete", "operationId": operation, "baseline": baseline, "backup": saved,
                "cleared": cleared, "preserved": before, "runtime": identity}
    except BaseException:
        db.rollback()
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("prepare", "attest", "finalize"))
    parser.add_argument("--db", required=True, type=Path)
    parser.add_argument("--account", required=True)
    parser.add_argument("--operation", required=True)
    parser.add_argument("--backup-dir", required=True, type=Path)
    parser.add_argument("--container")
    parser.add_argument("--commit")
    parser.add_argument("--provider-neurons", type=float)
    parser.add_argument("--provider-observed-at", type=int)
    parser.add_argument("--provider-approximate", action="store_true")
    args = parser.parse_args()
    if not re.fullmatch(r"[a-f0-9]{32}", args.account) or not re.fullmatch(r"[a-z0-9-]{6,80}", args.operation):
        parser.error("invalid account or operation ID")
    if args.action in ("attest", "finalize") and (not args.container or not re.fullmatch(r"[a-f0-9]{40}", args.commit or "")):
        parser.error("attest/finalize requires a container and reviewed source commit")
    os.umask(0o077)
    with sqlite3.connect(args.db.resolve().as_uri() + "?mode=rw", uri=True, timeout=30, isolation_level=None) as db:
        if args.action == "prepare":
            result = prepare(db, args.account, args.operation, args.backup_dir)
        elif args.action == "attest":
            result = attest_runtime(args.container, args.commit, args.backup_dir)
        else:
            result = finalize(db, args.account, args.operation, args.backup_dir, args.container, args.commit,
                              args.provider_neurons, args.provider_observed_at, args.provider_approximate)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
