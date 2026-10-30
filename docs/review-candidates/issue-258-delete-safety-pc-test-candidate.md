# Issue #258 — delete-safety PC candidate

Status: review candidate; not installed; not production-approved.

## Approved scope

Core approved Direction A for preparation only:
- UI fail-closed for missing, stale, or mismatched edit selection; DOM-index substitution is prohibited.
- Validate the delete target before dereference in `deleteMessage()`.
- Revalidate exact message identity after asynchronous confirmation/write-ahead boundaries.
- Protect `deleteSwipe()` and `deleteLastMessage()` independently.
- Treat `/delname` as a separate lifecycle mutation path.
- Cover stale-but-in-range indices, chat switching during await, swipe deletion, last-message deletion, and `/delname` in tests.

No new Core API/schema/store, merge, or production Memory→NPC activation is authorized by this preparation decision.

## Tested source snapshots

- Logic-Engine GitHub main baseline observed 2026-10-30: `efc02d2b290b2c08d6621fe9eb75570ae4486102`.
- Uploaded Logic-Engine source archive: the candidate patch applies cleanly with `git apply --check`.
- SillyTavern pinned target: `06bde939fb1e9c4c8d8641d810f0a916b5bce127`; candidate patch applies cleanly.

The Logic-Engine archive has no `.git` metadata. It contains the source snapshot used for the archive-based run; this is not represented as a fresh checkout of GitHub main.

## Reproducible checks run 2026-10-30

- Logic-Engine full suite on uploaded archive snapshot after patch: **802/802 passed**.
- Host lifecycle focused suite: **7/7 passed**.
- Logic-Engine candidate patch: `git apply --check` passed.
- SillyTavern candidate patch: `git apply --check` passed.
- `node --check` on all seven changed SillyTavern JavaScript files: passed.

Correction: an earlier documentation revision incorrectly recorded 800/800. The actual captured test run reports **802/802**; 800/800 is superseded.

These are source/archive checks, not browser or live-PC runtime evidence. The full suite was run on the uploaded archive, not a fresh checkout of current GitHub main. Re-run on the isolated current-main worktree after porting the patch.

## Git-hosted patch artifact

The Logic-Engine patch is committed in this branch as Base64-encoded ZIP:
`docs/review-candidates/artifacts/issue258-logic-engine-delete-safety-patch.zip.b64`

Decode on Windows PowerShell:
```powershell
$encoded = Get-Content .\docs\review-candidates\artifacts\issue258-logic-engine-delete-safety-patch.zip.b64 -Raw
[IO.File]::WriteAllBytes("$PWD\issue258-logic-engine-delete-safety-patch.zip", [Convert]::FromBase64String($encoded))
Expand-Archive .\issue258-logic-engine-delete-safety-patch.zip -DestinationPath .\issue258-patch
```

ZIP SHA-256: `db33a06eaa04cac6f262cc91534d215c7ebaca4d26176be29ab835774587fd91`
Contained patch SHA-256: `9ca913c1d2d3674c5398df90a41c6049b68d5065090eb29bce3a2a6cf4a2a8d7`
SillyTavern lifecycle patch SHA-256: `4c79329ce1fcab2b782b12ff59875e6b465883c2f6eaf1e6331dd6cbad244f23`

The existing pinned SillyTavern lifecycle patch artifact is already tracked at `host-adapter/prototype/patches/sillytavern-1.19.0-lifecycle-hooks.patch`; the delete-safety candidate modifies that artifact. The candidate Logic-Engine patch is provided above for reproducibility; it has not yet been ported to a fresh current-main checkout.

## PC test boundary

Use only isolated copies:
- ST: `C:\\AI\\SillyTavern-issue258`, port `8010`, data root `C:\\AI\\SillyTavern-issue258-data`.
- Logic-Engine: `C:\\LogicEngine\\Logic-Engine-issue258-host`.

Do not touch the primary ST on port `8000`. Do not start a second Core instance. Use a disposable test chat, not RP history.

Required browser scenarios: UI edit/delete; missing/stale selection fail-closed; alternate swipe deletion; last-message deletion; `/delname`; chat switch during awaited deletion; cancellation; restart and journal reconciliation.

## Remaining acceptance limits

Chat-file deletion, clear/reload ambiguity, import/restore, branch/copy, external edits, backup/restore, and real browser/device persistence remain separate gates. Pre-enrollment history remains `UNKNOWN_UNRECOVERABLE`. Host remains `NON_READY`; Memory→NPC remains `DISABLED / FAIL-CLOSED`.
