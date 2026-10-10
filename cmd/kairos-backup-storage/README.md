# Host backup storage helper

This host-only executable uses the application's existing AWS SDK for S3 probes
and managed attachment reads. The root backup agent supplies a bounded JSON
request on stdin; credentials and raw SDK errors never go to output. It accepts
`probe` (temporary object write/read/delete) and `fetch` (stream an existing
object) require verified HTTPS. Neither accepts local paths or shell commands.
Build for the deployment host and install the reviewed binary at
`/opt/memos-backup/kairos-backup-storage`, root-owned and not application-writable.

The operator-only `derive-tags` action produces a private restoration migration
manifest using the same Markdown source parser as the application. It accepts
snapshot/database hashes and bounded ID/content records over stdin, makes no
network or storage calls, and returns content hashes, exact ordered explicit tags
and the helper build's commit/version. It accepts no S3 configuration or paths.
Tag derivation permits up to 64 MiB of input and 100,000 records; S3 operations
retain their 64 KiB limit. Build from the exact tested application commit with
Git build metadata enabled. The restore verifier rejects a different parser commit.
