# journal

Owner-scoped reading preferences, stable daily review selection, record-date
calendar counts, explicit sharing filters and lifecycle withdrawal. Original
text stays in the existing Memo store. Generated observations and collection
share grants are separate versioned `journal_document` records.

- Daily review freezes at most three older originals for a local date. Reopening
  never adds replacements when a source is excluded or deleted. A session that
  crosses midnight can keep reading its previously frozen date.
- Calendar includes archived originals, excludes comments and trash, and uses
  a configured IANA timezone rather than fixed 24-hour date arithmetic.
- Sharing defaults to snapshots. HTTP handlers bind publishing to a digest of
  the exact preview, enforce owner and media access, and keep state-only changes
  separate from recapturing the snapshot. Imported history needs a fresh
  explicit preview before entering an existing dynamic grant.
- Withdrawal removes saved AI results referring to the source and removes both
  membership and frozen bytes from managed collection shares. Restoring an
  original does not restore its old grants. The API captures an owner-scoped
  `share-guard` before preview source reads or withdrawal scans and advances it
  in the transaction that creates the grant or restores the record. Full record
  hashes bind grants to the exact source. The preview digest also includes the
  captured guard version, so identical content restored after withdrawal cannot
  reuse an old preview. Conflicting approvals return HTTP 409
  and require a fresh preview. Legacy grants use the record owner's guard even
  when an administrator acts, and anonymous reads recheck revocation before
  returning loaded content.
- Backup import pauses collection grants with the same guard in one transaction
  before importing any record. A late conflicting grant aborts import; a new
  empty owner needs no artificial memo. Imported originals stay private and
  excluded from existing dynamic grants until an explicit new preview.

All persistence uses owner-scoped compare-and-swap documents. HTTP auth,
passcodes, safe media transformation and provider calls remain transport or
provider responsibilities. These features never run an automatic full-archive
AI job or create prompts, streaks, goals or notification tasks.

- Agent query criteria compile into the shared memo filter contract. Local day
  boundaries use calendar arithmetic across DST; strings remain literal and tag
  descendants match full path segments. Query scope, authentication and cursor
  verification remain in the API transport.
- Named locations are owner-scoped CAS documents. Updating a reusable name never
  changes historical memo locations. Recent suggestions come only from readable
  originals outside the archive and trash; they carry no new sharing permission.
  A `nameOnly` place is a personal label without coordinates. Its wire JSON and
  export omit latitude/longitude; older places default to coordinate locations,
  including a real `(0, 0)` point. Both kinds live in the existing JSON payloads
  and require no database schema migration. Recent labels deduplicate by name,
  separately from geographic points.
  Replacing a name-only memo location with `(0, 0)` requires the current record
  snapshot token: this rejects older clients that silently discard `nameOnly`.
  Body-only edits that leave the location out of the update mask preserve it.
