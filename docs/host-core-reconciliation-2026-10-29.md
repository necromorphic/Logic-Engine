# Host/Core documentation reconciliation and local test record — 29 Oct 2026

## Scope and evidence

This report compares the supplied Logic-Engine source snapshot, the supplied SillyTavern source archive, the Host lifecycle prototype and its docs, and the Core's actual capture endpoint/tests. The Logic-Engine ZIP identifies source snapshot commit `de0d8d10faf71c521fc68f246f7322963abd41ab`; the SillyTavern ZIP identifies target commit `06bde939fb1e9c4c8d8641d810f0a916b5bce127`.

Evidence collected in an isolated temporary checkout on 29 Oct 2026:
- Node.js `v22.16.0`; npm `10.9.2`.
- `npm test`: **800/800 passed**, 0 failed.
- `node --test host-adapter/prototype/tests/*.test.mjs`: **71/71 passed**, 0 failed.
- `git apply --check host-adapter/prototype/patches/sillytavern-1.19.0-lifecycle-hooks.patch` against the supplied SillyTavern archive: **PASS**.
- No installed SillyTavern was modified. The local isolated run did not test the installed desktop host. Afterward, the PR checks ran on the self-hosted Windows runner and on an isolated Chromium process-restart harness, detailed below.

## Confirmed documentation discrepancies

### D-01 — PR #323 status is stale in Host docs
The docs say PR #323 remains Draft/unmerged. GitHub currently reports PR #323 merged into `main` on 26 Oct 2026. This is a status-documentation error, not a readiness approval. The code still explicitly marks itself review-only and leaves Memory→NPC fail-closed.

### D-02 — the “current exact-head CI” paragraph cites the initial, unsafe candidate
`docs/27-host-adapter-lifecycle-evidence.md` labels HEAD `504057e4103452442dd3cb1256ba06ff5afbeeaa` as “current exact-head CI”, while the same document says later commits corrected raw-text retention. The initial SHA must be described as historical evidence, not evidence for the corrected head. The prototype README records later exact-head CI for `d7686b89a051cd28566a0f19bead42b0a9bd5bd5` and `f97a4f4b2a76d0d76b82c37d61ee187b89ee7ceb`.

### D-03 — test counts must be scoped to a source snapshot
Prior status notes mention 802 Core tests, while the supplied snapshot identified as `de0d8d10faf71c521fc68f246f7322963abd41ab` runs 800 Core tests. The Host prototype suite is separate and runs 71 tests. These counts are not interchangeable; future reports must record the exact source SHA, command and result.

### D-04 — transport exists, but it is not a complete Host/Core contract
The Host prototype's same-origin server proxy sends only `conversation_id`, `message_id`, `version_id`, `content_sha256`, `active` and `deleted` to `/v1/host-version-ledger/capture`; it omits `parent_version_id`, which the current Core endpoint requires. Therefore requests through this proxy do **not** satisfy the current Core contract and are rejected (HTTP 400) until the transport is corrected. PR #704 was merged into `main` on 30 Oct 2026 as commit `d234b142a3b05fecb179dd7dceddbbc602cd53c7`; it carries `parent_version_id` through the bridge/proxy/Core path and adds parent-first publication. This resolves the documented wire-contract omission in the merged implementation. It does not establish complete Host inventory, support for import/restore/copy/deletion paths, or production Memory→NPC readiness. The intended transport remains digest-only; this is not production readiness or proof of a complete source inventory.

The Host docs correctly identify missing lifecycle paths: non-current chat deletion, group/recursive deletion, import/restore, branch/copy, migration, external edits, rollback, and restart/replay. Current-message hooks cannot establish a complete affected-version set for these operations. Core cannot infer source completeness from Provider ledger rows or a successful capture response.

### D-05 — CI/source tests are not live Host acceptance
The current tests and patch apply check prove code-level invariants and patch applicability only. They do not prove:
- that the patch has been installed on any working SillyTavern instance;
- browser IndexedDB durability after actual browser/process restart;
- a real Windows SillyTavern↔Core request with authenticated adapter binding;
- exact persisted before/after state for destructive/import/restore paths;
- final disclosure authorization/revocation immediately before provider dispatch;
- Android/Termux behavior.

## Additional CI evidence completed after the local run

The documentation/CI PR ran all configured checks successfully:

- [Runtime tests, self-hosted Windows](https://github.com/necromorphic/Logic-Engine/actions/runs/40916731851): Node.js `v22.18.0`; Core `npm test` **1080/1080 passed**; Host lifecycle prototype **71/71 passed**; recalculation oracle **20/20 passed**.
- [Pinned Host source audit, self-hosted Windows](https://github.com/necromorphic/Logic-Engine/actions/runs/40916731876): pinned-source lifecycle assertions **7/7 passed** and bounded fake-provider harness **1/1 passed**.
- [Host lifecycle patch check](https://github.com/necromorphic/Logic-Engine/actions/runs/40916731837): patch application and Host prototype tests **PASS**.
- [Host lifecycle patch validation](https://github.com/necromorphic/Logic-Engine/actions/runs/40916731782): patch application, lint and syntax checks **PASS**.
- [Chromium IndexedDB process-restart test](https://github.com/necromorphic/Logic-Engine/actions/runs/40916731780): **PASS**. This is a real Chromium process-restart test on the CI host, not a test of the installed SillyTavern profile or Android/Termux.

These checks validate the repository, pinned source patch and bounded harnesses. They still do not establish full Host inventory, real installed-ST end-to-end behavior, or Memory→NPC production readiness.

## Required disposition

- Keep Memory→NPC **DISABLED / FAIL-CLOSED**.
- Do not modify the installed SillyTavern or enable production listeners.
- Treat complete Host inventory as **NON_READY / NO SUCH MECHANISM FOUND** until all mutation routes and persisted-state evidence are covered.
- The current Core capture endpoint is digest-only; it is not evidence of raw-content capture, authorized retrieval, NPC admission, or belief.

## Windows PC validation sequence

Run in an isolated Logic-Engine checkout, not by applying the patch to the installed SillyTavern. The GitHub PR validation should run the repository's self-hosted Windows runtime job; use its job logs as the first Windows evidence. For a direct local run from the Logic-Engine root:

```powershell
node --version
npm --version
npm test
node --test host-adapter/prototype/tests/*.test.mjs
node --test experiments/recalculation-oracle/harness.test.mjs
```

For the Host source/transport checks, use the repository workflow that checks out the exact pinned SillyTavern SHA into a separate workspace and runs `experiments/host-adapter-source-audit/harness.mjs` plus `experiments/host-adapter-runtime-harness/harness.mjs`; this also passed on the self-hosted Windows runner. Do not point this workflow at the installed SillyTavern directory. These are bounded source/fake-provider probes; they still do not replace the full lifecycle acceptance matrix.
