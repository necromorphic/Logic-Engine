# Extension Gateway — SillyTavern 1.19.0 compatibility gate

The approved Patch Manager may apply a narrowly scoped, version-pinned local patch to the installed SillyTavern distribution, limited to exact native integration files in its fixed allowlist and package manifest. Official upstream remains unchanged.

The approved architecture remains: SillyTavern → untrusted Logic-Engine Client Extension → Extension Gateway → Authenticated Host Adapter → Core Security Gateway.

No standalone Server Companion, additional API port, Provider URL substitution/relay, direct browser/ST → Core path, or alternative connector is permitted.

Patch Manager support for exact native source paths is being implemented and is not yet validated. Final-Send, Host authentication, pre-LLM egress, and final-response revalidation remain unimplemented. Protected production sending remains DENY / FAIL-CLOSED.

See document 106 for the pinned source audit and acceptance criteria.