# Universal Deployment and Security Architecture

Status: **Phase 0 architecture baseline / proposal**  
Scope: **Windows + Linux implementation targets; future third-platform seam only**  
Tracking: [Issue #766](https://github.com/necromorphic/Logic-Engine/issues/766)

## 1. Purpose and non-goals

This document defines a platform-neutral deployment and security model for Logic-Engine. Windows and Linux are first-class targets for the current work. A future platform must be addable through a new platform adapter without changing Core or application-level security contracts.

macOS is only a future extension target in this phase: no adapter, packaging, CI job, or runtime support is implemented or claimed.

This document is an architecture baseline, not evidence that the described controls already exist. It does not authorize changes to the user's live machine, production databases, ACLs, services, accounts, backups, or SillyTavern installation.

## 2. Existing implementation baseline

The inspected `main` baseline has these properties:

- Node.js ES modules, Node.js >=22.13, built-in `node:sqlite`, HTTP API.
- The shipped runtime is started through `node src/index.js`.
- Core DB, Coordinator DB, Host-version ledger and World Pack catalog paths are supplied through environment configuration.
- Startup validates required tokens, token separation, selected database path collisions and loopback binding defaults.
- The Host-version inventory verifier is deliberately deny-only; it cannot establish READY.
- The current runtime is a modular monolith. Components in one process and under one OS identity do not have separate OS-enforced filesystem identities.
- Existing persistence documentation explicitly leaves production storage and physical-isolation strategy open.

These facts describe the current repository/runtime baseline. The observed Windows PC is one test environment, not the reference architecture.

## 3. Supported deployment profiles

Both profiles use the same platform-neutral contracts and application logic. A profile is an outcome of capability checks, not a label that overrides them.

### 3.1 Portable / Desktop

Intended for a normal user installation without administrator/root privileges.

- A single-process modular monolith is allowed.
- Components may have logical authorization boundaries inside the process.
- No per-component OS isolation claim is permitted.
- Data, configuration, secrets, logs and backups use distinct canonical locations where practical.
- The runtime reports that one process identity can access every resource available to that process.
- Features requiring a stronger boundary are disabled or explicitly marked degraded/unsupported.

### 3.2 Hardened / Service

Intended for managed hosts and users who require enforceable OS security boundaries.

- Security domains run under distinct non-administrator identities where the OS supports them.
- Cross-domain communication uses narrow authenticated IPC contracts.
- Each identity receives only the filesystem and IPC rights required by its role.
- Backup/recovery credentials and writable locations are separated from normal runtime identities.
- Effective permissions and real process identities are tested, not inferred from configuration files.
- If the required identities, IPC protections or filesystem boundaries cannot be established, the profile does not become READY.

A deployment may run some components together where isolation is not required, but every combined boundary must be declared. A process boundary is not automatically a security boundary unless identities and permissions differ.

## 4. Platform-neutral architecture

Application code must depend on contracts, not Windows ACL APIs, POSIX mode bits, systemd, Windows Service Control Manager, Keychain, DPAPI or a particular secret vault.

The deployment layer is composed of:

1. **Deployment Manifest** — declared components, stores, paths, profile and required capabilities.
2. **Platform Adapter** — discovers OS capabilities and performs platform-specific operations.
3. **Security Policy Evaluator** — compares required capabilities with observed evidence and produces gates.
4. **Storage Layout Registry** — resolves canonical locations and detects aliases/overlaps.
5. **Secret Provider Chain** — resolves secrets from supported sources without exposing values.
6. **Process Supervisor / IPC Adapter** — starts and monitors service processes where the profile requires them.
7. **Backup / Recovery Manager** — handles protected backup, validation and controlled restore.
8. **Deployment Diagnostics** — emits a machine-readable report and human-readable summary.

Core, Memory Provider, Coordinator, Host/Gateway and mechanics must not import platform-specific adapter modules directly.

## 5. Platform Security Adapter contract

The contract must be capability-oriented. It must not expose a Windows-specific ACL object or a Linux-specific permission structure to application code.

Required operation groups:

- `identifyPlatform()`: OS family, release, architecture, runtime compatibility.
- `inspectExecutionIdentity()`: effective user/service identity, privilege indicators, group membership summary.
- `inspectPath(path, intent)`: canonical path, filesystem type, owner identity, effective access evidence, link/reparse status and limitations.
- `ensurePrivateDirectory(path, policy)`: safely create or validate a directory without following untrusted links.
- `ensurePrivateFile(path, policy)`: create/validate a file with required access constraints.
- `inspectOpenHandles(paths)`: report whether relevant files are held by other processes, with an explicit unsupported/not-tested result if unavailable.
- `inspectProcessBoundary(process)`: identity and process-boundary evidence for a managed component.
- `inspectSecretCapabilities()`: available OS secret stores and safe fallback capabilities; never return secret values.
- `inspectServiceCapabilities()`: available service/supervisor mechanisms without assuming one is installed.
- `collectEvidence()`: return structured evidence with provenance, timestamp and limitations.

Every operation must return structured results. Unsupported operations must not silently succeed.

### 5.1 Capability result vocabulary

Use a shared status vocabulary:

- `PASS` — required property was actively verified.
- `FAIL` — verification found a violation.
- `UNSUPPORTED` — platform/runtime cannot provide the capability.
- `NOT_TESTED` — no valid evidence was collected.
- `DEGRADED` — capability exists but only partially satisfies the policy.

Each result includes: capability ID, status, required/optional classification, evidence source, observed value or safe summary, timestamp, adapter version and explanatory limitation.

A capability is not PASS because a setting is present. For example, configured ACLs are not proof of effective access; an absent SQLite WAL file while idle is not proof that WAL/SHM lifecycle is safe.

### 5.2 Future third-platform seam

A future platform is added by implementing the same adapter contract, mapping each capability to native primitives and adding adapter-specific tests. Core contracts, deployment manifest schema, policy evaluator and portable profile must remain unchanged.

For macOS, only future mapping topics are recorded: user/group identities, POSIX permissions and ACLs, launchd service management, sandbox/container options, Keychain secret storage, APFS/link semantics and open-file inspection. These are design notes, not current support or acceptance criteria.

## 6. Deployment manifest and canonical path registry

The manifest declares logical resources, not machine-specific absolute paths embedded in application code.

Resource classes:

- canonical databases and transaction journals;
- derived indexes/caches;
- configuration and trusted catalogs;
- secrets and credential references;
- logs and audit exports;
- temporary/runtime sockets and PID metadata;
- backups, restore staging and recovery metadata.

Each resource entry defines:

- stable logical ID and owning component/security domain;
- data classification and whether it is canonical or rebuildable;
- path source (default, explicit configuration or OS standard location);
- required access intents (read, create, append, replace, delete, rename);
- symlink/reparse-point policy;
- backup/restore policy;
- retention and migration policy.

Path resolution must produce one canonical path per logical resource. The registry must detect:
- same-file aliases, hard links and symlink/reparse aliases where detectable;
- parent/child overlap that grants broader access than intended;
- duplicate or stale configured paths;
- paths on unsupported or unsuitable filesystems;
- paths that escape the deployment root when confinement is required.

The registry reports conflicts and blocks unsafe startup. It does not silently move or merge existing data. Data migration is a separate reviewed operation with backup and explicit approval.

### 6.1 Suggested logical layout

The exact OS-native root is adapter-defined. The logical structure is stable:

```text
deployment/
  config/
  secrets/                 # only when a secure file fallback is selected
  data/
    core/
    coordinator/
    host-ledger/
    provider/
  cache/
  logs/
  runtime/
  backup-staging/           # temporary only; not the protected backup vault
` ```

The protected backup vault must be outside the runtime-writable data tree and preferably outside the runtime host/security domain in Hardened mode.

## 7. Identity and process topology

Security domains are defined by data ownership and threat boundaries, not by the current folder layout.

Initial logical domains to evaluate:

- Core canonical state;
- Coordinator state;
- Host-version ledger;
- Memory Provider stores and indexes;
- Host/Gateway ingress and adapter credentials;
- backup/recovery authority.

Portable mode may combine these in one process and identity. In that case, filesystem ACLs cannot distinguish components; in-process authorization is defense-in-depth, not an OS boundary.

Hardened mode may split domains into separate processes. Each process must have:
- a dedicated non-admin identity where supported;
- a minimal explicit set of readable/writable paths;
- a narrow IPC endpoint and authenticated peer policy;
- no shared secret or writable directory unless explicitly required;
- independently verifiable startup identity and effective access.

Do not split processes merely to create complexity. The split is justified only where it creates an enforceable boundary and the IPC protocol can preserve required atomicity and failure semantics.

## 8. SQLite lifecycle requirements

For each SQLite store, the manifest records its owner and lifecycle policy.

Tests and runtime checks must cover:
- database file creation and permissions;
- WAL, SHM and rollback-journal creation under the same intended security policy;
- parent directory permissions needed for create/delete/rename and checkpoint operations;
- concurrent access and lock behavior;
- restart with and without sidecars;
- crash/recovery behavior in disposable test environments;
- backup consistency while writes are active;
- migration and restore ownership/mode after replacement.

Protecting only the main `.sqlite` file is insufficient. The parent directory and sidecar lifecycle are part of the storage security boundary.

Do not open, migrate, checkpoint, chmod or otherwise touch live user databases as part of architecture discovery.

## 9. Secrets provider chain

Secrets are referenced by logical ID. Application code asks the provider chain for a credential; it does not read arbitrary environment variables or platform vault APIs throughout the codebase.

Provider priority is policy-configurable and capability-based:

1. OS-managed secret store where available and appropriate.
2. Managed deployment secret injection (for example, a service manager or orchestrator).
3. Private file provider with verified owner/access and restrictive creation semantics.
4. Environment variables only as an explicitly accepted compatibility/development fallback.

The selected provider and its security limitations appear in diagnostics. Secret values must never appear in logs, diagnostic reports, exception messages, issue comments or test snapshots. Secret rotation and revocation must be specified per provider.

## 10. Backup, restore and anti-rollback

Backup is a separate security domain. Normal runtime identities must not be able to silently rewrite or delete the only trusted recovery history in Hardened mode.

A backup record binds at least:
- deployment identity and schema version;
- store identities and consistent snapshot identifiers;
- current authoritative revision/head and relevant authority-ledger identity;
- creation time and tool version;
- cryptographic digest and integrity metadata;
- provenance and restore authorization.

A digest detects corruption but does not alone prevent a malicious rollback. Anti-rollback requires a freshness/authority anchor that is not restored from the same backup set. The design must state where that anchor lives and what happens if it is unavailable.

Required disposable test:
1. Create backup A at revision/head A.
2. Advance the system to revision/head B.
3. Restore backup A.
4. Verify that stale state cannot silently become current authority.
5. Verify explicit recovery/reconciliation behavior and append-only audit evidence.

If no independent freshness anchor is available in Portable mode, the report must state that limitation and disable any feature whose safety depends on rollback resistance. Do not claim full anti-rollback protection from a local hash or a second file writable by the same identity.

## 11. Startup gate and diagnostics

Startup is a staged operation:

1. Parse and validate manifest/configuration.
2. Resolve canonical paths and detect collisions/escapes.
3. Inspect execution identity and platform capabilities.
4. Verify required directory/file access and link policies.
5. Verify storage readiness without mutating production data during diagnostic-only mode.
6. Verify secret provider availability without printing values.
7. Verify process/IPC requirements for the selected profile.
8. Verify backup/recovery prerequisites for features that require them.
9. Produce a deployment report.
10. Start only components whose required gates pass.

The report includes platform, runtime version, selected profile, component topology, resource map, capability statuses, failed gates, degraded guarantees and remediation hints. It must not contain secret values or sensitive file contents.

A failed optional capability may produce DEGRADED. A failed required capability blocks the affected component/feature. No required gate can be bypassed by setting a profile name or environment flag alone.

## 12. Windows and Linux implementation mapping

### Windows adapter (phase target)

Evaluate and test:
- process token and effective user/group identity;
- NTFS ACL inheritance and effective access, including parent-directory rights;
- reparse points and canonical path identity;
- Windows service identity and service manager integration for Hardened mode;
- DPAPI/Credential Manager or managed secret injection as capabilities, not mandatory dependencies;
- open-handle evidence where a supported inspection mechanism is available;
- SQLite sidecar lifecycle under real process identities.

Windows validation must run on disposable directories and test accounts. Hosted CI is not evidence about the user's live PC.

### Linux adapter (phase target)

Evaluate and test:
- effective UID/GID and supplementary groups;
- POSIX mode bits, ACLs and effective access;
- symlinks, mount boundaries and canonical path identity;
- systemd integration where available, with a documented non-systemd fallback or UNSUPPORTED result;
- OS secret-store or managed injection capabilities, with private-file fallback;
- open-file evidence and process identity;
- SQLite sidecar lifecycle under real service users.

Do not assume systemd, a particular distribution, root access, a specific home-directory layout or a single filesystem type.

## 13. Test strategy

Shared contract tests run against both adapters. Platform-specific tests validate native behavior.

Required test groups:
- adapter contract and status semantics;
- unprivileged Portable install/start;
- path canonicalization, aliases, symlinks/reparse points and traversal;
- least-privilege allowed/denied access;
- SQLite DB/WAL/SHM/journal and restart;
- secret-provider selection and redaction;
- service identity and IPC authentication in Hardened mode;
- backup integrity, restore authorization and anti-rollback;
- upgrade/migration and rollback;
- diagnostic report schema and fail-closed gates.

Use disposable temp roots, databases and identities. Tests must clean up only their own fixtures. No test may target a user's production data path.

CI matrix for this phase: supported Windows runner + supported Linux runner. Record exact OS/runtime versions. A future third platform adds a matrix entry only after its adapter is implemented and independently reviewed.

## 14. Delivery phases

- **Phase 0 — Contracts and baseline:** threat model, profiles, manifest, adapter contract, capability vocabulary, canonical path model, extension seam.
- **Phase 1 — Portable/Desktop:** non-admin single-process deployment on Windows and Linux.
- **Phase 2 — Hardened/Service:** process identities, IPC and enforceable filesystem boundaries on both platforms.
- **Phase 3 — Backup/recovery:** protected backup domain and anti-rollback protocol/tests.
- **Phase 4 — Operations:** packaging, upgrade, verification, backup/restore/rollback runbooks, CI and independent review.

Each phase produces a separate reviewable PR and acceptance evidence. No production host changes without explicit approval.

## 15. Explicit safety invariants

- Never claim per-component OS isolation for components sharing one process identity.
- Never treat UNSUPPORTED or NOT_TESTED as PASS.
- Never expose secret values in logs or reports.
- Never mutate or migrate production data during discovery.
- Never enable a feature whose required security gate has failed.
- Memory → NPC remains DISABLED / FAIL-CLOSED.
- Gateway production routing remains disabled until its separate gates pass.
- Current host inventory is a test fixture, not a universal architecture constraint.
