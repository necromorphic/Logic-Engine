# Install the existing SillyTavern candidate

This procedure installs the first-party Logic Engine runtime and prepares an existing SillyTavern 1.19.0 copy for the Host patch bundle.

## Preconditions

- Use a disposable SillyTavern 1.19.0 copy, not the daily profile.
- Node.js 22.13.0 or newer and npm are available.
- The Logic Engine checkout is on the intended integration commit.
- Back up the target SillyTavern directory and its user data before installation.
- Do not run the procedure over an existing plugins/logic-engine directory without first verifying its ownership and preserving it.

## 1. Install repository dependencies

From the Logic Engine repository root:

```powershell
npm install
```

Use npm install, not npm ci: the repository does not currently provide a committed root package-lock file.

## 2. Install the root Logic Engine runtime

```powershell
npm run host:install:st -- -SillyTavernRoot "C:\Path\To\SillyTavern"
```

The installer creates a managed copy at plugins/logic-engine, installs the Gateway server-plugin package, and applies/verifies the managed Final-Send patch.

It does not create a junction. It refuses to overwrite an existing managed plugin directory. If the target already contains plugins/logic-engine or plugins/logic-engine-extension-gateway, stop and inspect the existing installation instead of deleting or replacing it blindly.

## 3. Host patch bundle (installed by the same command)

The `host:install:st` installer already invokes the Host patch-bundle installer after installing the root runtime and Gateway server plugin. Do not run `host:install:bundle` a second time during this first-install procedure.

The bundle installer:

- verifies the pinned SillyTavern 1.19.0 source;
- verifies the existing root Logic Engine entrypoint, manifest, and package identity;
- applies the three reviewed Host patches;
- installs the Gateway server plugin and browser extension;
- creates a pinned source manifest;
- backs up every managed file before replacement;
- rolls back a partial installation if any verification fails.

It does not overwrite the root Logic Engine plugin, its Final-Send patch state, user profiles, chats, or databases. Unknown server plugins and third-party browser extensions are rejected.

## 4. Verify before starting SillyTavern

Confirm these paths exist:

- plugins/logic-engine
- plugins/logic-engine-extension-gateway
- public/scripts/extensions/third-party/logic-engine-extension-gateway
- plugins/logic-engine-extension-gateway/pinned-source-manifest.json

When Host authority is configured, both first-party server plugins must load: the root runtime registers Final-Send, and the Gateway provides the Host ingress. No other server plugin is accepted.

Keep Memory → NPC disabled during this installation and initial Windows acceptance. Do not enable LOGIC_ENGINE_MEMORY_NPC_ENABLED as part of this procedure.

See [Phase 2 Windows live acceptance preparation](110-phase2-windows-live-acceptance-preparation.md) for the post-install checks.
