# Extension Gateway + Patch Manager — implementation compatibility audit

**Status:** BLOCKED AT PATCH-MANAGER BOOTSTRAP; approved architecture retained.  
**Target:** SillyTavern 1.19.0, pinned commit `06bde939fb1e9c4c8d8641d810f0a916b5bce127`.  
**Supersedes:** the rejected Option A proposal in `docs/105-extension-gateway-sillytavern-compatibility-gate.md`.  
**Decision:** No standalone Server Companion and no SillyTavern native-source patch. The single managed Logic-Engine Extension package may contain its own client extension and Gateway server-plugin artifacts under their dedicated extension directories.

## 1. Approved architecture (unchanged)

`SillyTavern → untrusted Logic-Engine Client Extension → Extension Gateway → Authenticated Host Adapter → Core Security Gateway`

The installed ST working tree may receive only the versioned files of the single Logic-Engine Extension package through the Patch Manager. The manager is restricted to `public/scripts/extensions/third-party/logic-engine-extension-gateway/` and `plugins/logic-engine-extension-gateway/`. It must reject changes to native ST source, native routes, configuration, unrelated extensions, and arbitrary paths. No source-level SillyTavern patch is authorized.

- Client Extension is untrusted and is never an authentication or authorization authority.
- Patch Manager owns the versioned Extension package and the transactional lifecycle: Preflight → Backup → Apply → Verify → Rollback, with crash recovery, conflict/concurrency protection, user-change detection, and unified Update/Repair/Uninstall. Its allowlist is limited to the two package directories above.
- Extension Gateway is the only ST-facing ingress. It validates the request envelope and routes only to Authenticated Host Adapter.
- Authenticated Host Adapter derives the authenticated ST session/account/conversation and trusted installation/world/actor bindings from server-owned state.
- Core Security Gateway remains the sole authorization authority.
- The Final-Send Hook is an Extension-owned interception/adaptation component, not an authorization authority. It must use the Extension Gateway → Authenticated Host Adapter → Core Security Gateway path and satisfy pre-LLM egress plus final-response revalidation for every protected generation path. Patch Manager may install/maintain its Extension artifacts only; it may not patch native ST sender source.
- No separate API port, Provider URL substitution, Provider Relay, direct browser/ST → Core, or alternative connector is allowed.
- Existing vectorization patch is out of scope and must remain unchanged.

## 2. What the supplied ST 1.19.0 source proves

### 2.1 Extension Manager is not a server-side patch executor

Pinned source findings:

| Source | Evidence | Consequence |
|---|---|---|
| `src/endpoints/extensions.js:92-138` | `POST /install` validates URL, computes an extension directory under the user's/global extensions directory, then runs `git.clone(..., extensionPath, ...)`. | It clones an extension repository into the extension directory. It does not execute an extension's Node entrypoint or apply patches to the ST installation root. |
| `src/endpoints/extensions.js:169+` | `POST /update` resolves an extension directory and performs Git fetch/pull there. | Update is limited to the extension repository directory. |
| `public/scripts/extensions.js` | Client installer calls `/api/extensions/install`; client manifests load browser JS/CSS. | Client Extension Manager does not provide a supported server route registration or arbitrary filesystem patch API. |
| `src/plugin-loader.js:10,40-...` | Server plugins are gated by `enableServerPlugins`, loaded from the separate `plugins/` directory, and mounted under `/api/plugins/<id>`. | This is the rejected separate Server Companion mechanism; it is not used as a workaround. |
| `src/server-main.js:248,278,313` | Login middleware is installed, native private routes are mounted, then server plugins are loaded later during startup. | A server plugin cannot use the supported loader to insert middleware before native generation routes. |

Therefore Extension Manager alone cannot bootstrap the trusted Patch Manager or create the server-side Gateway route.

### 2.2 Existing Logic-Engine patch artifacts are not a Patch Manager

The Logic-Engine repository contains review-only pinned-source patch artifacts, including:

- `host-adapter/prototype/patches/sillytavern-1.19.0-lifecycle-hooks.patch`
- `host-adapter/prototype/patches/sillytavern-1.19.0-source-inventory-route.patch`

They demonstrate that a patch can be applied to a disposable ST checkout and checked in CI. They do **not** implement the approved Patch Manager lifecycle, install themselves through Extension Manager, or establish a trusted runtime.

The current lifecycle/inventory candidates are not the approved Extension Gateway:
- they add multiple ST-facing routes (for example `/api/logic-engine/host/session`, `/api/logic-engine/host/inventory`, and `/api/logic-engine/host-version-ledger/reconcile`);
- the digest proxy candidate performs session-scope checks and forwards directly to Core;
- neither candidate supplies the required single Gateway ingress or Core Security Gateway authorization;
- neither candidate installs the Final-Send Hook or proves protected pre-LLM egress/final-response revalidation.

These candidates must not be exposed as production routes unchanged. Their useful lifecycle code may be reviewed and refactored behind the approved Gateway/Host Adapter boundary.

## 3. Final-Send coverage is a separate, mandatory patch package

The pinned Host source audit identifies multiple generation dispatch families and independent provider egress sites. In particular, the Chat Completions server dispatcher has 13 provider-specific early-return sender branches plus a generic OpenAI-compatible path; sender functions contain their own fetch/streaming paths. Other generation families include Text Completions, Kobold, Horde and NovelAI.

A route-entry middleware, browser generation event, prompt-preparation hook, or wrapper around only the generic fetch does not cover these paths.

The approved Final-Send Hook Extension package must:
1. enumerate every supported protected generation route and outbound transport call site on the exact ST build;
2. bind the request to the trusted Host session/context before protected context is assembled;
3. route protected pre-LLM egress through the approved Extension Gateway → Host Adapter → Core Security Gateway path;
4. synchronously coordinate dispatch-start with the shared Coordinator lease and revoke ordering;
5. prevent provider transport invocation when authorization, identity, inventory, or revalidation is denied/unknown/unavailable;
6. perform final-response revalidation before a protected response is committed/returned to the conversation;
7. cover streaming, non-streaming, retries, regenerate/swipe, cancellation, alternate generation families and every provider branch;
8. fail closed for any route not explicitly covered by the exact installed patch manifest.

A remote Core “authorize, then return allow, then ST sends directly” sequence is not equivalent to the approved dispatch-start boundary. The actual outbound transport must participate in the approved serialization contract. The current repository documents a Node runtime compatibility issue: Logic-Engine requires Node >=22.13.0, while the pinned ST package declares Node >=20. The deployed runtime must be verified before a Host-process implementation can be accepted.

## 4. Patch Manager implementation boundary

The trusted Patch Manager now exists inside the Logic-Engine Node deployment package and is launched locally through `npm run integration:patch-manager`. It performs exact-target checks, manifest/hash validation, durable transaction journaling, backups, recovery, rollback, and post-install user-change protection.

The manager is deliberately not a native ST patcher. It rejects every destination outside the integrated Logic-Engine Extension package directories. The browser extension cannot invoke filesystem operations or supply arbitrary install paths. The manager is not exposed as an ST route and does not create a second backend service.

The Extension Manager remains the ordinary client-side repository installer; the trusted local Patch Manager owns the coordinated installation/update/repair/uninstall of the integrated client and Gateway server-plugin artifacts as one package.

## 5. Local deployment integration (no architecture change)

The Patch Manager is a local command in the existing Logic-Engine Node deployment contour. It is invoked by the operator/deployment process, not by the browser or an ST-facing endpoint. It targets the exact pinned ST Git commit, and all writes are restricted to the single integrated Extension package's client/server directories.

The remaining deployment task is to provide the package manifest and release artifact for the exact Gateway/Host Adapter/Final-Send Extension version, then connect the CLI invocation to the existing installer workflow. No native ST source path is eligible for installation.

## 6. Required evidence before implementation can be marked complete

- [ ] Trusted local Patch Manager launch owner identified and wired; no Server Companion.
- [ ] Patch manifest schema, exact ST target fingerprint and package signatures/digests.
- [ ] Preflight detects wrong ST build, dirty/user-modified files, partial prior patch, conflicting patches, concurrent update and insufficient permissions.
- [ ] Backup is durable and verified before apply; transaction marker permits crash recovery.
- [ ] Apply is atomic or recoverable; verify checks exact post-patch hashes/markers and expected route/sender inventory.
- [ ] Rollback restores only files still matching the manager's last-applied state; user edits are never overwritten silently.
- [ ] Update/Repair/Uninstall use the same transaction and conflict rules.
- [ ] Exactly one ST-facing Extension Gateway ingress exists; all client requests use it.
- [ ] Host Adapter authenticates the real ST session and constructs trusted identity/context; caller-supplied identity/world/actor values are ignored.
- [ ] Core Security Gateway is the only authorization point.
- [ ] All protected generation paths are enumerated and intercepted by Final-Send Hook; uncovered paths are disabled/fail-closed.
- [ ] Pre-LLM egress denial/revoke tests prove zero upstream calls.
- [ ] Final-response revalidation tests cover revoke/change during generation and prevent stale response commit/delivery.
- [ ] Dispatch-start/revoke race, streaming, retry, ambiguous crash/restart and real upstream-call-count tests pass.
- [ ] ST 1.19.0 disposable integration and real installed-instance acceptance both pass.
- [ ] No Provider URL substitution/relay, second port, direct browser/ST → Core, or vectorization change.

## 7. Current disposition

| Area | Status |
|---|---|
| Approved architecture | PRESERVED |
| Extension Manager as client installer | CONFIRMED |
| Extension Manager as trusted Patch Manager bootstrap | UNSUPPORTED |
| Separate server plugin / Server Companion | REJECTED; not used |
| Existing native-ST source patch artifacts | NOT AUTHORIZED; NOT INSTALLABLE BY PATCH MANAGER |
| Patch Manager Extension-artifact transaction | IMPLEMENTED; exact-head CI pending |
| Production Extension Gateway | REVIEW-ONLY CANDIDATE |
| Authenticated Host Adapter integration through sole Gateway | NOT IMPLEMENTED |
| Final-Send Hook / pre-LLM egress | NOT IMPLEMENTED |
| Final response revalidation | NOT IMPLEMENTED |
| Production protected sending | DENY / FAIL-CLOSED |

**No architecture approval is requested.** The next engineering step is to connect the approved Patch Manager to the trusted local Logic-Engine installation/management host, then implement the versioned patch transaction and the single Gateway/Final-Send patch packages.

## 8. Current engineering implementation status

- [x] Select existing local deployment owner: Logic-Engine Node package/CLI; no separate Companion.
- [x] Implement local Patch Manager module and CLI entrypoint.
- [x] Restrict all writes to the integrated Extension client/server directories; reject native ST source/config/routes and unrelated extensions.
- [x] Implement exact-target/manifest checks, transactional backup/journal, rollback, recovery and user-edit protection.
- [x] Add focused Patch Manager tests for allowed and rejected destinations.
- [x] Focused Patch Manager CI: 6/6 tests passed on PR head `fc1231e00f80f35e4f4a9ee3e211874287940a72` (run 41298811265). The full Runtime workflow remains pending.
- [ ] Produce the single approved ST patch package containing the sole Extension Gateway route, trusted Host Adapter integration, pre-LLM egress and final-response revalidation.
- [ ] Add an integration manifest for the exact ST build, pinned patch digest and release package identity.
- [ ] Run disposable ST apply/lint/syntax/integration tests, then real installed-instance acceptance.
- [ ] Prove all protected sender paths and actual upstream call counts; until then protected sending remains DENY / FAIL-CLOSED.
