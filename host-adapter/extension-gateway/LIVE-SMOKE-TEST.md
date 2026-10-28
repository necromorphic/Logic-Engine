# Live SillyTavern smoke test — review only

**Status:** manual verification checklist. This is not production approval. Memory → NPC remains DISABLED / FAIL-CLOSED.

## Target and prerequisites

- SillyTavern source revision: `06bde939fb1e9c4c8d8641d810f0a916b5bce127`
- Logic-Engine prototype PR: [#595](https://github.com/necromorphic/Logic-Engine/pull/595)
- Run only against a disposable test copy of SillyTavern, never the user's working instance.
- Do not use real/private chat content, credentials, or arm protected dispatch. No approved dispatch callback exists.

## Test steps

1. Check out the pinned SillyTavern revision in a separate test directory.
2. Copy the contents of this PR's `host-adapter/extension-gateway/` directory (the runtime files are `manifest.json`, `index.js`, and `gateway-policy.mjs`) into:
   `public/scripts/extensions/third-party/logic-engine-extension-gateway/`
3. Start the test instance using the usual SillyTavern startup process.
4. Verify the extension appears in the normal extension UI and that the browser console has no module-load or manifest errors.
5. Open a disposable test chat and run one ordinary generation without arming a protected request.
6. Confirm the ordinary generation completes as it did before installing the extension.
7. Stop the test instance and inspect logs/console for errors.

## Expected result

- Extension loads using SillyTavern's manifest-declared generation interceptor.
- Ordinary generation passes through when no protected request is armed.
- No new server endpoint or provider API integration is introduced.

## Fail conditions

- Extension fails to load, the manifest/interceptor is not recognized, or console errors appear.
- Ordinary generation fails or changes behavior.
- Any unexpected network request, protected dispatch, or chat-text logging is observed.

Record the exact SillyTavern commit, browser/runtime version, observed result, and relevant error messages in the PR before considering follow-up changes.

## Limits

Passing this smoke test proves only basic loading and normal-generation compatibility on this pinned instance. It does not prove that other extensions, custom routes, media routes, or server-side callers cannot send requests. It does not test or approve Core/Memory/NPC dispatch, authorization, source-currentness/revocation, or response rendering. Do not merge or enable in production based on this checklist alone.
