# Memory Provider acceptance — immutable test pins

**Record date:** 2026-10-28  
**Purpose:** freeze source/runtime identities before running acceptance items B–F. This is a test manifest, not a production-readiness approval.

## 1. Source pins

| Component | Exact pin | Role in acceptance |
|---|---|---|
| Logic-Engine main baseline | `c19558a9684c4538c8cacdd051013f92dd4aadad` | Immutable mainline baseline used to start this acceptance record. [Commit](https://github.com/necromorphic/Logic-Engine/commit/c19558a9684c4538c8cacdd051013f92dd4aadad) |
| Provider accepted-head / protected-dispatch integration | `1ad46f96161778d8cf6f1bc66e8db31d56593f65` | Exact merge commit that introduced Provider accepted-head revocation and the pre-dispatch gate. [Commit](https://github.com/necromorphic/Logic-Engine/commit/1ad46f96161778d8cf6f1bc66e8db31d56593f65) |
| Earlier Provider-local persistence baseline | `9ca95312b35d6431699d736aef721602d26639f8` | Historical Provider-local raw archive/lifecycle baseline only; not the current acceptance target. |
| Acceptance CI merge ref | `3e90b08142bfcfdaa008243272eddb4dc8a76638` | Exact PR #645 merge ref checked out by the Provider acceptance and Runtime Linux jobs; see run links in §3. |
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
| Provider acceptance + Runtime Linux CI | Ubuntu `24.04.5 LTS`, image `ubuntu-24.04` version `20261025.353.1`, x64; Node `22.13.0`, npm `10.9.2`, built-in `node:sqlite` SQLite `3.47.2`; Git `2.56.0`; runner version `2.338.0`. Captured by [Provider blocker run #40744298084](https://github.com/necromorphic/Logic-Engine/actions/runs/40744298084) on merge ref `3e90b08142bfcfdaa008243272eddb4dc8a76638`. Provider focused acceptance passed `23/23`; full Runtime passed `1036/1036` and recalculation oracle passed `20/20`. | This is the reproducible CI acceptance environment; it does not prove behavior on the user's Windows or Android/Termux installation. |
| Existing self-hosted Windows CI evidence | Windows runner `DESKTOP-77V96AV`, runner version `2.338.0`, Git `2.50.1.windows.1`, Node `v22.18.0`; prior pinned-source audit used the exact SillyTavern SHA. See [Host pinned-source audit run #40435238767](https://github.com/necromorphic/Logic-Engine/actions/runs/40435238767). | npm and embedded SQLite versions were not emitted by that older run. The current Provider acceptance workflow targets Linux; do not treat the older Windows run as a fresh Provider acceptance run. |
| User's Termux SillyTavern | Target SHA and reported Node `v24.17.0` are recorded above. | No new live launch, event trace, or restart experiment is claimed by this manifest. |
| User's Windows workstation | Previously reported Node/npm/Git versions are listed above. | No local Provider or SillyTavern test execution is claimed here. |

## 4. Reproduction rules

1. Check out Logic-Engine at `c19558a9684c4538c8cacdd051013f92dd4aadad` for the acceptance baseline; inspect Provider integration as introduced by `1ad46f96161778d8cf6f1bc66e8db31d56593f65`.
2. Check out SillyTavern at `06bde939fb1e9c4c8d8641d810f0a916b5bce127` for Host source inspection.
3. Record the exact tested commit for every CI run. A pass on a nearby PR head is not evidence for a different SHA.
4. The Provider acceptance workflow now prints Node, npm, built-in SQLite, platform/architecture, and OS image versions before running tests. Preserve that fingerprint with each run. The older Windows run's npm/SQLite versions remain unknown; do not infer them.
5. Keep production Memory→NPC `DISABLED / FAIL-CLOSED` throughout acceptance.

## 5. Pinning result

**Source identity pin: PASS.** Exact main baseline, Provider integration commit, and SillyTavern target SHA are fixed above.

**Provider CI environment fingerprint: PASS.** The exact Linux OS image, architecture, Node/npm/SQLite/Git/runner versions and the tested merge-ref SHA are captured; the Provider focused acceptance and full Runtime/oracle jobs passed on that merge ref.

**Other environments: PARTIAL by design.** Windows CI evidence is historical and does not include npm/SQLite versions; no new local Windows Provider run or live Android/Termux SillyTavern run is claimed. Those are separate deployment/runtime checks, not silently substituted for the pinned CI environment.
