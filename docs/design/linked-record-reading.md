# Linked record reading

Status: Approved, implementation in progress
Issue: https://github.com/EgoSay/kairos/issues/36

## Intent

Recognize another record while writing or reading, inspect its original content
in place, then continue without losing the current draft, cursor or scroll.
Use existing paper surfaces, content typography and semantic theme tokens.

## Interaction contract

- A current-instance record URL on its own becomes a quiet date/excerpt card.
  An inline URL becomes a short text reference; authored link labels survive.
  Code and escaped Markdown remain literal. Markdown remains the stored source.
- Resolve previews asynchronously, including in the visual editor. Pasting never
  opens a dialog or blocks typing/saving. Source mode and undo remain available.
- Ordinary activation opens one accessible reading dialog with original content,
  date, attachments and a secondary connections area. Modified clicks and an
  explicit independent-open action retain normal link behavior.
- Desktop uses a readable main column and subordinate connections; narrow screens
  use an almost full-screen dialog and collapsible connections below the content.
- Following another record replaces the content in that dialog, with a back
  action. Closing restores the originating focus, draft and page position.
- All record-reference entry points share the same reading behavior.

## Relations and compatibility

- Automatic content references commit with the body. Duplicate URLs create one
  automatic edge; deleting the last occurrence removes that edge on save.
- Manual references are independent and survive removal of a body link to the
  same target. Immutable comment context remains independent as well.
- Reading legacy links renders previews without changing the stored record.
  Automatic relations are synchronized when the record is explicitly saved.
- Existing API wire names, Markdown, record IDs, exports and storage paths retain
  their meaning. Any new relation provenance is additive and generated from proto
  source rather than hand-edited generated files.

## States and permissions

- Loading retains a readable link and does not move editor selection.
- Network failure retains the link and offers retry. Deleted/unreadable records
  have a neutral unavailable state and do not render stale cached content.
- Media-only records have an attachment description/thumbnail.
- Preview uses the record reader's permission checks. Shared views cannot fetch
  unrelated private records using an owner's ambient session.
- No external-origin lookup is triggered by interpreting a record reference.

## Verification and delivery

Test parsing, editor undo/cursor, overlay history/focus, automatic/manual relation
coexistence, save failures and permission boundaries. Run the affected checks
from AGENTS.md and a production frontend build. Validate real desktop/narrow-screen
flows in Ego lite against isolated synthetic records, then retain a local review
environment and report evidence to Evan.

The PR remains unmerged until Evan accepts. No release tag or deployment belongs
to this implementation stage.
