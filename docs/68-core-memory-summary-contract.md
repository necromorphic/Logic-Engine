# Core Memory summary and compression contract

Status: proposed. Summaries are derived, lossy records and never replace their sources by default.

## 1. Required summary metadata

Every durable summary must record:
- summary ID and version;
- declared source record IDs and source versions (a manifest, not only a count);
- world ID and any applicable source snapshot cursor;
- covered time interval or explicit unknown boundaries;
- summary method/producer and its trusted execution identity where available;
- payload schema version;
- known omissions, unresolved conflicts, and limitations;
- derivation status and lifecycle state;
- links to prior summary versions if recomputed.

If a source cannot be identified or read under the derivation policy, the summary must not imply that the source set was exhaustive. Record the policy/version used to authorize source access where available; authorization at derivation time is not a permanent grant to every later reader.

## 2. Semantic preservation rules

Compression must not:
- promote an assertion, rumor, or hypothesis into a confirmed fact;
- turn absence of mention into evidence that something did not occur;
- merge two conflicting accounts into a fabricated consensus;
- erase the distinction between event time and record creation time;
- remove source attribution where it materially affects interpretation;
- invent missing causal links, intent, consent, or psychological explanations;
- make a summary more certain than its source evidence permits.

When sources conflict, preserve the conflict explicitly or abstain from summarizing that claim. The summary may state that a source reports X and another reports Y; it must not choose a winner without a separate trusted policy and evidence.

## 3. Source mutation and access inheritance

If a source is corrected, superseded, retracted, deleted, or becomes inaccessible, mark affected summaries non-current and queue re-derivation or review. Do not overwrite the old summary as if it had always contained the new version. Keep historical versions and audit according to retention policy.

**Conservative default until a Core visibility/declassification policy is approved:** a derived summary must not be exposed to a reader who would be denied access to a source whose protected content materially contributes to that summary. Apply the most restrictive applicable source constraint (equivalent to an intersection of source permissions), and withhold/quarantine the summary if source permissions or lineage cannot be checked. This is a safety default, not a claim that the current runtime implements access inheritance.

If a source's access is revoked after summary creation, do not assume filtering the original source hit is sufficient: a summary may disclose the same protected information. Withhold the affected summary from the newly unauthorized reader until it is re-derived using only sources that reader is allowed to use, or an explicit trusted policy authorizes a reviewed declassification. Re-derivation must produce a new version and manifest; it must not silently broaden access or rewrite history. Access changes for one reader need not globally retract the summary from readers who remain authorized, unless the governing policy requires it.

A summary derived from another summary must retain the transitive source lineage or an immutable link to a manifest that can resolve the full lineage. Repeated compression must not sever the chain to original material.

## 4. Validation and loss tracking

The summary producer must return a structured envelope rather than bare prose. Validation should check:
- every cited source is in the declared input set;
- all source IDs/versions resolve within the correct world;
- time coverage is valid and explicit;
- unresolved conflicts and unknowns remain represented;
- no unsupported canonical claims are introduced;
- output and source counts stay within declared limits;
- source links survive serialization and retrieval.

These checks cannot prove that a language model preserved every nuance. Treat semantic fidelity as a tested risk, not a mathematical guarantee. High-impact summaries may require deterministic extraction, review, or source-grounded validation.

## 5. Retention and deletion

Do not delete originals merely because a summary exists. Physical erasure, legal/privacy retention, and storage-budget policy are separate decisions. If source deletion is required, record that the summary's evidence base is incomplete or unavailable and apply the defined retention semantics; do not continue claiming fully inspectable lineage.

## Current-main runtime checkpoint — Issue #129, 2026-10-24

The authoritative current-main runtime audit and cross-owner boundary decisions are maintained in [docs/73-memory-current-main-core-boundary-handoff.md](73-memory-current-main-core-boundary-handoff.md), audited against `main` at `c8b416440f5360f812f38bdb03644e79f52b0f1d`. This section supersedes historical PR-state statements above; it is a pointer, not a second copy of the audit.

Read authorization remains restricted and default-deny unless a trusted host policy is explicitly configured; no production Memory read policy or Memory record/retrieval/index/summary runtime is approved by this documentation. The handoff contains the current runtime classification, fail-closed boundaries, owners, and acceptance tests. No new runtime API, schema, store, outbox, cursor, or permission policy is authorized here; Issues #70 and #77 remain separate and open.