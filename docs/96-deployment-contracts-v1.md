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

## 8. Review questions before runtime implementation

1. Should a manifest allow multiple components to share one security domain explicitly, or should the runtime derive grouping from `security_domain` declarations?
2. Should Portable mode permit environment secrets by default for backward compatibility, or require an explicit compatibility switch in every deployment?
3. Which resource classes are mandatory in the first Portable profile, given the current runtime's configured Core DB, Coordinator DB, Host ledger and World Pack catalog?
4. Should backup freshness anchoring be an optional capability in Portable mode with an explicit anti-rollback limitation, while Hardened mode requires it?
5. Which service manager integrations are mandatory for Hardened Linux: systemd only, or a generic supervisor contract with systemd as one implementation?

These questions must be resolved before code relies on the relevant semantics. No silent defaults should decide security-sensitive behavior.
