# Security decision: restore-resistant accepted-head anchor

Status: **Security/Deployment decision candidate — draft for independent review; not production approval.**

Date: 2026-10-28  
Owner: Security/Deployment

## Decision

Use a **remote, authenticated, signed append-only monotonic authority** as the anti-rollback anchor for the accepted Core/Provider state. Keep the existing local Authority SQLite database as a cache/operational projection only; it is not the root of trust.

This follows Core's decision in issue #140 that the authority must survive a coordinated restore of Core and Provider storage. A local file, separate Windows ACL, registry value, or SQLite database is not sufficient against restoration of the whole local state. A TPM-backed anchor is a viable later deployment-specific alternative, but requires target-hardware provisioning and recovery guarantees that are not yet evidenced. The remote anchor is selected because it remains outside the PC's backup/restore domain and can be tested independently.

**Availability trade-off:** if the remote authority cannot be authenticated or reached, returns an unknown installation/epoch, has a signature/sequence mismatch, or cannot prove the current accepted head, the installation is NON_READY and sends nothing. There is no local fallback and no “temporarily trust the cache” mode.

## Trust boundaries

- Core owns canonical source mutations and its per-entity source-version ledger.
- Provider preserves Core's opaque source-version token and must not create source authority.
- Gateway is the sole outbound dispatcher and checks the exact accepted state and request/candidate digest at the final dispatch boundary.
- Remote Anchor owns the monotonic per-installation sequence and append-only signed records. Its storage, credentials, backups and administrative access are outside the Core/Provider host restore domain.
- Local Authority SQLite is not authoritative if it disagrees with the remote anchor.
- The shared coordinator lock serializes compliant local operations only; it is not an anti-rollback anchor and is not a substitute for final-send serialization.

## Minimum remote record and protocol contract

Each signed record must bind at least:
- immutable installation identifier;
- authority epoch/key identifier;
- strictly increasing sequence number;
- previous record digest;
- accepted Core source-ledger/inventory head digest and schema/contract version;
- Provider compatibility/readiness digest required by the accepted contract;
- record type (ADVANCE, RECOVERY, or REENROLL) and explicit recovery reason where applicable.

The remote service must:
1. authenticate the caller as the enrolled installation/service, not trust caller-supplied installation labels;
2. expose a compare-and-append operation requiring the expected prior sequence and digest;
3. serialize concurrent appends and reject replay, duplicate sequence with changed content, stale expected heads, wrong installation/epoch, and broken previous-digest links;
4. return a signed receipt binding the exact accepted record;
5. provide authenticated current-head verification and enough signed history to reconcile after restart/gap;
6. keep append history and signing authority outside local Core/Provider backups and deny local clients any administrative delete/truncate/restore operation;
7. make key rotation, loss, remote backup restore, and re-enrollment explicit audited state transitions. A restored remote service must itself detect rollback or remain unavailable; merely moving its SQLite database to another server is not sufficient.

Transport should use TLS with service authentication and pinned/managed trust roots. The signing key must not be stored in the Core/Provider database or their backup roots. Credentials must be least-privilege: ordinary installation credentials may append only valid next records for their enrolled installation, never erase history, lower sequence, change installation identity, or re-enroll.

## Mutation ordering and crash semantics

A source-validity-changing operation must participate in the same enforced order as dispatch-start and revocation. The operation must reserve/append its next monotonic authority record **before** committing the local mutation that the record represents. This makes the authority sequence advance first; if the local commit then fails or the process crashes, the local state is behind the anchor and must remain NON_READY until verified reconciliation/recovery. This deliberate fail-closed availability cost prevents an old local backup from appearing current.

No operation may dispatch using a local state whose head is behind, ahead of, or inconsistent with the remote accepted head. If a mutation cannot establish the required authority order, it must not be treated as committed-and-current for Memory→NPC use.

Before dispatch-start, while holding the approved serialized order, Gateway must verify:
- current remote accepted head/epoch and signed chain;
- local Core ledger and complete source lineage exactly match that accepted head;
- exact Core-issued source tokens, source currentness/retraction state, recipient/subject, purpose, fields, Provider grants/readiness;
- digest of the exact serialized request and exact admitted candidate/source-version set;
- durable DISPATCH_STARTED record binds those exact bytes and candidates.

Only after the durable start record is committed may the single approved transport be invoked. If dispatch-start wins the order, later revocation is in-flight; an ambiguous post-start result is durable UNKNOWN and is never automatically retried. If revocation/source invalidation/readiness loss wins first, zero outbound calls. If the remote anchor cannot be verified, zero outbound calls.

## Recovery policy

- **Local Core/Provider restore to an older mutually consistent backup:** compare local head with the independently retained remote head; mark NON_READY and refuse dispatch. Reconcile from a verified canonical source/journal or perform an audited recovery that advances state; never lower the remote sequence.
- **Remote outage:** NON_READY; no local cache fallback.
- **Remote history/signature/epoch mismatch or remote restore suspected:** quarantine the installation and remain NON_READY until independent remote integrity is established.
- **Lost local state:** no automatic re-enrollment. Require separately authenticated, audited recovery approval and a new epoch/sequence transition.
- **Irrecoverable history:** fail closed. Recovery may sacrifice availability; it must not silently reset monotonic state.

## Required acceptance tests

1. Advance accepted state A→B; restore both Core and Provider to old, internally consistent backup A; B remains authoritative, A is rejected, and no outbound call occurs.
2. Replay an old signed receipt, submit stale expected sequence/digest, submit duplicate sequence with changed content, and submit wrong installation/epoch: all rejected.
3. Race two appends: exactly one next sequence succeeds; no fork or sequence reuse.
4. Kill process at every boundary: before remote append, after append/before local commit, after local commit/before receipt persistence, and during recovery. Any mismatch remains NON_READY; recovery never lowers remote sequence.
5. Remote outage, invalid certificate, invalid signature, truncated/reordered history, key rotation mismatch and wrong installation all fail closed.
6. Restore the remote service's own storage from an older backup: service must detect rollback using an independent anchor or refuse service. A second ordinary database copy is not sufficient.
7. Barrier-controlled source mutation/revocation versus dispatch-start proves one total order. A mutation that wins first causes zero transport calls; dispatch-start that wins first produces at most one transport invocation and UNKNOWN/no automatic retry after ambiguity.
8. Test the real integrated Host/Gateway send path, not only a mock transport or unit helper. Bind the durable start record to exact serialized request bytes and candidate/source-token set.
9. Verify append-only history, credentials, backup/restore and signing keys are administered independently of the Core/Provider host and backup domain.

## Why the alternatives are not selected as the default

- **Separate local SQLite/ACL or registry state:** does not survive an administrator-level coordinated restore or full-system rollback; useful only as defense in depth.
- **TPM NV monotonic counter:** can provide strong local hardware anchoring, but needs target-specific provisioning, availability and recovery tests. Keep as a future alternative if the deployment explicitly accepts hardware coupling and the tested TPM design covers all relevant rollback cases.
- **Remote signed append-only authority:** selected because its state can be independently retained beyond the local restore domain. This still requires the remote service itself to have rollback-resistant storage/operations; “remote” alone is not proof.

## Scope and non-claims

This document selects the Security/Deployment design direction; it does not implement or deploy the remote service, prove the current Gateway path is serialized, or authorize production. A service API/schema, operational custody, remote anti-rollback, Core mutation integration and Gateway final-send integration require separate exact-diff implementation and tests.

Until the real integrated restore and dispatch tests pass: production **NON_READY**, Memory→NPC **DISABLED / FAIL-CLOSED**.
