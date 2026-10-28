# Core Decision Proposal — Initial NPC Knowledge Acquisition Representation

**Status:** coordinator recommendation for Core review; not implemented.  
**Scope:** first slice only: `author_initial` and `imported`.  
**Related:** docs 43, 50, 51, 83, 84; tracking issue #557; governing integration gates #140/#264/#356.

## 1. Decision recommended

Use a **Core-owned, event-sourced acquisition effect with a derived read projection**, not an NPC-owned table and not ordinary `fact.set`.

Proposed effect family (names are proposal-only until the Core contract is approved):
- `knowledge.acquisition.assign` — records one explicit assignment of one canonical item/source to one canonical subject in one world.
- `knowledge.acquisition.invalidate` — records a Core-authorized invalidation of a specific assignment/source support when the existing source lifecycle cannot express the invalidation through a supported rollback path.

The durable authority remains the existing Core event stream and its validity/replay boundary. The query projection is derived from valid acquisition effects and is rebuilt/reconciled from that stream. It is not a second authority or a second event log. Do not add an independent revision counter; reads use the existing `(world_revision, commit_sequence)` cursor.

This is a **design recommendation**, not a claim that the current event validator, rollback engine, importer, or model-dispatch path already supports these effects.

## 2. Why this representation

Source audit shows:
- `fact.set` creates canonical world-truth claims; it has no subject-acquisition semantics.
- `context_manifests` bind generation/snapshot metadata and referenced items; they do not grant knowledge.
- `ActorBindingService` resolves a trusted adapter-to-canonical-actor binding; it does not authorize item disclosure.
- `world_events` already own canonical effects, validity, replay/reprojection, rollback metadata, and the per-world commit cursor.
- `SQLiteStore.readSnapshot()` supplies the existing snapshot cursor.

Therefore the least divergent Core design is to keep assignments within the Core event/validity lifecycle and expose them through a derived projection. A standalone NPC table or prompt/manifest-based record would create a competing authority and would not inherit replay/rollback automatically.

## 3. Semantic shape (not wire JSON or SQL schema)

Each assignment must semantically carry:
- canonical `world_id`;
- canonical `subject_id`, resolved by the trusted Core boundary;
- canonical item reference or explicitly supported source reference;
- `acquisition_kind`: exactly `author_initial` or `imported`;
- stable authoring/import source identity and version where available;
- explicit assignment/authorization rule identity and version;
- initial/import boundary;
- event identity and validity derived from Core lifecycle;
- restriction reference resolved by the existing trusted access-policy mechanism.

Do not use display names, model-provided actor IDs, context manifest IDs, prompt text, vector hits, or generic fact presence as assignment authority. Do not include belief, confidence, delivery, comprehension, observation, or in-world discovery.

The exact serialized contract, table shape, public API and enum spelling remain implementation details to be decided after the event/effect and source contracts are reviewed.

## 4. Independent support and invalidation

Treat each accepted assignment as a distinct support path. Two independent author/import assignments to the same subject/item must remain distinguishable.

Required projection semantics:
1. An assignment is active only while its own event and its required source/authorization basis remain valid.
2. Invalidating one support does not remove another independently valid support.
3. No active support means the item is not returned as currently acquired.
4. A source replacement/invalidation must be represented through an explicit Core-owned validity transition or an existing proven rollback/replay contract. Do not infer source invalidation merely from a changed fact value, a `depends_on` list, or a `causal_links` entry.
5. If Core cannot yet represent source validity and independent supports without a new source lifecycle primitive, keep the acquisition slice blocked and submit that minimal extension for review before coding the query path.

The current rollback implementation is not proof of this general behavior. Production tests must establish it for acquisition effects.

## 5. Trusted assignment entry points

### `author_initial`
Accept only from a trusted authoring/configuration operation that explicitly names the canonical world, canonical subject, item/source, and authorization rule at the declared initial boundary. Ordinary world initialization or fact creation is not sufficient.

### `imported`
Accept only from a trusted importer that validates the package/source identity and explicitly maps the item to the canonical subject. A generic world-pack import that merely creates canonical facts is not sufficient. Current World Pack documentation does not establish a finished production loader, so this path stays unsupported until a real trusted import entry point is identified or implemented.

If there is no supported entry point for either kind, return `unsupported`/non-ready; do not synthesize assignment from model context.

## 6. Read path

Expose a Core-internal operation (method name intentionally undecided) that requires:
- a server-authenticated adapter identity;
- Core-resolved canonical actor binding;
- a bounded, Core-validated purpose (initially `npc_decision`);
- expected `world_revision` and `commit_sequence`.

Within one consistent snapshot it resolves the active acquisition projection, canonical item/source validity, and the existing trusted restriction policy. It returns only a filtered safe envelope. If identity, source, snapshot, completeness, or access policy cannot be proven, return a non-ready/withheld/unsupported result and do not return restricted values.

No raw snapshot fallback. No disclosure-policy duplication. Integrate through the existing #140/#264/#356 dispatch/readiness gate and test the exact serialized model input there.

## 7. Required implementation sequence

1. **Core source audit and source contract:** identify the supported authoring/import entry points; document whether they can express subject-specific assignment. The current audit did not identify a completed production path.
2. **Core effect and validity review:** check the existing effect validator, event commit, replay/reprojection and rollback paths. Specify the smallest event-sourced acquisition effect and the exact source-validity transition before implementation.
3. **Core assignment entry points:** implement only the supported trusted source paths; leave unsupported source types fail-closed.
4. **Core projection and snapshot read:** derive assignments from valid Core events at the existing snapshot cursor, preserving independent supports and status distinctions.
5. **Existing access/dispatch gate:** filter before serialization through the governed boundary; do not add a parallel egress system.
6. **Production tests:** replay/restart, duplicate/conflicting identity, replacement, invalidation, independent supports, actor isolation, snapshot mismatch, read purity, withheld-secret omission from exact model input and diagnostics.
7. **Coordinator review:** update #557 and #140/#251/#252 with commit and test evidence. Do not promote readiness until every mandatory gate passes.

## 8. Explicit non-decisions and stop conditions

This proposal does not approve:
- a public endpoint or caller-controlled assignment API;
- a new standalone acquisition database/table as the source of truth;
- treating ordinary facts, imports, manifests or prompts as acquisition;
- a new parallel revision cursor, source graph, rollback engine or dispatch gate;
- observation, communication, inference, rumor, delivery, comprehension or belief;
- enabling Memory → NPC or changing Host readiness.

**Stop condition:** if Core cannot tie the assignment and its source validity to a trusted source contract and the existing event/replay boundary, do not implement a partial acquisition read. Return explicit unsupported/non-ready and bring the smallest missing Core-owned lifecycle contract back for review.

## 9. Current recommendation

Approve the event-sourced effect + derived projection as the target representation **in principle**, subject to the source-entry and validity review in steps 1–2. This narrows the design choice while preserving the existing Core authority and avoids pretending that the missing importer or lifecycle has already been solved.
