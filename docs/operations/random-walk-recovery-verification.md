# Random-walk recovery and accounting verification

Verified on 2026-10-28 for the recovery/accounting repair (PR #41). This extends
the original A+C reading implementation; it does not claim a new cold-start
performance result or user acceptance of the repair.

## Accounting and recovery

- Known usage settles rejected results as well as valid ones. A 100-input,
  10-output chat response costs 0.76725 Neurons even when its evidence is rejected.
- One hundred 100-token embeddings accumulate to 10.75 Neurons; accounting does
  not round each call up to a whole Neuron. Explicit zero releases a reservation;
  missing usage remains a labelled estimate or unknown reservation.
- Concurrent reservations respect the shared account limit; duplicate settlement
  applies once and stays on the original UTC day. A larger actual charge is
  visible and blocks later calls. Provider quota does not invent an application
  charge and is shared across credentials for the same endpoint.
- Budget waits, cancellation and source changes do not consume validation
  retries. Network and invalid-result failures have separate consecutive counts.
  Connection cooldown survives restart and admits only one recovery probe.
- Validated embeddings survive result retries. A failed SQL publication reuses
  validated relationships without another model call. Retry receipts survive
  duplicate requests and reject stale source revisions/status.
- Progress reads complete while the inference mutex is held; excluded/foreign
  records remain inaccessible and read endpoints never call the model.
- SQLite, MySQL and PostgreSQL migration tests retain legacy budget value by
  converting units and recover only legacy terminal jobs once. Ordinary
  migrations never clear accounting.

Two actual Cloudflare embedding requests used only fictional strings. Both
returned vectors with `data`, `model`, `object` and **no `usage` field**. This
supports labelling the embedding estimate, not claiming exact token accounting
or agreement with the Cloudflare bill. No real originals were used for this
adapter test. Prices are documented in Cloudflare's
[Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/).

## Browser verification

Ego Lite, isolated local fixture, actual application APIs:

- Desktop progress drawer: mixed ready, retry-wait, budget-wait and invalid-result
  states; safe per-call receipts and separate application/vendor budget labels.
- A real retry request moved one fixture from attention to preparing. Its network
  trace contained status/jobs/history/retry requests and no new wander start or
  neighborhood requests; the reading trail stayed intact.
- Escape returned focus to the progress opener. The original nearby map still
  opened. Following an original and going Back retained the selected filter and
  actual click-time panel scroll offset (649.5 px before and after).
- 390 × 844 bottom sheet and 320 px narrow layout had no horizontal overflow;
  all measured panel buttons were at least 44 px high.
- Browser network emulation showed the cached-progress offline message and
  recovered online. Unit tests also verify disabled writes while offline and
  idempotency-key reuse after a lost retry response.

Fixtures are explicitly synthetic; they do not establish model association
quality on personal records. Local acceptance: `http://127.0.0.1:3081/journal/wander`.

## Checks

- `go test -race ./server/... ./core/... ./provider/...`
- `go test ./store/...` (the repository harness runs all three drivers)
- Targeted publication, account-quota, connection/result-counter and probe tests
- Go lint with the repository configuration and Go 1.27-compatible golangci-lint
- `cd web && pnpm lint && pnpm test`: 248 files, 2,229 tests
- Production frontend build
- `python3 -m unittest discover -s scripts -p test_wander_ledger_reset.py -v`:
  backup integrity/permissions, original and graph preservation, unrelated
  account/provider-quota preservation, idempotence, configuration-drift refusal,
  stopped-container checks and live source attestation
- `git diff --check`

The [operator reset](wander-ledger-reset.md) is separate from these tests. Its
private production receipts establish whether backup, pause, deployment,
one-time clear and resumed processing actually happened. Do not infer production
reset success from this local verification report.
