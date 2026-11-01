# Extension Gateway — SillyTavern 1.19.0 compatibility gate

**Status:** BLOCKED AT PATCH-MANAGER BOOTSTRAP; approved architecture retained.  
**Target:** SillyTavern 1.19.0.  
**Superseded by:** [106 — Extension Gateway + Patch Manager compatibility audit](./106-extension-gateway-patch-manager-compatibility-audit.md).

## Approved decision

The architecture is already approved and is not being reopened:

`SillyTavern → untrusted Logic-Engine Client Extension → Extension Gateway → Authenticated Host Adapter → Core Security Gateway`

The approved Patch Manager installs versioned patches into the local ST working tree. ST upstream remains unchanged. No separate Server Companion, separate server-plugin installation, additional API port, Provider URL substitution/relay, direct browser/ST → Core path, or alternative connector is permitted.

## Corrected compatibility finding

The supplied ST 1.19.0 source confirms:

- Extension Manager's `POST /api/extensions/install` clones a repository into the user/global extension directory. It does not execute server entrypoints or patch the ST installation root.
- The client extension manifest loads browser JS/CSS and cannot register trusted Express routes.
- The server-plugin loader is a separate `plugins/` mechanism and is explicitly not used because that would reintroduce the rejected Server Companion.
- Existing Logic-Engine patch files are review-only artifacts. They are not a Patch Manager and do not install themselves.

Therefore Extension Manager alone cannot bootstrap the trusted Patch Manager. This does not invalidate the approved patch-based architecture; it identifies the missing trusted local launch surface for the already-approved Patch Manager.

## Current implementation status

- Patch Manager runtime/installer: not present in current Logic-Engine `main`.
- Single Extension Gateway route: not implemented.
- Authenticated Host Adapter behind that route: not wired.
- Final-Send Hook: not implemented.
- Pre-LLM egress and final-response revalidation: not implemented.
- Protected production sending: DENY / FAIL-CLOSED.

The previous Option A / Option B section is withdrawn. No Server Companion is proposed or implemented. No additional architecture approval is requested.

See document 106 for the exact ST source evidence, current patch artifact limitations, the Final-Send coverage requirements, and the minimum Patch Manager bootstrap dependency.
