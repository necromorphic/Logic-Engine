# ARCHIVE — retired provider-specific PC egress experiment

**Status:** CANCELLED / OBSOLETE as of 2026-10-30.  
**Use:** historical record only. Not an active architecture, supported provider, setup guide, dependency, or work item.

This archive preserves the historical record of a provider-specific SillyTavern patch and local PC egress gateway experiment. The project owner cancelled this direction. Do not install, run, revive, extend, or treat its artifacts as current dependencies. Do not reuse its credentials or secrets.

## Historical artifacts and claims

The former workstream had described:

- a SillyTavern client patch based on upstream source revision `06bde939fb1e9c4c8d8641d810f0a916b5bce127`;
- a local Node.js PC gateway with loopback listener, Bearer authentication, fixed upstream host and route allowlist;
- PowerShell launch wrappers and a gateway README;
- patch and gateway test reports, including mock-upstream tests and process smoke checks;
- an intended upstream API-key handoff from the PC process;
- a proposed mandatory mode that would fail closed when the local gateway was unavailable.

These are historical descriptions, not verified current PC configuration. No deployment, firewall policy, machine-wide egress restriction, or production installation was established by those reports.

## Historical checksum records

The following values are retained only to identify old packages. They must not be used to validate or install anything now:

- Gateway-only intermediate package: `2fe4b8578afdb361d4fd2a2347cbd03ee49f3a06bbee903916afdb06d4aac1f7`.
- Gateway-only corrected package: `a5069ebefec65cf1d186bef8c7aa2fa81aef24ea7c26480ee9b1ff4cdd84e8f7`.
- Combined client patch + gateway bundle: `be3471e2a2f009b540289bd0dd3bf67c155aec4d48b8b0c78248ba7a5279ea34`.
- Another recorded combined bundle: `9c07d191c7f19c2ee6152c00e8e03477d7148af9e16bf04b09bae9633b958c46`.

The historical report contained changing intermediate checksums; the list is not a canonical artifact manifest.

## Historical security notes

- The old PC gateway was described as loopback-only and protected by a shared secret. This does not establish that it was deployed on the target PC.
- The old notes explicitly stated that no real upstream key or request had been used in the mock test.
- The uploaded ST-VectorService archive separately contained a literal service Bearer secret in `start.bat`. Do not copy it into logs or reports. Treat it as compromised for any reuse; use a newly generated test-only secret from an environment variable. This VectorService finding remains relevant to the separate PC-NEXT-01 test task.
- The old client patch and gateway were not the Logic-Engine Memory Dispatch Gateway. Do not conflate the cancelled experiment with the independent Memory/Core authorization contracts.

## Retirement decision

1. The provider-specific PC egress experiment is cancelled.
2. Its patches, launch scripts, gateway package, checksums, and setup instructions are not supported project components.
3. No current plan, test, implementation, or acceptance criterion may depend on this experiment.
4. Historical reports remain here for traceability only; active architecture and operational instructions must not link to or recommend these artifacts.
5. The separate ST-VectorService validation work in PC-NEXT-01 is still active and must not be confused with this cancelled experiment.
