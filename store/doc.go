// Package store is the persistence layer: the Store facade, the Driver
// interface implemented by store/db/{sqlite,mysql,postgres,d1}, migrations, seed
// data, and the in-memory cache.
//
// Memo mutations keep content, attachment bindings, optional reference relations
// and journal version checks in one transaction. Record saves may omit a reference
// whose target is no longer readable; source and comment authorization stays strict.
// Sharing transactions check full source-record hashes and advance an owner-scoped
// journal guard. Recovery advances the same guard with restored content, ordering
// concurrent grants against withdrawal even when timestamps and text repeat.
//
// Layering: store may import provider, markdown, filter, proto/gen, and
// internal. It must not import core or server; business rules that need
// several store calls live in core.
package store
