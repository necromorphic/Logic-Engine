# Dedicated SQLite owner identity — Issue #770

This deployment layer establishes the OS boundary required by the SQLite remediation. The process that owns SQLite files runs under a dedicated service identity; interactive users and unrelated services must not be able to mutate the database directory.

Threat-model decision: code running under the dedicated Logic-Engine service identity is trusted to mutate its SQLite namespace. Different OS identities are untrusted. If same-identity code must be treated as hostile, this model is insufficient; SQLite ownership must move into a separately isolated broker process with authenticated IPC.

This layer does not make the current VFS probe production-ready. Production database opens remain disabled until the VFS, persistent role manifest, sidecar lifecycle, all SQLite engine integrations, exact-head tests and independent Security review are complete.

## Linux / systemd

1. Install the application under /opt/logic-engine and use Node.js 22.13+ at /usr/bin/node.
2. Copy logic-engine.service to /etc/systemd/system/.
3. Store environment values in /etc/logic-engine/logic-engine.env and protect it with root-only permissions (chmod 0600).
4. Configure every Logic-Engine SQLite path beneath /var/lib/logic-engine.
5. Verify with systemd-analyze verify and inspect systemd-analyze security.
6. Enable/start only after the native VFS production integration and trusted role manifest gates are satisfied.

The unit uses DynamicUser, a private StateDirectory with mode 0700, UMask=0077 and systemd filesystem sandboxing. Do not manually chown the state directory to a guessed numeric UID.

## Windows service

Run elevated PowerShell from a trusted installation directory. First use -WhatIf, inspect the paths, then rerun without -WhatIf:

    .\install-windows-service.ps1 -ServiceName LogicEngine -InstallDirectory C:\LogicEngine -StateDirectory C:\ProgramData\LogicEngine\State -WhatIf

The script refuses to replace an existing service, creates a virtual service account (NT SERVICE\<ServiceName>), enables its service SID, removes inherited ACLs from the SQLite state directory, and grants access only to that service SID, SYSTEM and local Administrators. An optional environment file is readable by the service SID and writable by SYSTEM/Administrators. If provisioning fails, the script deletes the partially created service.

Configure all Logic-Engine SQLite paths beneath the protected state directory. Keep application binaries read-only to the service identity. Do not grant Users, Authenticated Users or unrelated service SIDs write/delete access to the DB directory.

## Operational constraints

- Do not run the production SQLite owner as an interactive administrator.
- Do not run SillyTavern, ST-VectorService or unrelated extensions under the Logic-Engine service identity. Each independently writable SQLite store needs its own owner boundary.
- Backups/restores require an authorized maintenance identity and a quiesced/checkpointed procedure; do not grant backup agents general write access to the live DB directory.
- A service identity is not a sandbox against code already executing as that identity.
- The Windows script does not install Node, application files, secrets, firewall rules or the native VFS.
- This is a deployment building block, not proof that current DB opens route through a secure VFS.
