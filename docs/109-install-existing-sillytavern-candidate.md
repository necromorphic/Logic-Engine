# Install the Logic-Engine candidate into an existing SillyTavern 1.19.0 copy

This installs the current checkout as a **server plugin** in the selected SillyTavern folder and applies the managed Final-Send patch to that same folder. It does not install into a clean/new Tavern, start SillyTavern, or enable Memory → NPC.

## Preconditions

- Windows PowerShell.
- SillyTavern 1.19.0 source checkout matching the pinned build accepted by Patch Manager.
- Node.js >=22.13.0 and Git available.
- Logic-Engine checkout has its dependencies installed with `npm install` (the repository does not provide a package lock for `npm ci`).
- Use a disposable ST profile/copy for first acceptance. Back up that copy before installing.
- Keep LOGIC_ENGINE_MEMORY_NPC_ENABLED unset or false.

## Install

From the Logic-Engine checkout:

```powershell
npm ci
npm run host:install:st -- -SillyTavernRoot "C:\Path\To\Your\SillyTavern"
```

The installer:
1. verifies Node and SillyTavern version;
2. creates SillyTavern\plugins\logic-engine as a junction to this Logic-Engine checkout (refuses to overwrite an existing plugin directory);
3. runs Patch Manager preflight, install and verify against the selected ST root;
4. leaves the server stopped.

The installed plugin is a managed copy, not a junction. Re-run installation only after preserving/removing the existing plugin copy and reviewing its state. The source checkout remains the development workspace.

## Enable the server-plugin loader

In the selected ST copy's default/config.yaml, set:

```yaml
enableServerPlugins: true
enableServerPluginsAutoUpdate: false
```

Disable auto-update because this plugin is a junction to the candidate checkout; ST must not run an implicit git update against it. Do not change any other plugin settings.

## First startup and smoke test

1. Start the **existing selected ST copy** normally.
2. Confirm the console reports the Logic Engine plugin and the managed Final-Send patch as installed.
3. Open the status endpoint from the same authenticated ST browser session: /api/plugins/logic-engine/final-send/status
4. Expected while Memory → NPC is disabled: HTTP 200, patch installed/verified, Gateway DISABLED_FAIL_CLOSED.
5. Send an ordinary message using the existing configured model. This checks that native generation still works through the managed hook; it does **not** test protected Memory or authorize enabling it.

Stop if plugin initialization fails, patch verification is not installed/verified, or ordinary generation does not work. Preserve the console error and do not enable Memory → NPC.

## Uninstall / restore

Stop SillyTavern first. From the Logic-Engine checkout:

```powershell
node scripts/sillytavern-patch-manager.mjs uninstall --st-root "C:\Path\To\Your\SillyTavern" --extension-root "$PWD"
```

Then remove only the junction SillyTavern\plugins\logic-engine (not the Logic-Engine checkout). Patch Manager restores only its verified preimage files.
