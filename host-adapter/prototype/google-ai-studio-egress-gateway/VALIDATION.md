# Validation report — SillyTavern Google egress prototype

Date: 2026-10-30
Pinned SillyTavern source: `06bde939fb1e9c4c8d8641d810f0a916b5bce127`

## Client patch

- Patch SHA-256: `c9b2baf49947d32515ecd87251156d1827f8d1f5f2c6ef2b292251da00a627a8`
- Clean-tree `git apply --check`: PASS
- Patch application to clean archive without Git metadata: PASS
- Targeted Node tests: 10/10 PASS
- Five changed JavaScript module syntax checks: PASS
- `git diff --check`: PASS
- Full SillyTavern lint/suite: NOT RUN; uploaded source archive had no `node_modules` and package.json had no test script.

## PC Gateway

- Runtime: Node.js 22+, built-in modules only.
- Tests: 9/9 PASS against local mock upstream.
- Process smoke: `/health` PASS; authenticated `/ready` PASS.
- Real Google request: NOT RUN; no real API key was supplied.
- Target Windows PowerShell execution: NOT RUN.
- OS firewall/whole-machine egress isolation: NOT IMPLEMENTED / NOT VERIFIED.

## Safety

- Mandatory mode must remain disabled until target-PC deployment and a real Gemini request have been verified.
- `/ready` validates local process and shared-secret match only; it does not validate Google credentials or upstream reachability.
- The gateway is not the Logic-Engine Memory Dispatch Gateway.
- Memory→NPC remains DISABLED / FAIL-CLOSED.
- A literal Bearer secret was found in the uploaded ST-VectorService start script. Treat it as exposed; rotate it. The value is not reproduced in this report.

## Artifact checksums

- Gateway-only package (final): `2fe4b8578afdb361d4fd2a2347cbd03ee49f3a06bbee903916afdb06d4aac1f7`
- Complete package (final): `9c07d191c7f19c2ee6152c00e8e03477d7148af9e16bf04b09bae9633b958c46`

The archives were generated in the working session. The current commit adds this validation record and the integration README; the binary archives and raw patch have not yet been committed as repository files.
