# graphsql

Portable, owner-scoped storage for record discovery. Source rows are also durable
coalescing jobs. Database triggers register every memo mutation in its original
transaction, including imports and recovery. Journal eligibility changes advance
an owner epoch and requeue sources. Publication locks that epoch, compares leases
and both source revisions, and commits one source plus its adjacency atomically.

Original records remain in `memo`. Representations and suggested edges are derived
and rebuildable; preference/feedback documents are separate user intent. Ordinary
read endpoints use bounded source and adjacency queries, never model calls.
