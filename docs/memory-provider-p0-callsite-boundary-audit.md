# P0 Memory Provider callsite boundary audit

Audit baseline: existing branch `memory/provider-p0-callsite-boundary-2026-11-01`, source tree at the task branch HEAD.

## Production callsite inventory

| Surface | Finding |
|---|---|
| `src/index.js` runtime composition | Does not construct or import `SQLiteMemoryProvider` or `MemoryNpcConsumer`. |
| `src/api/server.js` HTTP API | Does not import either implementation and exposes no Provider/Consumer retrieval or grant/revoke route. |
| Other `src/**` production modules | No production import/callsite for either class or the internal import test facade was found. |
| Provider persistence/grant methods | No production callers of `putRecord`, `grantQuery`, `grantRecord`, `revokeQuery`, or `revokeRecord` were found outside the Provider implementation. |
| `host-adapter/**` SillyTavern-facing code | No direct Provider/Consumer import, class reference, or endpoint path was found. Host adapter uses its own bounded Host transport prototype; it does not have Provider module access. |
| `tests/**` | Direct construction and method calls are test fixtures only; excluded from production callsite inventory. |

## Boundary conclusion

At this baseline there is **no production Memory → NPC composition path** to authorize: Provider and Consumer are not wired into the runtime. Retrieval is therefore unavailable rather than reachable through an alternate public route. The public API requires its server-held bearer credential and contains no Provider/Consumer endpoints; the browser/ST extension code has neither a module import path nor a direct HTTP route to these internals.

Provider administrative writes and grants are likewise **not wired to production callers**. Their class methods remain available to trusted in-process code holding a Provider instance, but no production composition creates such an instance or passes it to an untrusted boundary. They are not exposed through HTTP or ST extension code. The internal import facade is explicitly test-only and is not re-exported or wired into runtime.

This is a fail-closed absence-of-wiring result, not proof that a future composition is safe. Any production retrieval/write/grant wiring must be introduced only through an approved server-side composition boundary with trusted source/currentness validators and authorization, and must add exact-boundary tests before enabling dispatch.

## Executable regression guard

`tests/memory-provider-callsite-boundary.test.js` statically enforces:
- no production imports/references to Provider, Consumer, or the test import facade outside their implementation modules;
- no Provider/Consumer retrieval or administration route in the HTTP API;
- no direct module/endpoint access from `host-adapter/**`;
- no production callers of Provider persistence/grant/revoke methods.

These checks guard against accidental future bypasses; they do not substitute for runtime authorization or Host final-egress validation.
