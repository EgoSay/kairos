# recordgraph

Owner-only associative reading, prepared asynchronously by Cloudflare Workers AI.
A saved `wander-config` explicitly enables automatic processing. Until then,
readers can still open originals and their manually linked records. Private
records are not processed merely because a provider exists.

The worker leases a durable source revision, embeds all text chunks (up to 64
chunks of 2,800 UTF-8 bytes), extracts at most three evidenced concerns, and
ranks candidates using original similarity, concern retrieval and lexical ranks.
It asks the model to judge at most twelve candidates and accepts at most four
connections with exact original spans. Themes are reading labels supported by
both cited originals; they do not establish inferred facts about a person.

Reads use bounded adjacency and source queries. They never warm the vector index,
call a model, or scan original bodies across the collection. Every response checks
active ownership, normal state, comment/trash exclusions, personal exclusions,
Space access, current source revisions, profile and the eligibility epoch. Long
originals have an explicit bounded excerpt and a link to the full original.
Manual links are labelled independently and do not need a model.

SQLite, MySQL and PostgreSQL triggers register source changes atomically, including
imports and restores. Permission/service changes advance epochs and requeue work;
feedback advances the epoch without generating another model job. Expiring leases,
revision checks and atomic publication reject late results. Partial validated
representations survive deferred jobs. The in-memory candidate index is bounded
at 24,576 original vectors (96 MiB for vector values, plus metadata and Go overhead).
Before ranking, the background worker reconciles paginated source metadata against
current eligibility and revisions. Withdrawn vectors release memory and candidate
slots; unchanged vectors are reused, and only missing revisions are decoded.
Very long originals and collections exceeding this bound are delayed explicitly;
they remain readable. Scaling beyond that requires an index implementation change.

The two fixed models are `@cf/qwen/qwen3-embedding-0.6b` and
`@cf/qwen/qwen3-30b-a3b-fp8`, through a strict Cloudflare endpoint. Conservative daily
Neurons reservations are shared by account, survive restarts and have a maximum
application limit of 9,000. Unknown usage and failed calls keep their reservation.
Cloudflare's daily quota error pauses the account until UTC midnight. The user
must confirm a Workers Free account; this application cannot inspect billing plans
or guarantee zero charges on a Paid account. Other applications share the vendor
quota but are not included in this application's accounting. No automatic fallback
provider or paid-plan upgrade exists.

Test with `DRIVER=sqlite go test -race ./core/recordgraph`; store integration tests
also exercise all three supported drivers. Model tests use synthetic records and
explicit fake services; passing them does not establish actual model quality.

Local delivery evidence and unverified targets: [verification report](../../docs/operations/random-walk-local-verification.md).
