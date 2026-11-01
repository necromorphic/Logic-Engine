# Dedicated SQLite owner identity — Issue #770

This deployment layer establishes the OS boundary required by the SQLite remediation. The process that owns SQLite files runs under a dedicated service identity; interactive users and unrelated services must not be able to mutate the database directory.

Threat-model decision: code running under the dedicated Logic-Engine service identity is trusted to mutate its SQLite namespace. Different OS identities are untrusted. If same-identity code must be treated as hostile, this model is insufficient; SQLite ownership must move into a separately isolated broker process with authenticated IPC.

This layer does not make the current VFS probe production-ready. Production database opens remain disabled until the VFS, persistent role manifest, sidecar lifecycle, all SQLite engine integrations, exact-head tests and independent Security review are complete.

## Linux / systemd

1. Install the application under /opt/logic-engine and use Node.js 22.14+ at /usr/bin/node (the exact archived ST-VectorService addon requires Node-API 10).
2. Provision the distinct static `logic-engine-app` and `logic-engine-broker` identities as described below.
3. Install both `logic-engine.service` and `logic-engine-sqlite-broker.service` into /etc/systemd/system/.
4. Create `/etc/logic-engine/logic-engine.env` for non-secret application settings and the root-owned, app-group-readable `sqlite-broker.env` for broker/role bindings.
5. Keep ordinary app state beneath `/var/lib/logic-engine`; protected SQLite files live only in broker-owned role directories and are addressed by a non-writable logical alias directory.
6. Run `systemd-analyze verify` for both units and inspect `systemd-analyze security`.
7. Do not enable/start production DB roles until the manifest has been initialized, the role enrolled, and the production VFS and independent Security-review gates are satisfied.

The app unit uses a static application UID so the broker can authenticate it exactly. The broker runs under a separate static UID and the app's dedicated primary group. Both units use `UMask=0077` and systemd filesystem sandboxing; the app unit requires the broker unit and cannot start before broker startup reconciliation succeeds.

## Linux broker/application identity split

The POSIX prototype now has a separate systemd broker unit:
`logic-engine-sqlite-broker.service`. The application unit is ordered after and
requires it. Unlike the earlier single-owner example, these units use two
static, distinct service identities because the broker authenticates the
application by its exact UID:

- `logic-engine-broker`: owns the manifest, rollback anchor and protected role
  directories; primary supplementary access group is `logic-engine-app`.
- `logic-engine-app`: runs Node/SQLite and has no write access to protected
  role directories. It can traverse the broker socket directory and connect
  through the app group only.

Before installing the units, provision the accounts and protected paths as
root. The following is an illustrative first-time setup; inspect existing
accounts and directories before running it:

```sh
groupadd --system logic-engine-app
useradd --system --gid logic-engine-app --home-dir /nonexistent --shell /usr/sbin/nologin logic-engine-app
useradd --system --gid logic-engine-app --home-dir /nonexistent --shell /usr/sbin/nologin logic-engine-broker

install -d -o logic-engine-broker -g logic-engine-app -m 0700 /var/lib/logic-engine-broker/manifest
install -d -o logic-engine-broker -g logic-engine-app -m 0700 /var/lib/logic-engine-broker/anchor
install -d -o logic-engine-broker -g logic-engine-app -m 0700 /var/lib/logic-engine-broker/roles/core
install -d -o logic-engine-broker -g logic-engine-app -m 0710 /var/lib/logic-engine-sqlite-alias
```

Create `/etc/logic-engine/sqlite-broker.env` as root, owned by
`root:logic-engine-app`, mode `0640`. It must contain the actual numeric
IDs and Host-owned logical alias values:

```sh
LOGIC_ENGINE_APP_UID=$(id -u logic-engine-app)
LOGIC_ENGINE_APP_GID=$(getent group logic-engine-app | cut -d: -f3)
LOGIC_ENGINE_BROKER_UID=$(id -u logic-engine-broker)
LOGIC_ENGINE_BROKER_SOCKET=/run/logic-engine-sqlite-broker/broker.sock
LOGIC_ENGINE_VFS_ROLE_PATH=/var/lib/logic-engine-sqlite-alias/core.sqlite
LOGIC_ENGINE_VFS_ROLE_NAME=core
```

The file is configuration, not a shell script: replace the command
substitutions with their numeric results before saving it. The broker service
uses the UID/GID values; the app reads the same root-owned file to bind the
strict VFS to the expected broker UID, socket and logical role.

The manifest and rollback anchor must be initialized by the broker identity
before the broker service can start. Enroll a new main DB only after that
initialization, using the manifest-store administrative CLI as
`logic-engine-broker`; the `enroll` command creates a new file and refuses
to adopt an existing database. Main DB disable/rename/delete require the
application to be stopped and the explicit `--confirm-quiesced` flag.
Never expose those administrative commands on the application socket.

Install both units, run `systemd-analyze verify`, and confirm that the broker
reaches its startup-reconciliation-ready state before starting the app. The
application's logical alias directory is deliberately not writable by the app;
do not add it to `ReadWritePaths`. The broker's actual role directory remains
inaccessible to the app.

**Deployment limitation:** these unit definitions and identity instructions
are a POSIX deployment slice, not a completed installer. Initial manifest
generation, trusted environment-file provisioning, actual host-specific UID
verification, complete custom SQLite file methods and independent Security
review are still release gates. Do not enable production DB roles using the
current probe.

## Windows service

Run elevated PowerShell from a trusted installation directory. First use -WhatIf, inspect the paths, then rerun without -WhatIf:

    .\install-windows-service.ps1 -ServiceName LogicEngine -InstallDirectory C:\LogicEngine -StateDirectory C:\ProgramData\LogicEngine\State -WhatIf

The script refuses to replace an existing service, requires the install and state directories to be separate trees, creates a virtual service account (NT SERVICE\\<ServiceName>), enables its service SID, and removes inherited ACLs from both trees. The service SID receives read/execute on application binaries and full access only to the state directory; SYSTEM and local Administrators retain full access. An optional environment file is readable by the service SID and writable by SYSTEM/Administrators. If provisioning fails, the script deletes the partially created service. The parent directories containing the install and state trees must themselves be administrator-controlled and not writable by untrusted users; the script hardens the target trees but does not recursively audit every ancestor ACL. Prefer Program Files for binaries and ProgramData for state.

Configure all Logic-Engine SQLite paths beneath the protected state directory. Keep application binaries read-only to the service identity. Do not grant Users, Authenticated Users or unrelated service SIDs write/delete access to the DB directory.

## Operational constraints

- Do not run the production SQLite owner as an interactive administrator.
- Do not run SillyTavern, ST-VectorService or unrelated extensions under the Logic-Engine service identity. Each independently writable SQLite store needs its own owner boundary.
- Backups/restores require an authorized maintenance identity and a quiesced/checkpointed procedure; do not grant backup agents general write access to the live DB directory.
- A service identity is not a sandbox against code already executing as that identity.
- The Windows script does not install Node, application files, secrets, firewall rules or the native VFS.
- This is a deployment building block, not proof that current DB opens route through a secure VFS.
