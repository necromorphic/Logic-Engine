# Mechanic effect-intent support matrix — pre-execution audit

Status: **design/review artifact; no execution is authorized by this document**.

This audit compares the mechanic-template effect-intent vocabulary with the canonical effect vocabulary accepted by `src/core/rules.js::validateEffects`. It exists to prevent the future evaluator from treating a valid template declaration as proof that the requested consequence can be represented or committed by the runtime.

## Current facts

- Mechanic templates declare intents using `effect_id`, `kind`, `target_ref`, optional `payload`, `source_refs`, and `caused_by`.
- The template schema/validator currently accepts 18 intent kinds.
- The canonical runtime effect validator accepts `entity.create`, `entity.update`, `entity.upsert`, `entity.delete`, `fact.set`, and mechanic-instance lifecycle effects (`mechanic.instance.create`, `mechanic.instance.enable`, `mechanic.instance.disable`).
- These are different vocabularies and shapes. No adapter/translation layer is established by the registry or schema alone.
- Process lifecycle execution, knowledge operations, generic relationship operations, and goal/task management are not implemented by the current canonical effect validator.

## Candidate compatibility matrix

“Candidate mapping” means only that a conceptual correspondence may exist. It is **not** permission to translate or execute the intent until field-level semantics, validation, provenance, and failure behavior are specified and tested.

| Mechanic intent kind | Current canonical support | Status before execution |
|---|---|---|
| `create_entity` | `entity.create` exists | Candidate only. Define whether `target_ref` becomes `entity_id`; define required `payload.entity_type`, allowed status/attributes, reference allocation, and collisions. |
| `update_attribute` | `entity.update` exists | Candidate only. Define target identity, patch/removal semantics, status handling, and missing-target behavior. |
| `assert_fact` | `fact.set` exists | Candidate only. Define fact identity, subject, predicate, value, replacement/idempotency, and source/provenance semantics. |
| `create_relation` | No relation effect kind in `validateEffects` | Unsupported. Do not silently encode as an attribute or fact. Requires a separate relation contract or explicit rejection. |
| `retract_relation` | No relation retraction effect kind | Unsupported. |
| `retract_fact` | No fact-retraction effect kind | Unsupported. Do not assume `fact.set` can retract. |
| `propose_knowledge` | No canonical knowledge effect kind | Unsupported for commit. Could be a proposal/review artifact only if separately specified. |
| `reconcile_knowledge` | No canonical knowledge effect kind | Unsupported for commit. Reconciliation semantics and authority are undefined here. |
| `start_process` | No process-start effect kind in `validateEffects` | Unsupported. Process lifecycle execution is explicitly future work. |
| `advance_process` | No process-advance effect kind | Unsupported. |
| `cancel_process` | No process-cancel effect kind | Unsupported. |
| `create_task` | No task effect kind | Unsupported. |
| `update_task` | No task effect kind | Unsupported. |
| `create_goal` | No goal effect kind | Unsupported. |
| `update_goal` | No goal effect kind | Unsupported. |
| `emit_event` | No generic `emit_event` canonical effect kind | Unsupported. Events must use existing event commands/contracts; do not add a generic bypass. |
| `request_adjudication` | Not a canonical world mutation effect | Should be a structured review/result outcome, not treated as an executable effect. Define separately if needed. |
| `needs_review` | Result/outcome concept, not a canonical effect | Should be a structured review/result outcome, not treated as an executable effect. |

## Required decisions before implementing translation

1. **Separate effect intent from committed effect.** An intent is untrusted proposal data; only a bounded translator may create canonical effects, and only the existing proposal/approval/commit path may commit them.
2. **Choose an explicit initial support set.** Prefer a small, field-level defined set over pretending all 18 intents are executable. Unsupported kinds must fail closed with a stable reason code or yield a non-mutating `unknown`/`needs_review` result where the contract calls for that.
3. **Define exact mappings.** For each supported intent, specify target resolution, required/allowed payload fields, world scoping, source/causal references, idempotency, staleness, and error behavior. Do not infer semantics from the kind name.
4. **Keep review control flow out of mutation effects.** `request_adjudication` and `needs_review` belong in the evaluator result/review pipeline unless a distinct, explicit durable review-record operation is designed.
5. **Add one source of truth and conformance tests.** Schema, template validator, translator, and canonical effect validator must agree. Test every supported mapping and every unsupported kind; failure must leave canonical state and audit/commit state untouched.
6. **Do not expand the canonical runtime vocabulary just to match the template enum.** Add a canonical effect only when its event shape, validation, commit semantics, audit, causality, and rollback behavior are separately specified and implemented.

## Non-goals

This document does not implement an evaluator, translator, relation store, knowledge store, process manager, task/goal subsystem, second event store, or alternate commit path. It does not change NPC-block contracts or add game-specific mechanics.

## Review questions

- Is the distinction between intent, canonical effect, and review outcome correct and sufficiently strict?
- Are any candidate mappings semantically unsafe or misleading?
- Which minimal initial support set is defensible given the actual runtime?
- What contract/test gaps must be closed before any translator is implemented?
- Does any proposal accidentally introduce a second event/commit/process/knowledge subsystem?
