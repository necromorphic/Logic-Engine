# Root Authority v1 — threat model and protocol requirements

**Branch:** `integration/host-core-v1`  
**Status:** DESIGN / NO IMPLEMENTATION AUTHORIZED  
**Date:** 2026-11-11  
**Scope:** Cross-platform, single-user Logic Engine architecture, initially deployed with local SillyTavern. This document defines security boundaries and requirements; it does not select or implement a durable tip store.

## 1. Purpose

Separate the evidence of the latest accepted Root Inventory state from the mutable Host/Core/Provider data it authenticates. The immediate target is detection of accidental or partial local rollback and journal tampering. This is not a claim of protection against a fully privileged local administrator.

The production inventory verifier remains deny-only (`verifyInventorySnapshot: async () => false`). No gate is opened by this document.

## 2. Deployment and trust boundary

Initial deployment assumption: one local user and one Logic Engine installation. Windows is the first investigated platform, not an architectural dependency; Android and other platforms use the same Core contract with their own adapters.

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

## 13. Cross-platform composite Root Authority contract (review resolution)

This section supersedes any earlier implication that a single platform adapter must implement both local-tip operations and external-anchor operations. The architecture is **local Engine + optional external Root Authority**. The Core contract is platform-neutral; Windows, Android, Linux, Apple and external services are adapters, not assumptions embedded in Core.

### 13.1 Composite facade and adapter responsibilities

The Core depends on one `RootAuthorityFacade`, composed from:

- required `PlatformAdapter`: owns the local independently protected tip mechanism and implements `readTip()`, `commitTip()`, and `checkLocal(expected_sequence, expected_tip_hash)`;
- optional `ExternalAdapter`: owns communication with an independent anchor and implements `confirm(...)` and `verifyExternal(...)`.

The external service is not the local journal and MUST NOT replace the local journal commit. The platform adapter MUST NOT provide a fake or stub external confirmation.

Facade semantics:

- `readTip()` delegates to the local adapter and returns the locally stored `installation_id`, `sequence`, and `tip_hash`.
- `commitTip(sequence, tip_hash)` commits locally and returns only after the local commit outcome is known. It does not wait for network confirmation. If an external adapter is configured, the facade records a durable pending-confirmation item for asynchronous reconciliation; it does not put the external request in the chat/generation hot path.
- `verifyTip(expected_sequence, expected_tip_hash)` always calls local `checkLocal`; when an external adapter is configured it also calls `verifyExternal`. The result reports local and external outcomes separately. No-argument verification is forbidden.
- `confirm(sequence, tip_hash, idempotency_key, ancestry_proof)` exists only on the facade when an external adapter is configured. Without one, the capability is explicitly absent; there are no `not_supported` stubs masquerading as successful adapters.
- `getStatus()` returns the facade's normalized combined state, current local tip, local descriptor, optional external descriptor, and optional structured last error.

The external adapter is optional and never required for ordinary chat, generation, NPC response, or local Memory retrieval. An external confirmation requirement applies only to operations explicitly marked `requires_anchor_confirmation: true`.

### 13.2 Versioned capability descriptor

Every adapter MUST return a validated, versioned descriptor. Free-form capability objects and a boolean `available` are not sufficient. Unknown protocol versions, capability names, enum values, missing required fields, or malformed limitations cause the adapter to be rejected as incompatible; Core must not infer stronger guarantees.

Platform descriptor schema (protocol v1):

```json
{
  "protocol_version": 1,
  "adapter_id": "windows-tpm-nv",
  "adapter_version": "1.0.0",
  "adapter_role": "platform",
  "capabilities": {
    "key_protection": "hardware",
    "monotonic_tip": "tpm_nv",
    "survives_full_disk_restore": false,
    "survives_admin_with_code_access": false,
    "external_independence": false
  },
  "limitations": [
    "nv_counter_may_not_be_available_on_all_oem"
  ]
}
```

External descriptor uses `adapter_role: "external"`; it reports its actual independent durability/authority properties and MUST NOT claim to be a platform key store or local journal. Capability enums are fixed:

- `key_protection`: `none | os_user | os_admin | hardware`;
- `monotonic_tip`: `none | os_restricted | tpm_nv | external`;
- `survives_full_disk_restore`, `survives_admin_with_code_access`, `external_independence`: booleans.

These fields are claims bounded by the adapter's documented threat model and evidence, not generic promises. For example, TPM-backed key storage does not imply a monotonic counter; Android Keystore/StrongBox key protection does not by itself imply rollback-resistant tip storage. Adapter limitations must be stable machine-readable identifiers, with optional human-readable detail in diagnostics. Core derives the maximum claimable guarantee from the descriptor and never upgrades it.

### 13.3 Normalized facade result contracts

`verifyTip(expected_sequence, expected_tip_hash)` returns:

```json
{
  "local_match": true,
  "external_match": true,
  "reason": "ok"
}
```

`external_match` is omitted when no external adapter is configured. `reason` is one of `ok | local_mismatch | external_mismatch | external_unavailable | incompatible_adapter | malformed_result`. A local mismatch is never masked by a matching external result.

`getStatus()` returns a single normalized shape:

```json
{
  "state": "in_sync",
  "current_sequence": 42,
  "current_tip_hash": "64-lowercase-hex",
  "local_capabilities": {},
  "external_capabilities": {},
  "last_error": {
    "code": "external_unavailable",
    "message": "Anchor endpoint did not respond"
  }
}
```

Allowed facade states: `in_sync | local_ahead | stale_detected | degraded | uninitialized`. `external_capabilities` and `last_error` are omitted when not applicable. `degraded` means local operation remains available but the configured external guarantee is not currently confirmed. Transport/service unavailability is represented as a structured error, never converted to `in_sync`. The `message` is diagnostic only; policy decisions use the stable `code`.

### 13.4 Offline operation policy and per-operation anchor requirement

Offline behavior is layered, not globally allow-all or globally fail-closed:

| Operation | No external connectivity | External anchor configured and reachable |
|---|---|---|
| Chat, generation, NPC response, local Memory retrieval | Continue within local adapter guarantees | Continue; anchor is not in hot path |
| Ordinary Inventory/state mutation | Commit local tip; queue pending confirmation | Commit locally; reconcile asynchronously at the next configured trigger |
| Periodic reconciliation | Warn and retry under bounded policy | Confirm/verify asynchronously |
| Operation with `requires_anchor_confirmation: true` | Fail-closed | Require a valid external confirmation |
| Restore/recovery requiring an anchor-confirmed tip | Fail-closed | Fail-closed until the anchor verifies the restored lineage and the separately specified recovery workflow authorizes it |

The operation policy is explicit metadata, not a global network mode. Core must reject an operation that requires anchor confirmation when no external adapter is configured, when the anchor is unavailable, or when the expected tip cannot be confirmed. Ordinary chat and local operations do not inherit that requirement.

A local-only installation remains supported, but its reported guarantee is limited to the selected platform adapter's measured capabilities. The product MUST disclose that no independent external rollback authority is present. No local-only adapter may claim external rollback protection.

### 13.5 Cross-platform adapter strategy

The contract is common; platform adapters are independently evaluated:

- Windows: TPM NV counter where safely supported; otherwise an explicitly weaker OS-protected fallback.
- Android: Android Keystore and StrongBox where present; evaluate whether the selected mechanism can protect a monotonic tip, not merely a key.
- Apple platforms: Keychain/Secure Enclave, with separate proof required for monotonic tip semantics.
- Linux: TPM or OS keyring options, each with explicit threat-model limits.
- External: user-selected VPS/cloud anchor implementing the versioned confirmation protocol.

No platform-specific hardware facility is a Core dependency. A platform may expose weaker capabilities or no hardware-backed capability; this is a valid descriptor, not an initialization failure for ordinary local Engine operation.

## 12. Implementation gates and non-regression constraints

1. Complete the threat model and obtain review.
2. Run and record the Windows TPM NV counter spike on the target machine.
3. Finalize the contract, including tip location, ancestry proof format, freshness window, retry policy and credential protection.
4. Select the tip store based on measured results.
5. Implement the smallest adapter/store with only demonstrated guarantees.
6. Run the required tests and record environment and exact commit.
7. Keep `verifyInventorySnapshot: async () => false` unchanged until independent tip authority and production evidence are actually available.

Do not enable Memory → NPC. Do not promote Root Inventory candidate state to authoritative/READY. Do not change Mechanics, Host Lifecycle or migration readiness as a side effect of this work.
