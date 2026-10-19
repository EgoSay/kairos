# Tag organization planning

Pure planning for tag organization edits: which memos a rename or delete
touches, which add/remove sets actually change one memo, and how saved-view
filters and display-rule keys follow a rename or delete.

Tags are authored Markdown tokens, not stored entities, so everything here is
pure text and set logic over `explicit_tags`. `markdown.Service` performs the
content rewrite and `server/api/v1` owns persistence, CAS, delivery keep-alive,
and saved-view/settings writes; this package only decides what should happen.

- `memotag.go` — tag validation, exact and descendant matching, batch
  add/remove plans with conflict and no-op detection.
- `rules.go` — literal display-rule keys that reference a tag and how a
  rename rewrites them. Regex keys are reported, never rewritten.
- `view_filter.go` — position-aware rewriting of CEL saved-view filters. Only
  tag slots (`in tags`, `in explicit_tags`, `exists` bodies, `startsWith`
  prefixes) are rewritten; content string literals are left alone.
