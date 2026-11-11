# Root Authority v1 — threat model and protocol requirements

**Branch:** `integration/host-core-v1`  
**Status:** DESIGN / NO IMPLEMENTATION AUTHORIZED  
**Date:** 2026-11-11  
**Scope:** Local, single-user SillyTavern deployment of Logic Engine. This document defines security boundaries and requirements; it does not select or implement a durable tip store.

## 1. Purpose

Separate the evidence of the latest accepted Root Inventory state from the mutable Host/Core/Provider data it authenticates. The immediate target is detection of accidental or partial local rollback and journal tampering. This is not a claim of protection against a fully privileged local administrator.

The production inventory verifier remains deny-only (`verifyInventorySnapshot: async () => false`). No gate is opened by this document.

## 2. Deployment and trust boundary

Initial product assumption: one local user, one Windows host, one Logic Engine installation, local SillyTavern.

The following components may share a local failure/restore domain:
- Host and its lifecycle journal;
- Core and its local state;
- SQLite Memory Provider and its databases;
- local backups unless explicitly stored and controlled elsewhere.

A second process on the same PC is not an independent trust or restore domain merely because it has a separate process boundary.

## 3. Threats in scope

1. Accidental restoration of an old backup without noticing that it is old.
2. Partial local access that can restore or replace database files but cannot alter the trusted verification code or independently protected tip.
3. Rollback of SQLite/Provider data or inconsistency between Host, Core and Provider after recovery.
4. Tampering with or deletion/reordering of individual journal entries.
5. Replaying a previously valid `confirm` request.
6. Malformed, oversized, mistyped or internally inconsistent responses from an external anchor.
7. Concurrent `confirm` requests from two Core processes for the same installation.
8. Network interception or modification of anchor requests/responses. Authenticated transport and request authentication are required; TLS alone is not the only protocol-level check.
9. Anchor unavailability and delayed synchronization.
10. Anchor rollback or loss of its own durable state, if an external anchor is later deployed.

## 4. Explicitly out of scope

- A fully privileged local administrator who can alter Core code, process memory, OS trust configuration, local secrets, TPM ownership/configuration or outbound network behavior.
- Compromise of the external anchor operator/service, its signing/authentication keys, or its independent backup domain. This requires a separate external-anchor threat model.
- Protection against denial of service, including a local administrator preventing Core from starting or blocking network access.
- Multi-user authorization policy and enterprise audit requirements. The protocol must carry a stable installation identity so that a later multi-installation service does not require a breaking Core contract change.

The system must not claim protection against these out-of-scope threats.

## 5. Independent tip requirement

The journal and its latest accepted tip MUST NOT be stored only in the same SQLite database or the same rollback domain.

The independently protected tip consists of:
- `installation_id`: stable UUID for this Logic Engine installation;
- `sequence`: monotonic integer;
- `tip_hash`: digest of the canonical journal head.

The journal may remain in SQLite. A local journal hash chain detects record tampering/reordering but does not detect rollback of the entire database if the tip is rolled back with it.

Candidate tip stores are not selected yet:
- TPM NV counter/index, only if a Windows implementation is demonstrated to work on target machines without elevation and with understood provisioning/clear behavior;
- DPAPI-protected file or registry value with restrictive ACL, explicitly classified as partial protection against non-admin local access, not full rollback resistance;
- external anchor, if local independent storage is unavailable or insufficient.

A TPM-backed key is not itself a monotonic counter. DPAPI is not protection against a fully privileged administrator. No implementation may silently label either as stronger than its demonstrated properties.

## 6. Windows TPM NV counter spike

Before finalizing the tip-store contract, perform a non-destructive spike on the target Windows machine. Do not clear, reprovision, take ownership of, or modify TPM NV indices during the diagnostic.

Record:
- TPM presence, readiness, version and manufacturer where exposed;
- whether NV counter capability is advertised;
- exact API/library and permissions required;
- whether read/probe works from ordinary userland without elevation;
- whether creating/defining an NV counter would require elevation or administrative provisioning;
- behavior and detection signals for disabled, unavailable, cleared or replaced TPM;
- limitations and portability across OEM/firmware configurations.

A result on one PC is evidence only for that PC/configuration, not a universal Windows guarantee. If no safe, supported non-elevated path is demonstrated, use an explicitly weaker DPAPI/ACL fallback or defer rollback protection pending an external anchor. Do not claim equivalent guarantees.

## 7. External anchor protocol — contract shape

The Core-facing adapter contract is versioned and independent of transport/storage implementation.

Request (protocol v1):

```json
{
  "protocol_version": 1,
  "installation_id": "stable-uuid",
  "sequence": 42,
  "tip_hash": "64-lowercase-hex",
  "previous_anchor": {
    "sequence": 40,
    "tip_hash": "64-lowercase-hex"
  },
  "ancestry_proof": [],
  "idempotency_key": "sha256-of-canonical-installation-sequence-tip"
}
```

The `ancestry_proof` is required when advancing by more than one sequence beyond the anchor's accepted head. It must prove a contiguous hash-chain path from the anchor's current `(sequence, tip_hash)` to the submitted tip. The exact compact proof encoding and maximum size are an implementation decision that must be fixed before coding the adapter. A bare higher sequence and tip hash are NOT sufficient proof of ancestry.

Idempotency key:
`SHA-256(canonical(protocol_version, installation_id, sequence, tip_hash))`.
The anchor must also bind the key to the full canonical request, including ancestry proof. Reuse of the same key with any different request bytes/fields returns `idempotency_mismatch`. Repeating the identical request returns the original outcome and does not create another accepted generation.

Response shape:

```json
{
  "protocol_version": 1,
  "accepted": true,
  "reason": "ok",
  "expected_sequence": 42,
  "expected_tip_hash": "64-lowercase-hex"
}
```

Defined reasons:
- `ok`: accepted or exact idempotent replay;
- `idempotency_mismatch`: same idempotency key reused with different request;
- `rollback_detected`: submitted sequence is lower than the accepted sequence;
- `fork_detected`: same sequence with a different tip, or ancestry proof conflicts with accepted history;
- `out_of_order`: sequence advance lacks a valid contiguous ancestry proof;
- `malformed`: invalid protocol version, field, type, range, digest or proof;
- `authentication_failed`: request authentication failed.

The response must be schema-validated strictly. Unknown reason values, extra/missing required fields, wrong types, non-finite/out-of-range numbers, invalid hashes, oversized payloads and malformed JSON are rejected as protocol errors. They must never be coerced into success. Transport timeout, DNS/TLS failure or connection failure is not an `accepted:false` response; it is a distinct `unavailable` outcome.

The authority processes requests atomically per `installation_id`:
- exact same sequence and tip: idempotent success;
- same sequence, different tip: `fork_detected`;
- lower sequence: `rollback_detected`;
- higher sequence: accept only with valid ancestry proof rooted at the current accepted tip;
- concurrent requests are serialized with compare-and-swap/transaction semantics; no last-writer-wins overwrite is allowed.

Requests require authenticated TLS plus request authentication (for example, HMAC over the canonical request, protocol version, installation identity, nonce and timestamp, or a demonstrably equivalent mechanism). The credential must not be stored in the journal/database. Its protection and rotation mechanism must be specified by the selected tip/anchor deployment. A local secret readable by the same threat actor does not protect against that actor. Replayed identical authenticated requests remain harmless through idempotency; modified requests must fail authentication.

## 8. Anchor states and trigger-specific availability behavior

Local state classification:
- `in_sync`: local and anchor sequence/hash match;
- `local_ahead`: local sequence is ahead and a valid ancestry proof can catch the anchor up;
- `stale_detected`: anchor is ahead of local state, or local history forks from the accepted anchor head;
- `unavailable`: no valid response due to transport/service failure;
- `uninitialized`: no accepted independent tip exists.

Behavior by trigger:

| Trigger | Anchor unavailable | Valid response indicates mismatch |
|---|---|---|
| Core start | Fail-closed for operations requiring authoritative Root Inventory; Core may expose diagnostics/read-only non-protected functions | Fail-closed |
| Explicit restore completion | Fail-closed; restored state is not promoted/used for protected operations | Fail-closed and require recovery procedure |
| Periodic reconciliation | Warn, retain last confirmed state only within an explicitly configured freshness window, retry with bounded backoff | Fail-closed for protected operations |
| Inventory mutation | Commit locally first; report pending confirmation; retry on next trigger. Do not claim new state independently confirmed | Do not promote mutation to authoritative; protected operations fail-closed |
| Local inconsistency detected | Treat as unavailable only if no trustworthy comparison can be made; otherwise classify mismatch | Fail-closed |

A freshness window and retry policy must be specified before implementation. If the window expires, protected operations fail-closed. The product must not silently treat an unavailable anchor as `in_sync`.

## 9. Commit ordering and catch-up

The local journal transaction MUST commit before calling `confirm()`. This avoids advancing the anchor ahead of a local commit that may fail.

A local commit followed by a crash before anchor confirmation produces `local_ahead`, which is a recoverable pending-confirmation state only when the local journal can prove an unbroken ancestry path from the last anchor-confirmed tip.

An anchor ahead of local state is never ordinary catch-up. It indicates local rollback, loss of local journal data, or anchor inconsistency and requires fail-closed handling and an explicit recovery procedure.

The authority must never accept a higher sequence solely because it is numerically higher.

## 10. Restore procedure scope

A full authorized restore workflow is **out of scope for the first implementation block**. The initial block must not pretend it can reliably infer that arbitrary files were restored from backup.

Before restore integration is enabled, a separate recovery design must define:
- an explicit trusted restore marker/event produced by the supported recovery workflow;
- how Core authenticates and consumes that marker;
- who/what authorizes recovery and what evidence is retained;
- how the restored journal proves ancestry or is re-enrolled;
- behavior when the anchor is unavailable (fail-closed for protected operations);
- how ordinary startup is distinguished from restore completion.

Until that workflow exists, the restore trigger is specified but not operationally enabled. Manual file replacement is not a supported recovery procedure.

## 11. Required tests before any rollback-protection claim

- normal single-step advancement;
- exact idempotent replay;
- same key with changed request;
- lower sequence rollback;
- same-sequence different-tip fork;
- higher sequence with valid and invalid ancestry proofs;
- concurrent confirms from two Core processes;
- local commit followed by crash before confirmation;
- local database rollback while independent tip remains ahead;
- Core-only and Provider-only restore;
- malformed/oversized/wrong-type response rejection;
- request tampering/authentication failure and replay;
- anchor outage at each trigger;
- anchor rollback/loss simulation;
- TPM unavailable/disabled/cleared behavior on supported test configuration;
- explicit restore workflow tests, once that workflow is implemented.

No test result may be inferred from a fixture-only mock when the claim concerns real TPM, OS key protection, durable storage or external anchor behavior.

## 12. Implementation gates and non-regression constraints

1. Complete the threat model and obtain review.
2. Run and record the Windows TPM NV counter spike on the target machine.
3. Finalize the contract, including tip location, ancestry proof format, freshness window, retry policy and credential protection.
4. Select the tip store based on measured results.
5. Implement the smallest adapter/store with only demonstrated guarantees.
6. Run the required tests and record environment and exact commit.
7. Keep `verifyInventorySnapshot: async () => false` unchanged until independent tip authority and production evidence are actually available.

Do not enable Memory → NPC. Do not promote Root Inventory candidate state to authoritative/READY. Do not change Mechanics, Host Lifecycle or migration readiness as a side effect of this work.
