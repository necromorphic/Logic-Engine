# Core/storage performance budget — initial replay baseline

Status: adopted initial investigation thresholds for the synthetic benchmark; not a production SLA and not yet an automatic CI failure gate.

## Measurement basis

- Benchmark: [Replay growth benchmark run #4](https://github.com/necromorphic/Logic-Engine/actions/runs/40091577872), main commit 95e321878f608214403a747ca14b06dd01df52e1.
- Environment: GitHub-hosted ubuntu-latest, Node v22.13.0, linux/x64.
- Each seed event has one entity upsert, one fact claim, and one relationship transition.
- Wall time is the median of three uninstrumented samples; SQL/replay counters come from an equivalent instrumented fixture.
- The fixture uses 10,000 independent canonical events for commit, independent rollback, and rebuild; causal-chain rollback uses 10,000 events linked in one chain. This is not a production traffic distribution.

## 10,000-event baseline and investigation thresholds

| Operation | Observed median | Initial investigation threshold |
| --- | ---: | ---: |
| Commit one new event and rebuild projections | 608 ms | 1.25 s |
| Roll back one independent event, retaining most history | 699 ms | 1.50 s |
| Roll back a full causal chain | 261 ms | 600 ms |
| Full projection rebuild | 571 ms | 1.25 s |

Thresholds are approximately 2× the current medians, rounded to operationally readable values. A threshold breach is a signal to rerun the benchmark and profile the operation, not proof of a regression by itself. The benchmark runner and workload must be held constant when comparing runs.

## Workload counters at 10,000 events

- SQLite database size before the measured operation: 12,599,296 bytes.
- Independent commit: 40,020 SQL statement executions; 10,001 canonical event rows replayed.
- Independent rollback: 40,013 SQL statement executions; 9,999 canonical event rows replayed.
- Causal-chain rollback: 10,016 SQL statement executions; zero valid event rows replayed because the chain is fully invalidated.
- Full rebuild: 40,007 SQL statement executions; 10,000 canonical event rows replayed.

The per-event statement preparation in projection rebuild and the full-history scan in rollback are profiling targets. Do not add caches, checkpoints, or incremental replay solely from these numbers; any optimization must preserve deterministic rebuild, idempotency, revision/audit atomicity, and rollback semantics.

## Revisit conditions

Revisit thresholds after at least three successful main-branch benchmark runs on the same runner class, or when the production workload/effect distribution is characterized. If the benchmark is later made a hard CI gate, keep the threshold separate from test correctness and avoid flakiness from a single noisy sample.
