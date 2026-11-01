# Deployment Contracts v1

Status: **Phase 0 draft contract**  
Tracking: [Issue #766](https://github.com/necromorphic/Logic-Engine/issues/766)  
Architecture baseline: [95-universal-deployment-security-architecture.md](95-universal-deployment-security-architecture.md)

## 1. Scope

This document makes the Phase 0 architecture concrete enough to review before runtime implementation. It defines two versioned JSON contracts:

- `schemas/deployment-manifest.schema.json` — deployment-owned desired configuration.
- `schemas/deployment-report.schema.json` — observed startup/security assessment.

The schemas are initial v1 drafts. They are not yet wired into runtime startup and do not establish that any platform capability is implemented.

Windows and Linux are the only supported platform values in this phase. Unknown platforms are rejected. A future platform is added by extending the adapter registry and platform policy in a reviewed schema revision; macOS is not accepted as supported by v1.

## 2. Ownership and trust boundaries

| Artifact | Owner | Trust meaning |
|---|---|---|
| Deployment manifest | Deployment operator / installer | Declares intended topology and policy; not proof of enforcement |
| Platform adapter result | Current OS adapter | Reports observations and evidence; must not claim unverified properties |
| Deployment report | Runtime diagnostics | Snapshot of observed status and failed/degraded gates |
| Application policy evaluator | Logic-Engine | Decides whether a component/feature may start |
| Backup freshness anchor | Separate recovery authority | Must not be restorable from the same backup set it validates |

The manifest is configuration and therefore untrusted until schema validation, path resolution and policy checks succeed. A manifest cannot grant privileges, disable required gates or convert missing evidence into PASS.

## 3. Manifest v1 semantics

The manifest schema defines:
- stable deployment ID;
- profile: `portable-desktop` or `hardened-service`;
- explicitly supported platform families;
- component declarations and their execution mode;
- logical resource declarations and access intents;
- symlink/reparse policy;
- backup policy;
- secret-provider preference.

### 3.1 Component IDs and security domains

Component IDs are stable logical names, not OS usernames. Security domains express intended trust separation. In Portable mode, several components may map to one process and one OS identity; the report must expose that fact. In Hardened mode, a declared separation is not accepted until the adapter verifies distinct effective identities and denied cross-domain access.

The manifest does not allow arbitrary command lines, executable paths or shell fragments. Process launch configuration belongs in a separately permissioned deployment supervisor configuration and must be reviewed before implementation.

### 3.2 Resource path semantics

A resource path has one of three sources:
- `deployment-root-relative`: resolved below the selected deployment root;
- `explicit-config`: supplied by trusted deployment configuration;
- `platform-default`: resolved by the adapter using documented OS conventions.

The schema's `value` is a path expression, not a pre-approved absolute path. Resolution must canonicalize it, inspect every existing parent component, detect link/reparse traversal and compare it against all other resources. No file is created during the pure resolution/diagnostic stage.

Access lists contain logical component IDs or declared security-domain IDs. They are not raw OS ACL entries. The adapter maps them to native identities and verifies effective access.

The access intents deliberately include create, append, replace, delete and rename. SQLite and atomic file replacement may require parent-directory rights that are not represented by a simple read/write bit on the database file.

### 3.3 Backup and secrets

A resource marked `separate-vault` must resolve outside the runtime-writable data tree. A backup freshness anchor must be independently protected; a second file under the same writable identity is not independent.

Secret provider preferences are capability requests, not guarantees. If an OS store or managed injection source is unavailable, the runtime may use a private-file provider only if its effective permissions are verified and the deployment policy permits it. Environment fallback must be explicit and reported as a limitation.

## 4. Platform adapter API — proposed TypeScript surface

The following is a platform-neutral interface sketch. It is not yet a runtime implementation.

```ts
export type CapabilityStatus =
  | "PASS"
  | "FAIL"
  | "UNSUPPORTED"
  | "NOT_TESTED"
  | "DEGRADED";

export interface CapabilityEvidence {
  id: string;
  status: CapabilityStatus;
  required: boolean;
  evidenceSource: string;
  observedSummary?: string;
  adapterVersion: string;
  limitations: string[];
}

export interface PlatformIdentity {
  platform: "windows" | "linux" | "unknown";
  release: string;
  architecture: string;
  effectiveUser: string;
  effectiveGroups: string[];
  elevated: boolean;
}

export interface PathInspection {
  canonicalPath: string;
  exists: boolean;
  filesystem?: string;
  owner?: string;
  linkType: "none" | "symlink" | "reparse" | "unknown";
  access: Record<string, CapabilityStatus>;
  evidence: CapabilityEvidence[];
}

export interface PlatformSecurityAdapter {
  identifyPlatform(): Promise<PlatformIdentity>;
  inspectPath(path: string, intents: string[]): Promise<PathInspection>;
  ensurePrivateDirectory(path: string, policy: "private-owner" | "service-domain"): Promise<CapabilityEvidence>;
  ensurePrivateFile(path: string, policy: "private-owner" | "service-domain"): Promise<CapabilityEvidence>;
  inspectOpenHandles(paths: string[]): Promise<CapabilityEvidence[]>;
  inspectSecretCapabilities(): Promise<CapabilityEvidence[]>;
  inspectServiceCapabilities(): Promise<CapabilityEvidence[]>;
  collectEvidence(): Promise<CapabilityEvidence[]>;
}
```

Contract rules:
1. Adapter operations return evidence/status, not optimistic booleans.
2. Missing platform support returns `UNSUPPORTED`; skipped inspection returns `NOT_TESTED`.
3. Adapter code never returns secret material.
4. Adapter code does not silently repair ownership/permissions during inspection.
5. Mutating `ensure*` operations are invoked only in an explicit install/provision step, not ordinary read-only diagnostics.
6. All paths passed to the adapter have already been classified by the path registry; adapter still validates canonicalization and link safety to prevent TOCTOU/path traversal.
7. Adapter-specific native objects must not escape the adapter boundary.

The interface may be split into smaller capability interfaces during implementation, but the platform-neutral semantics and status vocabulary remain stable.

## 5. Policy evaluation and startup gates

A required capability is satisfied only by PASS. For required capabilities:
- FAIL blocks the affected component/feature;
- UNSUPPORTED blocks the affected component/feature;
- NOT_TESTED blocks the affected component/feature;
- DEGRADED blocks features whose policy requires the missing guarantee, otherwise marks the deployment degraded.

Optional capabilities may be absent without blocking unrelated features. The evaluator must retain the relationship between a capability, its evidence and every gate it affects.

Portable mode does not waive integrity, authentication, path safety or fail-closed requirements. It only accepts a declared single-process trust boundary and reports the weaker isolation model. Hardened mode additionally requires enforceable OS identity and filesystem boundaries for each declared separation.

## 6. Deployment report v1 semantics

The report is a safe diagnostic artifact. It must not contain:
- secret values, API tokens or environment dumps;
- raw configuration contents;
- chat or world data;
- database rows or message text;
- unredacted sensitive command lines.

It may contain canonical paths only if the operator explicitly enables path disclosure; otherwise paths should be redacted to stable logical resource IDs and safe path classes.

`overall_status` is an aggregate:
- PASS: every required gate passed;
- FAIL: a required check found a violation;
- UNSUPPORTED: a required capability cannot be provided;
- NOT_TESTED: required evidence is missing;
- DEGRADED: no required gate failed, but at least one optional guarantee is reduced.

The report must not collapse FAIL, UNSUPPORTED and NOT_TESTED into a generic warning. The exact failed gate remains visible.

## 7. Initial logical capability IDs

The following IDs are proposed for consistent policy and tests:

- `platform.identity.inspect`
- `filesystem.path.canonicalize`
- `filesystem.links.inspect`
- `filesystem.access.effective`
- `filesystem.private-directory.create`
- `filesystem.open-handles.inspect`
- `process.identity.separate`
- `process.supervisor.available`
- `ipc.peer-authentication`
- `sqlite.sidecars.permissions`
- `sqlite.locking.lifecycle`
- `secrets.os-store.available`
- `secrets.private-file.verified`
- `backup.integrity.verify`
- `backup.freshness-anchor.available`
- `backup.restore.authorization`

Capability IDs are stable public contract identifiers once adopted. Changes require a schema/contract version decision and migration notes.

## 8. Phase 1 policy decisions

The following defaults are fixed for the first implementation. They are conservative and may be changed only through a versioned contract review.

1. **Shared security domains:** multiple components may explicitly declare the same `security_domain`. The manifest makes the shared boundary visible; it does not claim isolation between members.
2. **Environment secrets:** environment fallback is denied unless both `allow_environment_fallback: true` and `environment-compat` are explicitly declared. New deployment manifests must not silently inherit environment fallback.
3. **Portable mandatory resources:** the first production manifest must declare the Core database, Coordinator database, Host-version ledger and trusted World Pack catalog. Provider stores, caches and logs are separately classified; caches may be rebuildable. This list is a deployment-template requirement, not a claim that current startup has already migrated to the manifest.
4. **Backup freshness:** Portable/Desktop may run without an independent freshness anchor only with an explicit anti-rollback limitation. Hardened/Service cannot pass its backup/recovery gate without an independently protected freshness anchor.
5. **Service integration:** use a generic supervisor/process contract. Windows Service Control Manager and Linux systemd are adapter implementations, not requirements embedded in Core. A Linux host without systemd must report its actual supervisor capability rather than silently substituting a claim.

These decisions resolve the Phase 0 questions for implementation. They do not enable Hardened/Service or production Gateway routing.

## 9. Runtime implementation status

The first implementation slice now includes:

- JSON Schema 2020-12 validation for deployment manifests and reports using the repository's AJV dependencies.
- Semantic validation for unique component/resource IDs, known resource owners/access principals, explicit environment-secret fallback and hardened restore policy.
- Shared capability evidence and fail-closed gate evaluation.
- Windows/Linux platform identification adapter seam. Unsupported platform values are reported as `UNSUPPORTED`.
- Read-only canonical resource path registry with deployment-root confinement, ancestor symlink rejection, duplicate/overlap detection and BigInt filesystem identity checks for hard-link aliases.
- Explicit Linux owner-private directory/file provisioning. These operations report `DEGRADED`, not `PASS`, because Node path APIs do not pin directory handles against concurrent replacement.
- Windows ACL provisioning, complete open-handle inspection, OS secret-store discovery, authenticated IPC, Hardened process identity separation and independent backup anti-rollback remain unimplemented and fail closed.
- Read-only `npm run deployment:verify` assessment command. It requires explicit manifest and deployment-root paths and does not mutate databases, permissions, services, accounts or backups.

The shared deployment contract tests run on Windows and Linux CI. Passing CI proves only disposable test behavior on those runners; it is not evidence about a user's live host.

## 10. Protected Memory final-send deployment gate

Production enablement of the protected Memory final-send path in [PR #844](https://github.com/necromorphic/Logic-Engine/pull/844) is a separate deployment capability. It is not implied by a valid manifest, a successful install, or a passing generic Host adapter check.

The deployment assessment always emits these required runtime evidence items, initially as `NOT_TESTED`:

- `host.patch.integrity` — installed SillyTavern source patch matches the pinned Patch Manager manifest and verified backup/state.
- `final-send.route-coverage` — every route declared protected is intercepted; unregistered routes cannot receive protected Memory.
- `final-send.dispatch-start.sync` — durable dispatch-start is committed before the single upstream invocation.
- `coordinator.shared-lease` — dispatch-start, revocation and final response release share the same Coordinator ordering boundary.
- `final-send.revoke-inflight-fence` — revoke during inference prevents protected response release.
- `final-send.response-revalidation` — final response is revalidated at the actual Host egress point, for both streaming and non-streaming responses.
- `final-send.ambiguous-recovery` — crash/restart after dispatch-start becomes an unresolved/UNKNOWN outcome and cannot be replayed.
- `final-send.upstream-call-count` — instrumented real upstream call count proves exactly one call for an admitted dispatch and no duplicate retry.

The gate `memory:protected-final-send-production` remains `BLOCKED` until every item has trusted runtime evidence with status `PASS`. The deployment manifest cannot assert or override these values. The current read-only verifier has no trusted live Host/Gateway attestation source, so it deliberately emits `NOT_TESTED`; PR #844 is therefore not deployment-authorized for production. Tests that construct evidence objects exercise policy behavior only and are not production attestations.

A future attestation provider must be internal to the deployment/runtime trust boundary, bind evidence to the exact Logic-Engine build, ST version and installed patch hash, and be collected by the verifier itself. User-supplied JSON, environment variables, manifest declarations or Extension browser state are not acceptable evidence sources.

The Patch Manager's `inspectInstalledReadOnly()` operation performs a separate local inspection: it re-hashes the live patched source files, requires the complete pinned backup set, verifies each backup against its pre-patch digest, and rejects an active transaction journal. It is read-only and does not treat `state.json` as proof. This result is diagnostic input only: it is not signed, does not prove which code is already loaded in the running SillyTavern process, and does not establish an independent backup freshness anchor. Therefore it must not by itself promote `host.patch.integrity` to `PASS`. The deployment verifier must independently repeat the source/backup digest checks from its own pinned contract and retain the final-send gate as `NOT_TESTED` until runtime identity and evidence binding are available.

Report integrity is checked independently of the policy evaluator: capability IDs and gate IDs must be unique; the protected final-send gate must exist exactly once; it cannot be BLOCKED when all eight required capabilities are PASS, and it cannot be PASS while any capability is missing or non-PASS. This prevents duplicate-record shadowing and stale gate snapshots from being accepted as a valid report.

The runtime attestation binding must identify at least:
- immutable Logic-Engine build/revision;
- exact SillyTavern version;
- installed Patch Manager manifest identity and cryptographic patch hash;
- verifier/provider identity and attestation format version;
- per-capability observation time, test/run identity and result;
- dispatch correlation identity for call-count and ambiguous-recovery evidence.

Evidence must be collected for the same deployment target. Mixing results from different builds, ST installations, patch hashes, sessions or test runs cannot satisfy the gate. A report assembled from policy fixtures remains test data even if every fixture says PASS.
