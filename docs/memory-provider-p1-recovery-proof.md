# Memory Provider P1 recovery proof

Status: executable recovery/failure proof added on the P1 branch stacked on the real Provider/Core adapter work in PR #845. This document describes test evidence only; it does not enable production Memory → NPC dispatch.

## Recovery scenarios

| Scenario | Fault injection / sequence | Required result |
|---|---|---|
| Revoke → restart → re-grant | Capture a retrieval candidate, revoke its exact record grant, reopen the file-backed Provider, reconcile while revoked, then re-grant and reconcile again. | Restart begins non-ready; revoked retrieval is withheld; re-grant advances the durable authorization generation by two transitions; the pre-revoke candidate is rejected while the fresh generation is accepted. |
| Revoke during index recovery | Pause reconciliation inside awaited source validation and revoke the exact grant through a second Provider connection sharing the coordinator. | The in-flight reconciliation detects Provider state/data change and cannot publish `ready/current`. Retrieval returns non-ready. |
| Corrupt grant generation | Replace the durable `authorization_generation` with a non-numeric SQLite value after the index is current. | Consumer rejects the malformed candidate envelope; no candidate, admitted content, record identity, source content, or rejected-item diagnostics escape. |
| Core/Provider snapshot mismatch | Supply a Provider snapshot cursor that differs from the actual Core snapshot while source validation still reads the real Core engine. | Consumer rejects the mismatched snapshot as non-ready; no candidate, admitted content, record identity, source content, or rejected-item diagnostics escape. |

## Disclosure assertions

Every consumer-facing failure scenario asserts:
- `status === 'non_ready'`;
- empty `candidates` and `admitted`;
- no source content or record reference in the serialized result;
- no diagnostic, snippet, rejected-count, denied-count, withheld-count, or filtered-count fields.

The revoke/restart scenario separately asserts both restart-stale and post-reconciliation-withheld failures before re-grant.

## Boundaries and exclusions

This proof does not implement or enable:
- Final-Send;
- Provider Relay;
- ST Extension Gateway changes;
- production Memory → NPC dispatch.

The PR is separate from #845 and is stacked on the #845 implementation branch so the recovery tests execute against the real file-backed Provider/Core adapter without adding these changes to #845 itself. No cross-database atomic dispatch guarantee is claimed.
