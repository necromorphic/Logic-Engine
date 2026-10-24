# Core Memory architecture

Status: proposed subsystem contract; not runtime behavior. Target base: `main` as inspected on 2026-10-24. This document must be reviewed against concurrent Core/NPC/Relations work before implementation.

## 1. Purpose

Core Memory stores durable, attributable representations of information and provides bounded retrieval. It is not a second canonical world state, an NPC belief engine, or a relationship/personality evaluator.

The subsystem is optional. Core operations that do not request memory must continue to work when the subsystem is not configured. A memory-dependent operation must return an explicit unavailable/error result rather than silently substituting an empty result.

## 2. Ownership

- **Core owns:** canonical entities/facts/events, world revisions, commit sequence, mutation authorization, event validity, rollback decisions, and canonical audit.
- **Memory owns:** memory-record identity, record versions, memory lifecycle, source links, derived summaries, retrieval indexes, retention policy, memory-operation audit, and reconciliation of memory projections with their authoritative inputs.
- **NPC owns:** acquisition/delivery semantics for a particular actor, personal knowledge, beliefs, inferences, and whether evidence changes those states.
- **Relations owns:** relationship domain semantics and evaluation.
- **Personality owns:** personality semantics and psychological interpretation.
- **Adapters own no authority:** they may request operations through approved services but may not read storage directly or assert trusted provenance through caller-supplied labels.

Memory may store pointers to Core events/facts and preserve source evidence, but it must not promote a memory record into a canonical event or mutate canonical projections.

## 3. Information classes

Use one versioned record envelope initially, with a typed payload and policy rather than separate stores for every term:

1. **Canonical-source reference:** pointer to a Core event/fact/revision; the canonical source remains authoritative.
2. **Evidence/claim:** a preserved statement, observation, or artifact, including who asserted or observed it and how it was obtained.
3. **Episode:** a bounded representation of a particular interaction, normally linked to events/messages and evidence.
4. **Period summary:** a derived record covering a declared interval and source set; lossy by definition.
5. **Search projection:** full-text/vector/keyword metadata derived from records; disposable and rebuildable.
6. **Working data:** transient request/generation context; not durable unless an explicit write policy promotes it.

These classes do not imply equal truth status. Type and epistemic status are distinct dimensions.

## 4. Trust and threat model

Assume record content, source labels, timestamps, embedding text, and requested recipients may be malicious or mistaken when supplied by an LLM, adapter, or untrusted caller. Trusted identity and authority must be derived by the host/service boundary. A content hash proves byte equality only; it does not prove truth, authorship, or that content was shown to a model.

Required defenses:
- world-scoped identifiers and mandatory world scoping on every read/write;
- authorization before content is returned, including search hits and snippets;
- trusted provenance metadata assigned/verified outside untrusted payload fields;
- explicit distinction between source assertion and independently verified canonical source;
- bounded query/result sizes and deterministic tie-breaking;
- index results revalidated against authoritative record state and access policy;
- no implicit canonical writes during record creation, search, summarization, or reindexing;
- audit for material mutations and administrative deletion;
- fail-closed behavior when identity, policy, source validity, or storage integrity cannot be established.

## 5. Core consistency model

A record can refer to a canonical world revision and a set of source IDs. Canonical source changes are observed through an explicit reconciliation mechanism. Until reconciliation completes, the record/index may be stale and must be marked as such; it must not be described as fully current.

The initial design should prefer transactional authoritative record storage plus rebuildable indexes. A vector index is an optimization, never the authority. Outbox/change-log implementation is a decision for repository audit; do not invent an event delivery guarantee that the current Core does not provide.

## 6. Initial non-goals

No automatic NPC belief update; no universal numeric confidence score; no automatic truth arbitration; no automatic deletion of source evidence after summarization; no commitment to a particular embedding provider or vector database; no claim of causal completeness beyond the current Core contract; no public raw-memory endpoint until a trusted visibility policy exists.

## 7. Implementation gate

Before runtime work, confirm the storage transaction boundary, canonical event/revision hooks, available authorization service, repository migration conventions, and NPC acquisition contract. Open PRs are proposals, not integrated dependencies. Any new API/schema or Core mutation semantics require review by the owning block.