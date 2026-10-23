# 09. External reuse and attribution register

Status: initial research register. Repository code has not been imported by this document. Verify license metadata at the exact commit before copying any implementation.

## 1. Reuse categories

- **Reuse as-is:** only after API, runtime, tests, license, and invariants match.
- **Adapt:** copy or port a small isolated component after license review and add our own tests.
- **Reference only:** adopt a design pattern without copying source code.
- **Reject:** incompatible semantics, unsafe dependencies, incompatible license, or conflict with non-negotiable requirements.

A project README or architecture document is evidence of intended design, not proof that all behavior works.

## 2. Initial project map

| Project | Candidate pattern | Initial treatment | Verification still required |
| --- | --- | --- | --- |
| [SillyTavern InnerLore](https://github.com/ChrisDitfort/SillyTavern-InnerLore) | ST history changes, branch-aware state, provenance, SQLite, delivery receipts | Adapt patterns; inspect implementation | Exact lifecycle hooks, rollback correctness, multi-source knowledge, dependency graph, license at pinned commit |
| [Immersive Worlds](https://github.com/SenjuWoo/ImmersiveWorlds) | ST extension boundary, validated state patch, player-agency invariants, tests | Adapt patterns | Host compatibility, test coverage, stale generation behavior |
| [Narrative Engine](https://github.com/Sagesheep/NarrativeEngine-P) | durable campaign state, off-screen NPC continuity, timeline, scoped knowledge | Investigate for selective adaptation | Exact rollback code/tests, concurrency, dependency graph, license at pinned commit |
| [Mnehmos Engine](https://github.com/mnehmos/mnehmos-engine) | proposal/validation/commit, canonical vs derived data, ordered tick, save/load/fork | Adapt contracts, not ontology | License at pinned commit, fit of storage/event contracts, unnecessary complexity |
| [WorldLines](https://github.com/LudicDynamics/WorldLines) | world authority vs private NPC agents, orchestration separation | Reference only unless licensing permits more | Exact terms for each artifact; core redistribution constraints |
| [SillyTavern State Engine](https://github.com/StygianTechnica/SillyTavern-StateEngine) | typed presets and lightweight state editor | Optional UI reference | Host compatibility, maintenance status, no authority over canonical engine state |

## 3. Mandatory attribution record for any imported code

Before import, create an entry with:
- source repository URL;
- immutable commit SHA;
- source path and line range or file;
- license identifier and required notices;
- copyright notice if required;
- modifications made;
- dependency/security review;
- tests copied/adapted/added;
- final treatment decision.

Do not copy code from a mutable `main` branch without pinning the source commit.

## 4. License caution

The license summaries in this research register are provisional. Confirm the LICENSE file and relevant path-level notices at the exact commit before any code is copied. For WorldLines, do not assume the engine core is available for redistribution merely because example files are public.
