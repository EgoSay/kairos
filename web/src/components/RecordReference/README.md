# Record references

`RecordReference` resolves a same-instance record through the existing permission-aware
query and displays its current original excerpt. `RecordReadingProvider` owns one
reading stack per account and route, including focus and scroll restoration.
`RecordReadingDialog` reuses the original Markdown/media readers and displays
deduplicated outgoing and incoming references. Shared-token routes disable ambient
record resolution; journal share pages retain their inert authorized snapshot renderer.

The editor mounts these same reference components through React portals in CodeMirror
widgets. Stored Markdown, editor selection and undo history remain the source of truth.
