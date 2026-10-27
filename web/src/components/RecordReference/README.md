# Record references

`RecordReference` displays same-instance URLs as compact circular arrows without fetching
or injecting record excerpts into the authored prose. Authored link labels remain visible.
`RecordReadingProvider` owns one reading stack per account and route, including the source
record for each step, focus and scroll restoration. `RecordReadingDialog` shows the target
and related records as full Markdown/media cards in two columns (stacked on mobile).
The clicked-from record appears first; incoming and outgoing neighbours are deduplicated.
Only one hop expands automatically. `RecordReadingCard` rechecks access before displaying
cached content and resolves further cards as they approach the viewport. Shared-token routes disable ambient
record resolution; journal share pages retain their inert authorized snapshot renderer.

The editor mounts these same reference components through React portals in CodeMirror
widgets. Stored Markdown, editor selection and undo history remain the source of truth.
