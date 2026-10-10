#!/usr/bin/env python3
"""Run a serialized, verified journal snapshot into an encrypted restic repository.

The private JSON configuration supplies source, logicalRoot, workDir, repository,
passwordFile and credentials (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY). Keep it
outside Git with mode 0600. Initialize the repository explicitly before enabling
the systemd timer. No incomplete snapshot advances last-success.json. Receipt
delivery is tracked separately: a monitoring outage does not undo a valid backup.
"""
from __future__ import annotations

import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time
import urllib.request
import uuid

from journal_snapshot import snapshot, verify


def atomic_json(path: Path, value: dict) -> None:
    fd, name = tempfile.mkstemp(prefix=".receipt-", dir=path.parent)
    try:
        with os.fdopen(fd, "w") as stream:
            json.dump(value, stream, ensure_ascii=False)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, path)
    finally:
        Path(name).unlink(missing_ok=True)


def restic(config: dict, *arguments: str, cwd: Path | None = None) -> str:
    environment = dict(os.environ, **config.get("credentials", {}),
                       RESTIC_REPOSITORY=config["repository"],
                       RESTIC_PASSWORD_FILE=config["passwordFile"],
                       RESTIC_CACHE_DIR=str(Path(config["workDir"]) / "cache"),
                       GOMEMLIMIT="256MiB")
    process = subprocess.run([config.get("restic", "restic"), *arguments],
                             env=environment, cwd=cwd, capture_output=True, text=True, timeout=900)
    if process.returncode:
        # Some read errors still create an incomplete restic snapshot (exit 3).
        # Never echo raw tool output: configuration and paths can be private.
        raise RuntimeError("restic failed with exit " + str(process.returncode))
    return process.stdout


def remember(work: Path, receipt: dict) -> None:
    history = work / "history"
    history.mkdir(mode=0o700, exist_ok=True)
    atomic_json(history / (str(int(time.time() * 1000)) + "-" + uuid.uuid4().hex + ".json"), receipt)


def failure_reason(error: Exception) -> dict:
    """Expose actionable coverage categories without paths or tool secrets."""
    message = str(error)
    if "external media" in message or "remote media requires" in message:
        return {"errorCode": "external-media", "message": "外链附件或历史外链尚未纳入独立副本，本次不能认定为完整备份。"}
    if "managed S3" in message:
        return {"errorCode": "s3-source-incomplete", "message": "受管 S3 附件未完整复制，请检查源存储配置、读取权限和备份存储 helper。"}
    if "missing media" in message or isinstance(error, FileNotFoundError):
        return {"errorCode": "missing-media", "message": "引用的附件或历史原件缺失，请检查附件管理和原件覆盖；本次未推进保护时间。"}
    if "restic failed" in message:
        return {"errorCode": "repository-failure", "message": "加密仓库操作失败，请检查凭据、恢复密码、网络、权限与容量。"}
    return {"errorCode": "verification-failure", "message": "备份未完整通过，请检查服务器任务、数据库与媒体完整性。"}


def publish_receipt(config: dict, receipt: dict) -> None:
    if config.get("reportUrl"):
        request = urllib.request.Request(config["reportUrl"], data=json.dumps(receipt).encode(),
                                         headers={"Content-Type": "application/json",
                                                  "User-Agent": "Kairos-Backup/1.0",
                                                  "Authorization": "Bearer " + config["reportToken"]}, method="POST")
        with urllib.request.urlopen(request, timeout=20) as response:
            if response.status != 200:
                raise RuntimeError("remote receipt was not accepted")


def run(config: dict, action: str = "backup") -> dict:
    work = Path(config["workDir"])
    work.mkdir(parents=True, exist_ok=True, mode=0o700)
    lock_file = Path(config.get("lockFile", str(work / "lock")))
    with lock_file.open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return {"status": "skipped", "reason": "another backup is running"}
        if action == "init":
            restic(config, "init")
            return {"status": "initialized"}
        if action == "check":
            restic(config, "check", "--read-data")
            identifiers = [item["id"] for item in json.loads(restic(config, "snapshots", "--json", "--tag", "journal"))]
            result = {"status": "verified", "checkedTs": int(time.time()), "snapshotIds": identifiers,
                      "repositoryId": hashlib.sha256(config["repository"].encode()).hexdigest()[:16]}
            atomic_json(work / "last-check.json", result)
            return result
        if action == "retain":
            policy = config.get("retention", {})
            restic(config, "forget", "--host", config.get("host", "memos-production"), "--tag", "journal",
                   "--group-by", "host,paths", "--keep-within", "2d", "--keep-daily", str(policy.get("daily", 30)),
                   "--keep-monthly", str(policy.get("monthly", 12)), "--keep-yearly", str(policy.get("yearly", 100)), "--prune")
            return {"status": "retained"}
        stage = work / "current"
        started = int(time.time())
        try:
            atomic_json(work / "current-task.json", {"status": "running", "phase": "snapshot", "startedTs": started})
            if stage.exists():
                shutil.rmtree(stage)
            report = snapshot(Path(config["source"]), stage, Path(config["logicalRoot"]), config.get("storageHelper"))
            atomic_json(work / "current-task.json", {"status": "running", "phase": "upload", "startedTs": started})
            output = restic(config, "backup", "--json", "--host", config.get("host", "memos-production"),
                            "--tag", "journal", "data", "manifest.json", cwd=stage)
            messages = [json.loads(line) for line in output.splitlines() if line.strip()]
            summary = next(item for item in reversed(messages) if item.get("message_type") == "summary")
            identifier = summary["snapshot_id"]
            confirmed = json.loads(restic(config, "snapshots", "--json", identifier)) if identifier else []
            if not identifier or not any(item.get("id", "").startswith(identifier) for item in confirmed):
                raise RuntimeError("remote snapshot was not confirmed")
            verify(stage)  # Catch unexpected mutation of a retained source inode.
            receipt = {"status": "success", "snapshotId": identifier, "sourceTs": report["sourceTs"],
                       "completedTs": int(time.time()), "mediaComplete": True,
                       "startedTs": started, "durationSeconds": int(time.time()) - started,
                       "counts": report["counts"], "bytes": sum(item["bytes"] for item in report["files"].values()),
                       "managedS3Count": len(report.get("managedS3", {})),
                       "repositoryId": hashlib.sha256(config["repository"].encode()).hexdigest()[:16],
                       "instanceVersion": config.get("instanceVersion", "unknown"),
                       "sourceHost": config.get("host", "memos-production")}
            atomic_json(work / "last-success.json", receipt)
            atomic_json(work / "last-attempt.json", receipt)
            remember(work, receipt)
        except Exception as error:
            failed = {"status": "failed", "attemptTs": int(time.time()), "errorType": type(error).__name__,
                      "startedTs": started, "durationSeconds": int(time.time()) - started, **failure_reason(error)}
            atomic_json(work / "last-attempt.json", failed)
            remember(work, failed)
            if config.get("reportUrl"):
                try:
                    publish_receipt(config, failed)
                    atomic_json(work / "last-report.json", {"status": "success", "completedTs": int(time.time()), "backupStatus": "failed"})
                except Exception:
                    atomic_json(work / "last-report.json", {"status": "failed", "attemptTs": int(time.time()), "backupStatus": "failed"})
            raise
        finally:
            (work / "current-task.json").unlink(missing_ok=True)
            if stage.exists():
                shutil.rmtree(stage)
        if config.get("reportUrl"):
            try:
                publish_receipt(config, receipt)
            except Exception:
                atomic_json(work / "last-report.json", {"status": "failed", "attemptTs": int(time.time()), "backupStatus": "success"})
                raise
            atomic_json(work / "last-report.json", {"status": "success", "completedTs": int(time.time()), "backupStatus": "success"})
        return receipt


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("init", "backup", "check", "retain"))
    parser.add_argument("--config", type=Path, required=True)
    args = parser.parse_args()
    os.umask(0o077)
    try:
        print(json.dumps(run(json.loads(args.config.read_text()), args.action)))
    except Exception as error:
        parser.exit(1, type(error).__name__ + ": backup command failed; inspect private backup and delivery receipts\n")
