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

If a source cannot be identified or read under the derivation policy, the summary must not imply that the source set was exhaustive.

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

## 3. Source mutation

If a source is corrected, superseded, retracted, deleted, or becomes inaccessible, mark affected summaries stale and queue re-derivation or review. Do not overwrite the old summary as if it had always contained the new version. Keep historical versions and audit according to retention policy.

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