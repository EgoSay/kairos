# Random-walk accounting comparison reset

This is an explicitly authorized, one-time reset of **Kairos's random-walk
accounting**, not Cloudflare's actual daily consumption. The provider's free
allowance is 10,000 Neurons per UTC day; Kairos's configured 8,000-Neuron limit
remains unchanged. Originals, embeddings and established relationships survive.

Use the production SQLite database path from the private backup configuration.
Keep full database backups and operator receipts on the server in a root-only
directory. They contain private data and must never enter Git, issue bodies,
browser fixtures or public CI artifacts.

1. Verify the configured account, current source commit and healthy container.
   Run `scripts/wander_ledger_reset.py prepare` with the explicit database path,
   account ID, unique operation ID and private backup directory. It saves a
   consistent SQLite backup, pauses the old and new worker, advances its config
   fence, and preserves all job controls in the same transaction. It does not
   clear the ledger or invalidate completed work. Wait for the old in-flight
   request to finish before deploying (provider timeout is 90 seconds).
2. Publish the reviewed repair through the normal release gate. Confirm its
   source commit, digest, successful deployment receipt and resumed backups.
   The persisted maintenance pause prevents the repaired worker from starting
   new accounting before the reset. A failed release leaves the worker paused;
   inspect its receipt and do not clear or resume blindly.
3. Refresh Cloudflare's displayed daily usage if accessible. Record its value,
   observation timestamp and whether rounded. If unavailable, omit the provider
   baseline; never substitute zero or the old screenshot. This is an external
   comparison point, not a value subtracted from Kairos's ledger.
4. Gracefully stop the repaired application container. Run `finalize` with the
   same database/account/operation/backup directory plus the exact container
   name and reviewed 40-character source commit. The script verifies it is
   stopped, its image source matches, the new schema exists, and the paused
   settings have not changed. It saves another full backup, deletes only that
   account's budget rows and call receipts, records the comparison baseline,
   restores the prior enabled intent and releases application-budget waits.
   Real vendor quota and network cooldowns remain intact. Hashes and counts of
   originals, representations and edges must match within the transaction.
5. Save the JSON receipt, start the container, verify health and source identity,
   and inspect new call receipts, the baseline and preserved original counts.
   A successful repeated `finalize` for the same operation is a no-op; it must
   never erase the new comparison data.

Example argument structure (replace all placeholders with verified values):

```sh
python3 scripts/wander_ledger_reset.py prepare \
  --db /verified/data/memos_prod.db --account ACCOUNT_ID \
  --operation OPERATION_ID --backup-dir /private/backup/OPERATION_ID

python3 scripts/wander_ledger_reset.py attest \
  --db /verified/data/memos_prod.db --account ACCOUNT_ID \
  --operation OPERATION_ID --backup-dir /private/backup/OPERATION_ID \
  --container VERIFIED_RUNNING_CONTAINER --commit REVIEWED_SOURCE_COMMIT

# Stop that same container gracefully before finalize.
python3 scripts/wander_ledger_reset.py finalize \
  --db /verified/data/memos_prod.db --account ACCOUNT_ID \
  --operation OPERATION_ID --backup-dir /private/backup/OPERATION_ID \
  --container VERIFIED_STOPPED_CONTAINER --commit REVIEWED_SOURCE_COMMIT
```

Optional comparison arguments are `--provider-neurons`,
`--provider-observed-at` (Unix seconds), and `--provider-approximate`.
The script refuses to overwrite an existing backup after an interrupted
operation. Inspect the database's maintenance document and saved receipt before
choosing recovery; do not remove a backup merely to make a command pass.
If a user changes configuration during the maintenance window, finalization
refuses to overwrite their intent and leaves accounting untouched.

Run `attest` after successful deployment and before stopping the container.
It verifies the live profile's source commit and saves the exact container/image
IDs privately. `finalize` matches those immutable IDs on the stopped container;
production images do not have revision labels. A container replacement requires
a new verified attestation, never an assumed label or image tag.

Local validation uses only fictional data and the actual latest schema:

```sh
python3 -m unittest discover -s scripts/tests -p test_wander_ledger_reset.py -v
```
