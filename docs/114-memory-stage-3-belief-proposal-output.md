# Stage 3B — strict model-output parsing and Core handle resolution

**Status:** PARTIAL / IN PROGRESS. Strict parsing, fresh Core handle resolution, and an internal Core-owned commit path are implemented. Prompt dispatch and production activation remain disabled.

**Branch:** `memory/development-2026-11-13`  
**PR:** [#951](https://github.com/necromorphic/Logic-Engine/pull/951)

## Implemented

- `parseNpcBeliefProposalOutput()` accepts only a bounded JSON string with the exact version-1 proposal envelope. Markdown fences, free-text extraction, extra fields, model-supplied scope/identity fields, and model-controlled idempotency keys are not accepted.
- Duplicate JSON object keys are rejected before `JSON.parse`, including escaped spellings that resolve to the same key.
- Output size, nesting depth, node count, handle formats, evidence count, and duplicate evidence handles are bounded and checked.
- Proposal values must be finite JSON data; non-finite numbers such as the result of parsing `1e999` are rejected.
- `LogicEngine.resolveNpcBeliefProposalOutput()` parses the untrusted raw model output and delegates handle resolution to the existing fresh, authorized Core read. Invalid parser output does not reach handle resolution.
- A successful result is explicitly `resolved_uncommitted`. The model-provided stance and modality are preserved as uncommitted semantic fields. No Core event or belief transition is written by this method.

## Core semantic contract and commit path

The Core reducer and persistence now accept the ADR proposal vocabulary directly: `supported`, `contradicted`, `uncertain`, and `dropped`. The legacy five-value Core vocabulary remains accepted for existing internal callers and historical records; no lossy translation from ADR stances to legacy stances is performed.

- `supported`: the selected proposition value is present in current evidence, and all current evidence for the proposition agrees with it.
- `contradicted`: current evidence for the proposition consistently differs from the selected proposition value. The proposed value need not itself appear in evidence.
- `uncertain`: evidence is insufficient for a determinate stance or contains conflicting values. All current proposition evidence must still be accounted for; a source conflict cannot be hidden by omitting a handle.
- `dropped`: an explicit append-only transition that may target only an existing belief with the exact same proposition value and modality. It does not delete prior events or acquisition history.
- `modality` is validated as a lowercase canonical token and persisted with the canonical event/projection. Legacy transitions receive `asserted` as their compatibility default. SQLite migration 20 preserves existing rows; read-only Core startup now requires schema migration version 20.

`commitNpcBeliefProposalOutput()` is an internal Core method. It strictly parses the raw model output, resolves handles against a fresh authorized Core read, derives an idempotency key server-side from the scoped context and validated proposal, then delegates to `recordNpcBeliefTransition()`. The existing final read/visibility revalidation and canonical snapshot compare-and-swap remain the commit boundary. Identical concurrent commits converge on one canonical transition. On a retry after commit, Core verifies the original context HMAC/scope (even if expired) and reauthorizes the current actor/conversation before returning only the prior acknowledgement. Legacy idempotency hashes that predate modality remain accepted for legacy stance inputs. Model output cannot supply Core IDs, scope, or idempotency. Opaque context/proposition/evidence handles (`nctx1`, `prh1`, `evh1`) are also rejected if copied into the proposed proposition value, including nested JSON values.

This is a Core data-contract extension, not a prompt or HTTP integration. The method is not exposed over HTTP and no model dispatch is wired.

## Not implemented in this increment

- No HTTP endpoint or SillyTavern prompt/model dispatch integration.
- No model-output tool-call or constrained-generation negotiation.
- No prompt dispatch or HTTP exposure of the new Core commit method.
- No changes to Core authority/acquisition semantics, Host authentication/Gateway, Provider, or ST-VectorService.

## Verification

- Source files and call boundaries were inspected on the PR branch. A follow-up static audit found and fixed a misplaced SQL-template terminator in migration 20: foreign-key validation now executes after the SQL DDL statement, not inside the SQL string.
- Latest branch HEAD at the last static review: `948bd095f1113e827059d435e73f729ad740cd18`. Stage 3B source, migration 20 SQL boundary, parser/handle resolver, commit path, reducer, projection rebuild and regression-test additions were re-fetched and inspected.
- Added parser and commit-wrapper coverage in `tests/npc-belief-proposal-parser.test.js`; added ADR stance, modality, persistence, dropped-transition, idempotent replay, and concurrency coverage in `tests/npc-knowledge-read.test.js`; updated `tests/storage-migrations.test.js` to require schema version 20, check the modality column, and cover migration-20 preservation of an existing v19 belief row.
- A static follow-up also rejects opaque HMAC context/proposition/evidence handles if the model copies them into a proposed value, including nested JSON; targeted negative regression cases were added. Tests were **NOT RUN** by instruction. All runtime behavior and test outcomes remain **NOT VERIFIED**.
- Memory → NPC remains **DISABLED / FAIL-CLOSED**.
