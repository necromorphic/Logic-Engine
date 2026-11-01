# Extension Gateway — SillyTavern 1.19.0 compatibility gate

The approved Patch Manager may apply a narrowly scoped, version-pinned local patch to the installed SillyTavern distribution, limited to exact native integration files in its fixed allowlist and package manifest. Official upstream remains unchanged. The user's uploaded `SillyTavern-release.zip` is pinned to `06bde939fb1e9c4c8d8641d810f0a916b5bce127` (`1.19.0-1-g06bde939f`); the official 1.19.0 tag is a different commit (`7e8663cd9c184a550b37238218bdd32c6efc68e9`). Patch Manager must target the uploaded installed build, not silently retarget to the official tag.

The approved architecture remains: SillyTavern → untrusted Logic-Engine Client Extension → Extension Gateway → Authenticated Host Adapter → Core Security Gateway.

No standalone Server Companion, additional API port, Provider URL substitution/relay, direct browser/ST → Core path, or alternative connector is permitted.

Patch Manager now supports exact manifest-declared native source paths and package-owned Extension files; the focused Patch Manager workflow passes. The Logic-Engine branch now contains the untrusted Client Extension transport, same-process Extension Gateway core, envelope/lifecycle tests, and Gateway → Host Adapter contract. The route is not yet mounted in SillyTavern 1.19.0, and no production Authenticated Host Adapter is wired. Final-Send, pre-LLM egress, and final-response revalidation remain unimplemented. Protected production sending remains DENY / FAIL-CLOSED.

See document 106 for the pinned source audit and acceptance criteria.