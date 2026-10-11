# Memo export compatibility

This package writes the `memos-export` ZIP container used by the memo export and
import endpoints. The original layout and version 1.0 semantics are recorded in
the frozen [format design](../../docs/design/memos-export-format.md).

New archives use **2.0**. The reader accepts **1.x and 2.x**, including the
historical `memos-archive` identifier. Existing 1.0 golden archives stay unchanged
and are checked for full content, metadata, relation and attachment round trips.

Version 2 adds `location.nameOnly`. A name-only location contains a nonblank
`placeholder`, `nameOnly: true`, and no coordinates. A coordinate location omits
the flag (or sets it to false) and preserves both latitude and longitude,
including a real `(0, 0)` point. This distinction is retained on import.

The major version is intentional: a version 1 reader ignores unknown JSON fields
and defaults absent coordinates to zero. A minor-version bump would therefore
silently invent a geographic location. Version 1 readers reject the 2.0 manifest
before processing records. Upgrade the receiving Kairos instance before
importing a newly exported archive; old 1.x archives continue to import normally.

The writer emits its manifest before receiving records, so every new archive uses
2.0, even if that archive happens to contain no name-only places. There is no
caller override that can label a new semantic record as version 1. This version
does not change database paths, the API wire format, ZIP layout, or the separate
personal-journal / whole-instance backup formats.

Verify with `go test -race ./core/memoexport` and the export/import service tests.
