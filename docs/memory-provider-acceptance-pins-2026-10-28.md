# Memory Provider acceptance — immutable test pins

**Record date:** 2026-10-28  
**Purpose:** freeze source/runtime identities before running acceptance items B–F. This is a test manifest, not a production-readiness approval.

## 1. Source pins

| Component | Exact pin | Role in acceptance |
|---|---|---|
| Logic-Engine main baseline | `c19558a9684c4538c8cacdd051013f92dd4aadad` | Immutable mainline baseline used to start this acceptance record. [Commit](https://github.com/necromorphic/Logic-Engine/commit/c19558a9684c4538c8cacdd051013f92dd4aadad) |
| Provider accepted-head / protected-dispatch integration | `1ad46f96161778d8cf6f1bc66e8db31d56593f65` | Exact merge commit that introduced Provider accepted-head revocation and the pre-dispatch gate. [Commit](https://github.com/necromorphic/Logic-Engine/commit/1ad46f96161778d8cf6f1bc66e8db31d56593f65) |
| Earlier Provider-local persistence baseline | `9ca95312b35d6431699d736aef721602d26639f8` | Historical Provider-local raw archive/lifecycle baseline only; not the current acceptance target. |
| SillyTavern Host target | `06bde939fb1e9c4c8d8641d810f0a916b5bce127` | Exact upstream source commit; reported release description `1.19.0-1-g06bde939f`. [Pinned source](https://github.com/SillyTavern/SillyTavern/tree/06bde939fb1e9c4c8d8641d810f0a916b5bce127) |

The main baseline and Provider merge commit are intentionally recorded separately: the first identifies the mainline snapshot for this acceptance; the second identifies the commit that introduced the Provider gate. Do not substitute a moving branch name such as `main` for either SHA when reproducing results.

## 2. Declared project/runtime versions

- Logic-Engine package version: `0.2.0` (root `package.json` at the pinned main baseline).
- Logic-Engine Node requirement: `>=22.13.0`.
- Provider acceptance CI Node version: `22.13.0` (declared in the Provider blocker workflow).
- Host pinned-source CI Node version: `22.13.0` (declared in the Host pinned-source workflow).
- User-reported Termux Node version for the installed SillyTavern checkout: `v24.17.0`.
- User-reported Windows tooling from prior setup: Node `v22.18.0`, npm `10.9.3`, Git `2.50.1`; these are workstation tooling, not proof that acceptance tests ran under them.

## 3. Execution environments and evidence boundary

| Environment | What is pinned/known | What it does not prove |
|---|---|---|
| GitHub-hosted Linux CI | Workflow selects Ubuntu runner and Node `22.13.0`; source is checked out by SHA in the relevant pinned-source workflow. | Does not prove behavior on the user's Windows or Android/Termux installation. |
| Self-hosted Windows CI | Repository has a Windows runner used by Runtime and pinned-source workflows. | Runner OS build, installed npm/SQLite versions, and a fresh successful run for every future SHA must be captured from that run; do not infer them from the runner label. |
| User's Termux SillyTavern | Target SHA and reported Node `v24.17.0` are recorded above. | No new live launch, event trace, or restart experiment is claimed by this manifest. |
| User's Windows workstation | Previously reported Node/npm/Git versions are listed above. | No local Provider or SillyTavern test execution is claimed here. |

## 4. Reproduction rules

1. Check out Logic-Engine at `c19558a9684c4538c8cacdd051013f92dd4aadad` for the acceptance baseline; inspect Provider integration as introduced by `1ad46f96161778d8cf6f1bc66e8db31d56593f65`.
2. Check out SillyTavern at `06bde939fb1e9c4c8d8641d810f0a916b5bce127` for Host source inspection.
3. Record the exact tested commit for every CI run. A pass on a nearby PR head is not evidence for a different SHA.
4. Record actual `node --version`, `npm --version`, OS/runner image, SQLite library/runtime version, and dependency installation command from each run when the test harness exposes them. If not captured, label them unknown rather than guessing.
5. Keep production Memory→NPC `DISABLED / FAIL-CLOSED` throughout acceptance.

## 5. Pinning result

**Source identity pin: PASS.** Exact main baseline, Provider integration commit, and SillyTavern target SHA are fixed above.

**Full environment fingerprint: PARTIAL.** Declared Node versions and known workstation versions are recorded, but exact Windows runner image/npm/SQLite versions and a fresh all-environment run against this pinned baseline are not established by this record. This gap must not be hidden by calling the environment fully reproducible.
