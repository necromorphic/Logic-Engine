# P0 Memory Provider callsite boundary audit

Audit baseline: latest #846 Core-authenticated Host branch, combined with the server-side Host Adapter in this PR.

## Production callsite inventory

| Surface | Finding |
|---|---|
| `src/application/sqlite-memory-provider.js` | Provider implementation only. |
| `src/application/memory-npc-consumer.js` | Consumer implementation only. |
| `src/application/memory-npc-provider-adapter.js` | The sole approved Core composition boundary. It constructs the real file-backed Provider, binds authorization and Consumer dependencies, and exposes the restricted adapter surface. |
| `src/index.js` runtime composition | Does not import or construct the Provider/Consumer composition factory. |
| `src/api/server.js` HTTP API | Does not import the Provider/Consumer implementation and exposes no retrieval, record, grant, or revoke route. The new Host-session verification route only verifies a signed capability and returns its bound identity; it does not invoke retrieval. |
| Other `src/**` production modules | No direct Provider/Consumer implementation imports or class callsites outside the approved composition boundary. |
| `host-adapter/**` | No Provider/Consumer imports, class references, or direct Provider endpoints. ST communicates only with the Host Adapter routes. |
| Provider persistence/grant methods | Calls are confined to the Provider implementation and the single approved Core composition factory. No Host, API, or other production caller is present. |

## Boundary conclusion

The Provider/Consumer implementation is composed only through `createMemoryNpcProviderAdapter()`. That composition factory is not wired into the normal runtime entrypoint or the HTTP API. The Host Adapter can establish a Core-authenticated Host session, but there is no production Memory→NPC retrieval route or active runtime composition.

The server-side Host Adapter cannot access Provider or Consumer internals. The browser Extension Gateway receives no Core or Provider credentials and can call only the Host Adapter.

## Guard

`tests/memory-provider-callsite-boundary.test.js` enforces:
- exactly one approved Provider/Consumer composition boundary;
- no additional production imports or class references;
- no Provider/Consumer package exports or public retrieval/admin routes;
- no direct Host Adapter access to Provider or Consumer;
- no Provider write/grant/revoke callers outside the Provider implementation and approved composition boundary.

This audit does not activate Memory→NPC production retrieval.
