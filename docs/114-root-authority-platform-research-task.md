# Root Authority — Block 1: Windows TPM and Android Keystore capability research

**Branch:** `integration/host-core-v1`  
**Status:** READY FOR RESEARCH / NO IMPLEMENTATION AUTHORIZED  
**Parent design:** `docs/113-root-authority-threat-model.md`  
**Scope:** Evidence-based evaluation of two platform adapters. This block does not implement Root Authority, change Core, provision hardware, or enable any production gate.

## Objective

Determine what guarantees can actually be provided by:
1. Windows TPM 2.0 NV facilities on the current Windows development PC;
2. Android Keystore / TEE / StrongBox on at least one real Android device, if available.

The output is a capability assessment for the existing platform-neutral descriptor. Do not assume that hardware-backed key storage provides a monotonic application tip.

## Hard constraints

- Read-only / non-destructive investigation only.
- MUST NOT define, clear, reprovision, take ownership of, increment, write, or otherwise modify TPM NV indices.
- MUST NOT reset Android Keystore, delete user keys, unlock bootloader, root the device, change verified boot state, or factory-reset anything.
- Do not request administrator elevation merely to make a probe succeed. Record when elevation or provisioning would be required.
- Do not add a fake adapter, stub capability, or optimistic `available: true`.
- Do not change `verifyInventorySnapshot: async () => false`.
- Do not enable Memory → NPC or change Mechanics, Host Lifecycle, migration, Root Inventory or any other readiness status.
- No external VPS/cloud anchor implementation in this block.
- If a physical Android device is unavailable, mark device-specific findings NOT TESTED; documentation research is not a hardware test.

## Task A — Windows TPM 2.0

### A1. Read-only platform inventory

Record:
- Windows edition/build and architecture;
- TPM presence, specification version, manufacturer and firmware version where exposed;
- TPM readiness and lockout/disabled indicators where safely exposed;
- whether Windows TBS is available;
- available TPM NV counter capacity/capability if queryable without defining an index;
- exact command/API/tool used, exit code and whether the process was elevated.

Use documented Windows APIs and read-only system queries. TBS is the Windows broker for TPM commands; its existence does not prove that a user process can define or use an NV counter. Record command authorization and access failures as evidence, not as reasons to change machine policy.

### A2. Capability boundary

Establish separately:
- read existing TPM public/capability information;
- create/define an NV counter;
- increment an already provisioned counter;
- read an already provisioned counter;
- recover from TPM disabled/unavailable/cleared/replaced.

For each action, report whether it is documented, whether it was actually tested, required privilege/authorization, and whether testing would be destructive. Do not attempt actions that create or mutate NV state.

### A3. Windows conclusion

Classify the Windows adapter using only demonstrated evidence:
- `key_protection`: `none | os_user | os_admin | hardware`;
- `monotonic_tip`: `none | os_restricted | tpm_nv`;
- `survives_full_disk_restore`: true only if an independent tip survives the relevant restore scenario;
- `survives_admin_with_code_access`: false unless explicitly demonstrated within the stated threat model;
- `external_independence`: false.

If NV provisioning/use cannot be safely established, classify TPM NV as **UNPROVEN / NOT AVAILABLE FOR PRODUCT CLAIMS**. Do not substitute a TPM-backed signing key for a monotonic counter. A DPAPI/ACL fallback must be reported as its own weaker adapter profile.

## Task B — Android Keystore / StrongBox

### B1. Device and platform inventory

On a real test device, record:
- manufacturer/model, Android version and API level;
- security patch level;
- StrongBox feature availability;
- Keystore security level for a generated test key (software, TEE, StrongBox);
- attestation availability and whether the chain validates to a trusted root, if tested;
- whether rollback-resistance authorization is exposed/supported for the test key;
- exact app/API/tool, exceptions and device-specific limitations.

Use a disposable test key only. Delete only that test key created by this research block. Do not inspect, export, delete or modify user/application keys.

### B2. Distinguish the guarantees

Explicitly answer these as separate questions:
1. Can the device protect a cryptographic key in software, TEE or StrongBox?
2. Can the device attest to the key's security level and relevant boot state?
3. Does KeyMint report rollback resistance for the test key?
4. Does that rollback-resistance property protect deletion/replay of that key, or does it provide a general-purpose monotonic counter for arbitrary application data?
5. Is there a documented API that lets an ordinary application atomically advance and read an application-owned monotonic tip across backup/restore?

Do not infer answer 5 from answers 1–3. Android KeyMint's rollback-resistance property for keys is not, by itself, proof of a general-purpose application counter.

### B3. Android conclusion

Map only demonstrated guarantees to the platform descriptor. StrongBox availability is optional and device-dependent. If the device lacks StrongBox, report the actual TEE/software level rather than failing ordinary Engine operation.

If no real device is available, produce a documentation-only assessment and mark all device-dependent capability results NOT TESTED.

## Task C — Cross-platform comparison

Produce one table with columns:

- platform/device;
- key protection level;
- monotonic application tip capability;
- survives full disk/device backup restore;
- survives local administrator/root with code access;
- external independence;
- evidence type (official documentation / read-only probe / real-device test);
- confidence (proven / partial / unproven / not tested);
- limitations.

Keep these guarantee classes separate:
- protected key storage;
- rollback-resistant application tip;
- independent external authority.

Do not merge them into a single security score.

## Required deliverables

Create `docs/115-root-authority-platform-capability-report.md` containing:
1. environment and exact device/build information;
2. commands/APIs and outputs or concise evidence excerpts;
3. tested vs documentation-only claims;
4. the comparison table;
5. proposed descriptor values for each evaluated adapter;
6. unsupported assumptions and unresolved questions;
7. recommendation: proceed with a local platform adapter, use a weaker local profile, or rely on optional external anchor for stronger rollback guarantees.

A recommendation may be **NO-GO** for a hardware capability. This is a valid result.

## Acceptance criteria

- No hardware state was modified.
- Windows and Android claims are separately evidenced.
- Key protection is not conflated with monotonic tip protection.
- No general-purpose monotonic counter is claimed without direct evidence.
- Missing device access is recorded as NOT TESTED, not PASS.
- Descriptor values are conservative and match the evidence.
- No production code, gate, readiness state or user data was changed.

## Official references

- Microsoft TPM Base Services overview: https://learn.microsoft.com/en-us/windows/win32/tbs/tpm-base-services-portal
- Microsoft TBS command submission API: https://learn.microsoft.com/en-us/windows/win32/api/tbs/nf-tbs-tbsip_submit_command
- Microsoft TBS access/use guidance: https://learn.microsoft.com/en-us/windows/win32/tbs/using-tbs
- Android Keystore system and StrongBox: https://developer.android.com/privacy-and-security/keystore
- Android KeyMint rollback-resistance semantics: https://source.android.com/docs/security/features/keystore/implementer-ref
- Android key attestation security levels: https://source.android.com/docs/security/features/keystore/attestation

## User input required to execute hardware probes

The Windows portion can be performed on the existing Windows development PC without changing TPM state.

For the Android hardware portion, the user must provide access to a physical Android device (USB debugging or a way to install/run a small diagnostic app) and approve read-only device inspection. If no device is available, complete the documentation-only portion and leave real-device findings NOT TESTED.
