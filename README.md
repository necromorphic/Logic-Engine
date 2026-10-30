# World Simulation Engine — «Логический движ»

**«Логический движ» — универсальный движок длительной ролевой симуляции.** Его задача — хранить авторитетное состояние мира, проверять и фиксировать причинно связанные изменения, управлять игровым временем и длительными процессами, поддерживать границы знаний персонажей и передавать подтверждённые результаты в интерфейс через адаптеры.

> **Актуальность: 30 октября 2026 года.** Документ обновлён по загруженному архиву `Logic-Engine-main (1).zip`, приложенным материалам `Security 1.1` и `Координатор 2.16`, а также результату локального запуска тестов. Архив не содержит Git-метаданных: точный SHA его исходного состояния установить нельзя. Статусы PR и issues следует сверять с GitHub перед принятием решений о merge.
>
> **Состояние проекта:** в репозитории есть исполняемый Node.js/SQLite-прототип с HTTP API, каноническим журналом и проекциями, предложениями изменений, ограниченным исполнением механик, авторизованным чтением, отношениями, временными операциями, длительными процессами и Memory Provider. Реализация состоит из отдельных runtime-срезов и экспериментальных интеграционных границ. Это ещё не завершённая автономная симуляция и не production-ready интеграция с SillyTavern.
>
> **Проверка этого архива:** `npm test` завершился успешно — **800/800 тестов, 0 failures, 0 skipped** (30.10.2026, около 34 секунд). Результат относится только к предоставленному архиву и не устанавливает его Git SHA или соответствие текущему удалённому `main`.
>
> **Memory → NPC: DISABLED / FAIL-CLOSED для production.** В репозитории есть Provider-local операции, Core trust/authorized-read примитивы и тестируемые NPC boundary-компоненты. Они не доказывают полный реальный путь Host → Provider → Core → NPC → финальный serializer/outbound transport. Не включать production disclosure до закрытия обязательных gates из [issue #264](https://github.com/necromorphic/Logic-Engine/issues/264).

## Краткая оценка состояния

Проценты прогресса в этом README намеренно не приводятся: доступные материалы не содержат единой актуальной и воспроизводимой методики подсчёта готовности всех блоков. Количество файлов, тестов или merged PR само по себе не является процентом готовности.

| Направление | Подтверждённое состояние в архиве | Основное ограничение |
|---|---|---|
| Core / каноническое состояние | HTTP API, SQLite-журнал, проекции, события, сущности, факты, аудит, идемпотентность и rollback-примитивы | Полная семантика независимых альтернативных причин и production-изоляция хранилища не доказаны |
| Proposal lifecycle / Mechanics | Реестр версионируемых шаблонов, экземпляры, ограниченный effect-intent translator, proposal/approval/commit и executor-срезы | Это не универсальный mechanic executor; policy-freshness и полный production approval gate остаются отдельными условиями |
| Time | TimePolicy, координаты, time advance/action, сегментация и сохраняемый world-scoped trigger registry | Нет фоновых часов и автоматического wall-clock scheduler; NPC delivery не следует из выполнения триггера |
| Process Manager | Контракты, API и runtime-срезы длительных процессов | Полная автономная симуляция и все требуемые lifecycle-сценарии не подтверждены |
| Relationships | Типизированные переходы и pure evaluation-срезы | Полная NPC-facing авторизация, причинная семантика и end-to-end потребитель требуют отдельной проверки |
| NPC / Knowledge | Actor bindings, ограниченный authorized read, candidate eligibility и Memory consumer boundary | Это не полная система приобретения знаний, доставки, понимания и убеждений |
| Memory Provider | SQLite-backed provider, raw archive/lifecycle, reconciliation и проверки гонок/отзыва на provider boundary | Provider не может самостоятельно доказать подлинность и полноту Host inventory |
| Host / SillyTavern | Прототип lifecycle bridge, digest proxy, inventory projection и pinned-source audit материалы | Реальные хуки, полный inventory и финальная outbound disclosure boundary не доказаны |
| World Pack | Формат, схемы и примеры профилей | Полный production loader и end-to-end применение пакета мира не подтверждены |

## Основной принцип

**Замысел ≠ происходящее ≠ рассказанное.**

1. Сюжетные арки описывают предполагаемые цели, опорные точки и допустимые варианты.
2. Симуляция вычисляет, что фактически произошло, на основании канонического состояния, правил мира, действий, знаний и причин.
3. Повествование отражает подтверждённые результаты и не создаёт канонические факты само по себе.

## Непереговорные требования

- Игровое время не продвигается само по себе: его изменение должно быть вызвано явной операцией. Наличие time triggers не означает наличие фоновых часов.
- Движок — источник авторитетного состояния. Языковая модель может предложить действие или сформулировать повествование, но предложение проходит проверку до канонического коммита.
- NPC должны автономно взаимодействовать друг с другом и миром, менять планы, формировать союзы и конфликты, ошибаться, сомневаться и пересматривать убеждения. Это целевые требования, а не заявление о завершённой реализации.
- Знания должны иметь происхождение и допустимый путь получения. Секреты не распространяются между персонажами без соответствующего источника, авторизации и доставки.
- Поддерживаются как заданные сюжетные арки, так и свободная симуляция с автономными событиями мира.
- Сохранённые задачи, планы и длительные процессы должны продолжаться независимо от того, помнит ли о них текущий контекст модели.
- Откат должен устранять зависимые последствия, сохраняя независимые ветви. Полная семантика альтернативных независимых причин пока не подтверждена.
- Векторный архив — средство поиска контекста, а не авторитетная база фактов. **Существующую векторизацию и Ollama remote-store patch не переписывать.**
- SillyTavern на Android/Termux остаётся RP-интерфейсом; Logic-Engine и его обработка должны работать на компьютере. Связь — по LAN, когда доступно, или через мост. Реальные хуки и надёжность интеграции необходимо проверять.
- Общее ядро не навязывает миру чужие механики. Специфические правила принадлежат отдельному World Pack; неизвестные механики явно маркируются.
- Архитектурный документ, открытый PR, fixture или успешный тест отдельного блока не доказывает production-ready end-to-end capability.

## Текущая граница реализации

| Область | Что есть в загруженном архиве | Что не следует считать завершённым |
|---|---|---|
| Core state и API | `src/api/server.js`, `src/application/engine.js`, `src/storage/sqlite-store.js`; события, проекции, сущности/факты, аудит, idempotency и API | Полная отказоустойчивость, внешняя single-writer изоляция и все production recovery guarantees |
| Snapshot и authorized read | Snapshot reads, actor bindings, field-level authorized-read service/API и соответствующие тесты | Наличие read endpoint само по себе не даёт NPC общего доступа к данным и не создаёт полноценную модель знаний |
| Source trust / freshness | Core-контракт `docs/77-core-memory-source-trust-contract.md`; проверки канонических event/entity/fact sources | Внешние Host/Memory источники без подтверждённой binding/version/lineage классифицируются как unverifiable и не должны раскрываться |
| Proposals и Mechanics | Реестр шаблонов/экземпляров, ограниченный translator (`create_entity`, `update_attribute`, `assert_fact`), proposal lifecycle и executor-срезы | Полноценное исполнение произвольных механик, универсальный пересчёт и закрытие policy-freshness gate |
| Recalculation | Oracle/тестовые контракты и ограниченные executor-компоненты | Oracle не является доказательством полного dependency-aware пересчёта canonical world state |
| Rollback | Транзакционные rollback-примитивы, projection rebuild и regression tests | Полная причинная семантика независимых альтернативных поддержек и все межблочные последствия |
| Relationships | Типизированные directed transitions и pure evaluation | Полный NPC-facing authorized read/write и end-to-end relationship knowledge semantics |
| Time | TimePolicy, time coordinates, advances/actions, segment commits и persisted world-scoped trigger registry | Нет wall-clock scheduler, фонового исполнения и автоматического catch-up |
| Process Manager | `src/process/`, process store/API и integration tests | Полная автономность всех длительных процессов и доказанный production lifecycle |
| Memory Provider | `src/application/sqlite-memory-provider.js`, raw archive/import/reconciliation/lifecycle paths и соответствующие тесты | Provider-local correctness не доказывает доверенность Host IDs, полноту inventory или сквозную безопасность |
| NPC memory boundary | `src/npc/memory-candidate-eligibility.js`, `src/application/memory-npc-consumer.js` и тесты | Не доказывает, что персонаж действительно получил, понял или принял сведения; production consumer выключен |
| Host / Adapter | `host-adapter/prototype/` содержит lifecycle bridge, journal, inventory projection, digest proxy, тесты и patch для закреплённой версии ST | Прототип и patch не считаются установленными, runtime-проверенными или доказательством полного inventory |
| World Pack | JSON Schema, примеры biological/magic/digital worlds и документация формата | Полный loader и проверенная загрузка/исполнение произвольного World Pack не подтверждены |

### Правило доказательств

Использовать четыре разных статуса и не смешивать их:

- **Source-inspected** — код или документ просмотрен; это ещё не runtime-проверка.
- **Fixture-tested** — поведение проверено на тестовых данных/заглушках.
- **Runtime-observed** — поведение наблюдалось при запуске конкретной версии.
- **Real integration tested** — проверено на целевом Host/Provider/Core/клиентском пути и конкретном окружении.

CI отдельной ветки не означает merge. Успешные тесты текущего архива не подтверждают тесты другого SHA. Архив без `.git` не позволяет установить точный commit SHA.

## Memory → NPC: безопасность и блокирующие условия

**Текущий production status: DISABLED / FAIL-CLOSED.**

Что подтверждено в ограниченных границах:
- Provider реализует операции с записями и lifecycle; provider-тесты проверяют локальное поведение, включая reconciliation, tombstone/revocation и race/interruption cases.
- Core содержит узкую авторизованную границу чтения и контракт доверия к каноническим источникам.
- NPC содержит проверку допустимости memory candidates и consumer boundary.
- Digest ledger принимает идентификаторы версий и SHA-256 digest; сам по себе он не доказывает полноту или подлинность Host inventory.

Что остаётся обязательным до production disclosure:
1. Авторитетный Host inventory для активных, исторических и удалённых версий, включая изменения, которые не попали в обычные lifecycle events.
2. Реальные доверенные read-only readers для Core и Provider; тестовые fixtures не заменяют их.
3. Серверная сборка финального тела запроса SillyTavern и доказательство, что каждый раскрываемый текст соответствует точным проверенным memory candidates.
4. Проверка доступа и revocation, синхронизированная с фактическим началом отправки, на пути от candidate assembly до serializer/outbound transport.
5. Доказательство отсутствия обходного маршрута, который позволяет отправить запрещённые данные напрямую.
6. Для целевого Windows deployment — идентичность службы, ACL базы и файлов WAL/SHM, резервное копирование и восстановление.
7. Проверка persistence и lifecycle на реальном Android/Termux Host, если он остаётся целевым клиентом.

Согласованный SQLite snapshot не является разрешением на раскрытие. Сырые сущности, факты и метаданные событий нельзя напрямую передавать NPC, повествователю или игроку. Пока gates не закрыты, Memory → NPC не включать.

**Координационные блокеры:**
- [Issue #264 — Host → Provider evidence and production-readiness gate](https://github.com/necromorphic/Logic-Engine/issues/264) — единый пакет доказательств, Host inventory, Provider reconciliation и точная disclosure boundary.
- [Issue #258 — Host/Adapter lifecycle evidence](https://github.com/necromorphic/Logic-Engine/issues/258) — lifecycle и inventory на закреплённой версии SillyTavern.
- [Issue #181 — Memory Provider](https://github.com/necromorphic/Logic-Engine/issues/181) — Provider-local возможности и границы доверия к Host.
- [Issue #226 — Mechanics acceptance](https://github.com/necromorphic/Logic-Engine/issues/226) — policy-freshness при approval/commit.
- [Issue #252 — Portfolio manager](https://github.com/necromorphic/Logic-Engine/issues/252) — общий реестр блоков, зависимостей, доказательств и следующих действий.

Не добавлять новые persistent fields, API, schemas, stores, journals, cursors, outboxes, lifecycle hooks или production wiring в Host/Provider path до второго явного одобрения Core на конкретный diff. Не менять существующий патч векторизации.

## SillyTavern и Google AI Studio egress gateway

Материал `Security 1.1` описывает отдельный патч к SillyTavern, предназначенный для режима обязательного шлюза Google AI Studio:

- серверная конфигурация шлюза имеет приоритет над клиентскими `reverse_proxy` и `proxy_password`;
- при включённом обязательном режиме отсутствие/неполная конфигурация блокирует запрос до отправки, без прямого fallback к Google;
- защита распространяется на генерацию, список моделей и Google-маршруты image description, TTS и vectorization;
- credentials передаются в заголовке, не в URL;
- убран вывод содержимого запросов в диагностике двух Google handlers;
- для патча заявлены 7 целевых тестов и синтаксические проверки четырёх JS-модулей.

Патч проверялся на исходниках SillyTavern с целевым SHA `06bde939fb1e9c4c8d8641d810f0a916b5bce127`. **Он не является частью этого архива Logic-Engine и не считается установленным в рабочем SillyTavern.** Реальный PC gateway, его auth protocol и сетевой запрет прямого egress ещё должны быть проверены. Не включать обязательный режим до запуска и проверки шлюза: при отсутствии gateway запросы будут блокироваться ожидаемым fail-closed образом.

## Установка и запуск прототипа

### Требования

- Node.js **22.13+**.
- npm, поставляемый с Node.js.
- Отдельный SQLite-файл для каждого хранилища с соблюдением настроенных путей и прав доступа.

### Установка зависимостей

```bash
npm install
```

### Конфигурация

Минимально необходим:
- `ENGINE_API_TOKEN` — секрет длиной не менее 16 символов;
- `LOGIC_ENGINE_COORDINATOR_DB_PATH` — явный абсолютный путь к отдельной SQLite-базе общего координатора; значение должно быть одинаковым у Core и всех подключённых участников и не должно совпадать с `ENGINE_DB_PATH`.

В зависимости от включённых маршрутов также используются:
- `ENGINE_DB_PATH` — путь к основной Core DB;
- `ENGINE_HOST_VERSION_LEDGER_DB_PATH` — отдельный digest-only журнал Host-версий (по умолчанию `./data/logic-engine-host-versions.sqlite`);
- `ENGINE_ADAPTER_TOKENS` — JSON-объект adapter ID → отдельный secret для adapter-owned proposal operations;
- `ENGINE_APPROVAL_TOKEN` — отдельный секрет approval gate;
- `ENGINE_ADMIN_TOKEN` — административные операции, включая world/registry management;
- `ENGINE_INTERNAL_TOKEN` — ограниченные internal routes, в том числе соответствующие context-manifest и time-trigger операции.

Точный набор переменных и примеры значений смотри в `.env.example` и `docs/20-minimal-runtime.md`. Не используй production-секреты в тестах, логах или репозитории.

### Команды

```bash
npm start
npm run dev
npm test
npm run benchmark:replay
```

`npm test` запускает тесты через `node --import ./tests/configure-test-env.js --test`. В загруженном архиве полный запуск завершился **800/800 PASS**. `benchmark:replay` — отдельный benchmark, его результат не включён в указанную проверку.

В используемых версиях Node встроенный `node:sqlite` может иметь статус experimental.

### Важные эксплуатационные ограничения

- Координатор сериализует только операции, участвующие в его протоколе. Он не блокирует сторонний процесс, напрямую открывающий Core DB. Для production необходима OS-level single-writer isolation.
- Digest ledger хранит идентификаторы версий и digest, а не содержимое сообщений; наличие ledger не заменяет trusted Host inventory verifier.
- Пока verifier не подключён и обязательные evidence gates не закрыты, reconciliation и Memory disclosure должны оставаться fail-closed.
- Time trigger registry — сохраняемый планировочный реестр, а не фоновый scheduler. Триггеры исполняются в рамках явных time operations.
- Не направляй внешний клиент напрямую к SQLite. Используй API и предусмотренные границы авторизации.

## Структура репозитория

### Runtime

- `src/core/` — базовые ошибки, правила, механики и ограниченный effect-intent translator.
- `src/application/` — прикладные сервисы Core, proposals, authorized reads, actor/host bindings, Memory Provider и интеграционные boundary-компоненты.
- `src/api/` — HTTP API.
- `src/storage/` — SQLite store, coordinator lock и process store.
- `src/time/` — модель времени, TimePolicy и scheduler.
- `src/process/` — контракты длительных процессов.
- `src/relationship/` — pure evaluation отношений.
- `src/npc/` — eligibility boundary для memory candidates.

### Host / Adapter

- `host-adapter/prototype/` — прототип SillyTavern lifecycle bridge, journal, inventory projection, digest proxy, тесты, audit evidence и pinned-source patch.
- `docs/13-sillytavern-adapter-contract.md` — host-neutral контракт адаптера и граница векторизации.

### Тесты, схемы и примеры

- `tests/` — основной набор Node.js tests.
- `test/` — дополнительные тесты/проверки.
- `schemas/` — JSON Schema для World Pack, правил, proposals, mechanics, rollback и TimePolicy.
- `examples/world-packs/` — biological, magic и digital профили.
- `benchmarks/` — replay/rollback benchmark scripts.
- `.github/workflows/` — CI для runtime tests, replay benchmark и Host lifecycle/patch checks.

## Карта документации

Документация в `docs/` — набор контрактов, решений, аудитных материалов и предложений. Наличие документа не означает, что описанная возможность реализована.

### Базовые архитектурные контракты
- `00-architecture-baseline.md` — архитектурная карта и ответственность блоков.
- `01-core-domain-model.md` — универсальная модель канонического состояния.
- `02-turn-event-delivery-lifecycle.md` — Turn, WorldEvent, Delivery, идемпотентность и коммит.
- `03-storage-and-persistence-contract.md` — хранение, транзакции, изоляция и восстановление.
- `04-world-pack-format.md` — формат World Pack.
- `05-causal-rollback-algorithm.md`, `18-rollback-and-causality.md`, `21-stage1-causality-contract.md`, `22-causality-semantics.md`, `24-causality-test-matrix.md` — причинность и rollback.
- `06-npc-autonomy-and-process-manager.md`, `16-process-manager-core-boundary.md`, `22-process-manager-runtime.md` — автономия и длительные процессы.
- `07-knowledge-and-narrative-boundaries.md` — границы знаний и повествования.
- `08-stage1-acceptance-plan.md`, `12-stage-roadmap.md` — этапы и критерии приёмки.
- `09-reuse-and-attribution-register.md`, `19-reuse-audit-existing-projects.md` — повторное использование и лицензии.
- `10-open-decisions.md`, `11-operations-and-recovery.md`, `12-sqlite-schema-lifecycle.md`, `15-core-storage-performance-budget.md` — решения и эксплуатация.

### Mechanics, Core и пересчёт
- `25-universal-mechanics-system.md`, `26-mechanics-contracts.md`, `27-proposal-to-commit-boundary.md`, `28-proposal-api-stage1.md`, `29-mechanic-instance-runtime-design.md`.
- `30-stage1.3-mechanic-execution-boundary.md`, `31-mechanic-effect-intent-support-matrix.md`, `32-mechanic-effect-translator-contract.md`, `33-mechanic-intent-proposal-boundary.md`, `34-mechanics-oracle-reconciliation.md`.
- `31-recalculation-strategy-contract.md`, `54-core-proposal-execution-authority-contract.md`, `57-core-evaluation-recalculation-boundary.md`.

### NPC, Relationships и Memory
- `29-character-cards-contract-v1.2.1.md`, `30-character-card-read-projection-stage1.md`, `31-npc-subsystem-contract.md`.
- `35-npc-test-boundary-map.md`, `36-npc-core-integration-seam.md`, `37-npc-kernel-readiness-gate.md`, `38-npc-author-decisions-and-semantic-delta.md`, `39-npc-core-knowledge-contract-proposal.md`.
- `42-npc-relationship-state-contract-proposal.md`, `43-core-npc-knowledge-runtime-implementation-plan.md`, `44-npc-relationship-semantic-acceptance.md`, `45-npc-relationship-typed-operation-design.md`, `46-relationship-domain-module-design.md`, `47-relationship-module-test-traceability.md`, `48-relationship-pure-evaluation-contract.md`, `49-relationship-to-core-typed-transition-handoff.md`.
- `50-npc-initial-knowledge-acquisition-contract.md`, `51-npc-acquisition-source-reconciliation.md`, `52-npc-memory-consumption-contract-and-failure-matrix.md`, `53-npc-memory-lifecycle-vocabulary-crosswalk.md`, `54-npc-memory-boundary-assumptions-and-integration-gates.md`, `55-npc-delivery-acquisition-boundary-matrix.md`, `56-npc-memory-boundary-acceptance-matrix.md`.
- `64-core-memory-architecture.md` through `78-*` — Core/Memory contracts, implementation plans, trust/freshness, source identity, provider lifecycle, integration matrices и временные runtime-срезы. Перед реализацией сверяй статус документа: часть материалов является proposal, audit snapshot или handoff, а не разрешением на изменение runtime.

### Time и операционные контракты
- `17-time-process-state-machine-proposal.md`, `58-time-domain-t1-design.md`, `60-time-coordinate-runtime-slice.md`, `61-time-segment-commit-runtime-slice.md`, `62-due-work-planner.md`, `63-time-advance-operation-runtime-slice.md`, `64-time-policy-calendar-authoring.md`, `78-time-trigger-registry-runtime-slice.md`.

### Прочие важные материалы
- `13-event-type-contract.md` — типы событий.
- `13-sillytavern-adapter-contract.md` — адаптер.
- `17-world-agnostic-design-stage1.3.md` — world-agnostic граница.
- `20-minimal-runtime.md` — endpoints, запуск и ограничения прототипа.
- `23-character-and-control-architecture.md` — персонажи и управление.
- `56-context-aware-interpretation-of-communicative-intent.md` — архитектурное предложение по интерпретации намерения; не считать runtime-функцией.
- `AI_REVIEW_BRIEF.md` и `docs/21-gemini-core-audit-brief.md` — материалы независимого ревью.

## Порядок дальнейшей работы

1. Использовать [портфельный трекер #252](https://github.com/necromorphic/Logic-Engine/issues/252) как общий реестр активных блоков, зависимостей и доказательств.
2. Закрывать блокеры по владельцам и текущим issue; не создавать параллельные документы, дублирующие #264 или другие согласованные handoff.
3. До изменения Host/Provider persistent contract получать явное одобрение Core на конкретный diff.
4. Для каждой заявленной возможности фиксировать точный commit SHA, тестовую команду, результат и уровень доказательства.
5. Сначала доказывать узкую runtime-границу, затем интеграцию между блоками, и только после этого рассматривать production enablement.

**Прототип не является production-системой.** Полноценная автономная симуляция, end-to-end Memory → NPC disclosure, полная модель знаний, завершённый World Pack loader и проверенная интеграция SillyTavern остаются отдельными задачами.