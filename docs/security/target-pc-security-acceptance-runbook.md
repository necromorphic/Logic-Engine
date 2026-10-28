# Security blocker — target-PC acceptance runbook

**Status:** preparation for target-PC validation; not a pass report and not production approval.

**Related:** [Issue #264](https://github.com/necromorphic/Logic-Engine/issues/264), [ACL candidate PR #468](https://github.com/necromorphic/Logic-Engine/pull/468), [single-writer boundary](core-db-single-writer-deployment-boundary.md), [protected disclosure policy](product-security-protected-memory-disclosure-policy.md).

## Rules before running

- Do not run an ACL apply command until the target paths and three distinct service identities are confirmed and a recovery window is available.
- Do not run this against a live database until a verified backup and rollback procedure exist. First run on a disposable copy.
- Do not paste credentials, raw prompts, Memory text, database contents, or secret-bearing environment output into the evidence report.
- A CI fixture or a same-user process test is not a target-PC isolation pass.
- Keep Memory→NPC disabled and fail-closed throughout validation.

## Gate A — inventory only

Run elevated Windows PowerShell 5.1 from a clean checkout containing the reviewed ACL candidate script from PR #468. Do not apply changes yet.

```powershell
$PSVersionTable.PSVersion
whoami /all
Get-CimInstance Win32_OperatingSystem | Select-Object Caption, Version, OSArchitecture
Get-Service | Where-Object { $_.Name -match 'LogicEngine(Core|Provider|Gateway)' } |
  Select-Object Name, Status, StartType
```

Record the exact repository commit, script hash, Windows build, target DB path, Core/Provider/Gateway service names, each service's configured identity, and the evidence output path. Redact usernames only if they contain personal information; preserve stable role labels and SIDs needed to compare identities.

Confirm before proceeding:
- Core, Provider, and Gateway use distinct, resolvable service identities.
- The Core DB is in a dedicated local directory.
- The directory has no unrelated files, junctions, symlinks, or other reparse points.
- Backup and restore have been rehearsed on a copy.
- The evidence destination is outside the protected DB directory.

## Gate B — ACL candidate plan

Use the exact reviewed script and parameter names from PR #468. First run without `-Apply` and save the plan/evidence outside the DB directory.

```powershell
.\scripts\security\Set-CoreDbAclBoundary.ps1 `
  -CoreServiceName '<CoreServiceName>' `
  -ProviderServiceName '<ProviderServiceName>' `
  -GatewayServiceName '<GatewayServiceName>' `
  -CoreDbPath '<absolute path to dedicated Core SQLite file>' `
  -EvidencePath '<absolute path outside DB directory>\core-db-acl-before.json'
```

Review the generated plan, target path chain, service SIDs, existing SDDL, directory contents, and proposed ACL. Stop on any mismatch. Do not proceed merely because the script exits successfully.

## Gate C — apply to a disposable target first

Only after Gate B has been reviewed, use a disposable DB directory and a recoverable test environment. Apply explicitly:

```powershell
.\scripts\security\Set-CoreDbAclBoundary.ps1 `
  -CoreServiceName '<CoreServiceName>' `
  -ProviderServiceName '<ProviderServiceName>' `
  -GatewayServiceName '<GatewayServiceName>' `
  -CoreDbPath '<absolute path to disposable Core SQLite file>' `
  -EvidencePath '<absolute path outside DB directory>\core-db-acl-apply.json' `
  -Apply -Confirm:$false
```

The command's reported ACL shape is not sufficient. Run the access matrix below under the actual service identities (for example, through a controlled scheduled task or service-owned test harness). Do not temporarily grant broad rights just to make a test executable.

| Operation | Core identity | Provider identity | Gateway identity | Result required |
|---|---|---|---|---|
| Open/read Core DB | Allow | Deny | Deny | Exact |
| Write/commit Core DB | Allow | Deny | Deny | Exact |
| Create/replace/rename/delete DB file | Only as required by Core operation | Deny | Deny | Exact |
| Read/write/create/delete `-wal`, `-shm`, `-journal` | Allow as required | Deny | Deny | Exact |
| Access through parent/alternate path or reparse point | Only canonical approved path | Deny | Deny | No bypass |
| Access Provider's own DB | Not required | Allow | Not required | Provider remains functional |
| Restore/replace DB from backup | Approved Core maintenance path only | Deny | Deny | No rollback bypass |

For each row, record the actual identity/SID, command or harness version, expected result, observed result, exit code, timestamp, and whether the operation changed any data. A denial must be an OS-enforced denial, not an application-level refusal.

## Gate D — recovery and anti-rollback

On a disposable copy:
1. Commit a known non-sensitive canonical test event through the Core-owned write path.
2. Stop/restart Core and verify recovery of that event.
3. Restore an older DB snapshot using the documented maintenance path.
4. Verify that the system detects stale/older accepted state and refuses protected disclosure.
5. Verify Provider and Gateway cannot replace the Core DB or its accepted-state authority.

**Current limitation:** ACLs alone cannot prove restore-resistant accepted-head authority. If no separately reviewed mechanism and executable test exist, record this gate as **BLOCKED**, not PASS.

## Gate E — protected egress and revocation ordering

This gate cannot be passed by ACL testing or a mock-only unit test. It requires an instrumented recording upstream endpoint and the actual final gateway/transport seam.

Required deterministic cases:
- Gateway offline, timeout, bad authentication, unknown route, or malformed authorization state → zero upstream requests.
- Provider/Core unavailable or readiness lost before dispatch-start → zero upstream requests.
- Revocation, source invalidation, scope change, or denial wins the shared serialization point before dispatch-start → zero upstream requests.
- Dispatch-start wins first → record in-flight; later revocation does not claim to recall bytes already handed to transport.
- Timeout/crash after dispatch-start with ambiguous delivery → no automatic retry.
- Every protected route is exercised; direct-provider and unsupported-route attempts → zero protected egress.

**Current limitation:** until Core + Host identify one real serialization authority tied to the actual upstream handoff and enumerate every relevant route, mark this gate **BLOCKED / NO IMPLEMENTED END-TO-END PROOF**. Do not invent a successful test from a preflight boolean, process-local lock, or timing-based race.

## Evidence packet to return

Return only:
1. Commit SHA and hash of the reviewed script.
2. Windows version/build and PowerShell version.
3. Role → service name → SID mapping (no passwords/tokens).
4. Sanitized before/after ACL evidence and exact commands.
5. Matrix rows with PASS / FAIL / BLOCKED and exit codes.
6. Recovery/restore result.
7. Recording-upstream request count for each egress case, with no payload content.
8. Any failure output after removing secrets and personal data.

Do not mark the global Security blocker closed unless every required gate has evidence and the owners accept it. Until then: **Core policy DENY / NON_READY; Memory→NPC DISABLED / FAIL-CLOSED.**
