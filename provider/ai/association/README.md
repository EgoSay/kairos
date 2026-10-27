# association

Cloudflare Workers AI adapter for background record discovery. It accepts only
caller-selected original excerpts and returns normalized 1024-dimensional
embeddings, evidenced concerns, or relationships with exact quotes on both sides.
Unknown sources, malformed structures, incomplete generations, redirects, oversized
responses and invalid vectors are rejected. It has no store, tools, retries, logs,
fallback provider or autonomous source selection.

The initial models are Qwen3-Embedding-0.6B and Qwen3-30B-A3B-FP8. Runtime endpoints
must be HTTPS Cloudflare account APIs. The caller owns consent, account isolation,
source eligibility, persisted budget reservations and retry scheduling. Returned
token usage is accounting evidence, not a guarantee about the account-wide bill.
