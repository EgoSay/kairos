# Host backup storage helper

This host-only executable uses the application's existing AWS SDK for S3 probes
and managed attachment reads. The root backup agent supplies a bounded JSON
request on stdin; credentials and raw SDK errors never go to output. It accepts
only `probe` (temporary object write/read/delete) and `fetch` (stream an existing
object), requires verified HTTPS, and never accepts local paths or shell commands.
Build for the deployment host and install the reviewed binary at
`/opt/memos-backup/kairos-backup-storage`, root-owned and not application-writable.
