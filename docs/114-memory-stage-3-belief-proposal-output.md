# Stage 3B — strict model-output parsing and Core handle resolution

**Status:** PARTIAL / IN PROGRESS. Strict parsing and fresh Core handle resolution are implemented in source. Belief commit remains intentionally unavailable.

**Branch:** `memory/development-2026-11-13`  
**PR:** [#951](https://github.com/necromorphic/Logic-Engine/pull/951)

## Implemented

- `parseNpcBeliefProposalOutput()` accepts only a bounded JSON string with the exact version-1 proposal envelope. Markdown fences, free-text extraction, extra fields, model-supplied scope/identity fields, and model-controlled idempotency keys are not accepted.
- Duplicate JSON object keys are rejected before `JSON.parse`, including escaped spellings that resolve to the same key.
- Output size, nesting depth, node count, handle formats, evidence count, and duplicate evidence handles are bounded and checked.
- Proposal values must be finite JSON data; non-finite numbers such as the result of parsing `1e999` are rejected.
- `LogicEngine.resolveNpcBeliefProposalOutput()` parses the untrusted raw model output and delegates handle resolution to the existing fresh, authorized Core read. Invalid parser output does not reach handle resolution.
- A successful result is explicitly `resolved_uncommitted`. The model-provided stance and modality are preserved as uncommitted semantic fields. No Core event or belief transition is written by this method.

## Deliberate commit blocker

The accepted ADR proposal vocabulary is `supported`, `contradicted`, `uncertain`, and `dropped`, with a `modality` field. The current Core belief reducer accepts `believes_true`, `believes_false`, `suspects_true`, `suspects_false`, and `unresolved_conflict`; it has no modality or dropped transition.

These vocabularies are not semantically equivalent. No automatic mapping is introduced. Until the mapping and treatment of `dropped`/modality are explicitly settled, the parsed and resolved proposal cannot be passed to `recordNpcBeliefTransition()`.

## Not implemented in this increment

- No HTTP endpoint or SillyTavern prompt/model dispatch integration.
- No model-output tool-call or constrained-generation negotiation.
- No mapping from ADR stances/modality to the current Core reducer.
- No idempotent proposal commit wrapper.
- No changes to Core authority/acquisition semantics, Host authentication/Gateway, Provider, or ST-VectorService.

## Verification

- Source files and call boundaries were inspected on the PR branch.
- Added `tests/npc-belief-proposal-parser.test.js` for exact schema, duplicate keys, malformed/free-text output, invalid handles, duplicate evidence, non-finite values, bounds, and the Core parse→resolve-uncommitted boundary.
- Tests were **NOT RUN** by instruction. All runtime behavior and test outcomes remain **NOT VERIFIED**.
- Memory → NPC remains **DISABLED / FAIL-CLOSED**.
