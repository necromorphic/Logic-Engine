# World Simulation Engine — «Логический движ»

**«Логический движ» — проект универсального движка длительной ролевой симуляции.** Цель — хранить авторитетное состояние мира, рассчитывать причинно связанные изменения и игровое время, поддерживать автономность NPC и передавать подтверждённые результаты в повествование через адаптер SillyTavern.

> **Актуальность статуса: 28 октября 2026 года.** Этот README отражает подтверждённый прогресс и известные блокеры на указанную дату; он не заменяет проверку каждого изменения в текущем `main`. Главный реестр статуса и зависимостей — [портфельный трекер #252](https://github.com/necromorphic/Logic-Engine/issues/252), а общий блокер Memory → NPC — [issue #264](https://github.com/necromorphic/Logic-Engine/issues/264).
>
> **Сверка веток и PR на 28.10.2026:** в репозитории 502 ветки и 77 открытых PR. Это не означает, что все ветки активны или безопасны для удаления. Каноническая цепочка версии источника — draft #509 → #521 → #504; #490 содержит конфликтующую повторную миграцию и не должен сливаться отдельно. PR #514/#515 пересекаются с #522; #517 добавляет отдельные тесты зависимостей условий, которых нет в #522; #516 относится к отдельному переводчику эффектов и не входит в этот стек. Подробная классификация, зависимости и порядок действий: [отчёт по веткам и консолидации PR](docs/branch-pr-consolidation-2026-10-28.md). Никакие PR этим отчётом не одобрены к слиянию.
>
> **Состояние проекта:** существует исполняемый прототип с HTTP API, SQLite-журналом событий, базовыми сущностями и фактами, идемпотентностью, аудитом, ограниченным причинным откатом, версионируемым реестром механик и базовым жизненным циклом предложений. В репозитории также есть отдельные инфраструктурные срезы для отношений и авторизованного чтения. Это ещё не завершённая автономная симуляция и не готовая интеграция с SillyTavern.
>
> **Memory → NPC: отдельные части проверены, production-путь не готов.** Core source-version ledger PR [#509](https://github.com/necromorphic/Logic-Engine/pull/509) (`6234deecc7740d0417097df0c827789c76c49061`) прошёл Runtime 812/812, oracle 8/8 и NPC boundary 81/81; consolidated Core readback PR [#521](https://github.com/necromorphic/Logic-Engine/pull/521) (`9efc12e8dacef094851abf3b3b19d9a25d0f081f`) прошёл Runtime + oracle + NPC boundary; Provider→Core PR [#504](https://github.com/necromorphic/Logic-Engine/pull/504) (`791c52eb994011cbb0474ab48895413be3a1aef0`) прошёл Runtime 817/817, oracle 8/8 и NPC boundary. Host inventory PR [#510](https://github.com/necromorphic/Logic-Engine/pull/510) (`4154ce0c6667e49869f4f5bcb165e1d21dcd62bb`) прошёл пять workflow: pinned-source audit, patch validation, browser IndexedDB restart, lifecycle patch check и Runtime. Все эти PR остаются draft и не слиты. Это CI/patch evidence, не доказательство production-интеграции, установленного SillyTavern или Android/Termux.
>
> **Production Memory → NPC остаётся DISABLED / FAIL-CLOSED.** Не включать его на основании только Provider-local тестов или успешного CI отдельной ветки. Host authoritative inventory полного набора активных, исторических и удалённых версий пока не доказан; Android/Termux persistence и проверка отзыва доступа непосредственно перед раскрытием также не подтверждены.

## Оценка прогресса

> Проценты ниже — **ориентировочная оценка на 27 октября 2026 года; на 28 октября она не пересчитывалась**, поскольку для этого нет единой измеримой метрики. Это не официальная готовность к выпуску. Они отражают объём подтверждённой реализации относительно оставшейся работы. Для Memory → NPC отдельно показаны технический прогресс и готовность к production: это разные показатели.

| Направление | Прогресс | Полоса |
|---|---:|---|
| **Весь проект** | **35%** | `███████░░░░░░░░░░░░░` |
| Core — ядро и правила мира | 55% | `███████████░░░░░░░░░` |
| Memory Provider — хранение и операции памяти | 70% | `██████████████░░░░░░` |
| NPC — границы допуска и потребление памяти | 45% | `█████████░░░░░░░░░░░` |
| Host / Adapter — связь с SillyTavern | 35% | `███████░░░░░░░░░░░░░` |
| Mechanics — игровые механики | 35% | `███████░░░░░░░░░░░░░` |
| Time / Process Manager — время и длительные процессы | 30% | `██████░░░░░░░░░░░░░░` |
| Relationships / World Pack — отношения и пакеты миров | 25% | `█████░░░░░░░░░░░░░░░` |

### Memory → NPC

| Показатель | Оценка | Что это означает |
|---|---:|---|
| Техническая реализация отдельных частей | **55% (оценка не пересчитывалась)** | Добавлены Core-owned `core-entity-v1:N` source tokens, Provider-проверка токена на обеих авторизационных границах и регрессия rollback; PR #509/#521/#504 проверены CI, но не слиты. Host inventory PR #510 проверен CI, однако его runtime verifier намеренно всегда возвращает `false`. |
| Production readiness | **0% — BLOCKED** | Реальный путь от SillyTavern до финальной отправки не доказан; включение запрещено до закрытия обязательных gates. |

Горизонтальная полоса для интеграции:

`Техническая реализация  ███████████░░░░░░░░░ 55%`

`Production readiness   ░░░░░░░░░░░░░░░░░░░  0% — BLOCKED`

**Что уже подтверждено**
- Provider умеет выполнять ограниченные операции с записями и доступом; соответствующие тесты подтверждают только Provider-local поведение.
- В PR [#509](https://github.com/necromorphic/Logic-Engine/pull/509) и [#521](https://github.com/necromorphic/Logic-Engine/pull/521) реализована кандидатная цепочка Core-owned per-entity source version ledger + readback; CI прошёл на точных HEAD.
- В PR [#504](https://github.com/necromorphic/Logic-Engine/pull/504) Provider сохраняет и проверяет точный `source_version`; CI прошёл на HEAD `791c52eb994011cbb0474ab48895413be3a1aef0` (817/817 Runtime tests, oracle 8/8, NPC boundary passed).
- В PR [#510](https://github.com/necromorphic/Logic-Engine/pull/510) прошли пять workflow на HEAD `4154ce0c6667e49869f4f5bcb165e1d21dcd62bb`; это patch/source/fixture evidence, не live-host доказательство.
- Gateway dispatch prototypes [#500/#505/#508](https://github.com/necromorphic/Logic-Engine/pull/500) проверяют отдельные части подписи, accepted-head и lock ordering, но реальный финальный SillyTavern egress не привязан к gateway.

**Что мешает включению**
1. Серверная сборка окончательного тела запроса на закреплённом маршруте SillyTavern и доказательство соответствия текста точным кандидатам памяти.
2. Реальные доверенные read-only readers для Core и Provider вместо тестовых fixtures.
3. Проверка отзыва/изменения доступа, синхронизированная с началом отправки, и доказательство отсутствия обходного пути.
4. Доказательства для целевого развёртывания: идентичность службы, ACL базы и файлов WAL/SHM, резервное копирование и восстановление.
5. Авторитетный Host inventory, включающий версии и изменения, которые уже удалены или не попали в обычные события. В PR #510 `src/index.js` намеренно передаёт `verifyInventorySnapshot: async () => false`; в runtime нет доказанного пути complete-inventory reconciliation, поэтому Host inventory не может перейти в READY.

Проценты не означают, что соответствующий модуль завершён. Статус **BLOCKED** важнее числовой оценки: production Memory → NPC не включать до закрытия [issue #264](https://github.com/necromorphic/Logic-Engine/issues/264) и проверки доказательств на реальном пути.

## Основной принцип

**Замысел ≠ происходящее ≠ рассказанное.**

1. Сюжетные арки описывают предполагаемые цели, опорные точки и допустимые варианты.
2. Симуляция вычисляет, что фактически произошло, на основании состояния, правил мира, действий, знаний и причин.
3. Повествование отражает подтверждённые результаты и не создаёт канонические факты само по себе.

## Непереговорные требования

- Игровое время заморожено, пока игрок не совершает действие и не запрашивает продвижение времени.
- Движок — источник авторитетного состояния; языковая модель предлагает действия и формулирует повествование, но предложения валидируются до коммита.
- NPC должны автономно взаимодействовать друг с другом и миром, менять планы, формировать союзы и конфликты, ошибаться, сомневаться и пересматривать убеждения. Это целевые требования, а не заявление о завершённой реализации.
- Знания должны иметь происхождение и путь получения; секреты не распространяются между персонажами без допустимого источника и доставки.
- Поддерживаются как заданные сюжетные арки, так и свободная симуляция с автономными событиями мира.
- Сохранённые задачи, планы и длительные процессы должны продолжаться независимо от того, помнит ли о них текущий контекст модели.
- Откат должен устранять зависимые последствия, сохраняя независимые ветви. Полная семантика альтернативных независимых причин пока не подтверждена.
- Векторный архив — средство поиска контекста, а не авторитетная база фактов. **Существующую векторизацию и Ollama remote-store patch не переписывать.**
- SillyTavern на Android/Termux остаётся RP-интерфейсом; Logic-Engine и его обработка должны работать на компьютере. Связь — по LAN, когда доступно, или через мост. Реальные хуки и надёжность интеграции необходимо проверять.
- Общее ядро не навязывает миру чужие механики. Специфические правила принадлежат отдельному World Pack; неизвестные механики явно маркируются.

## Текущая граница реализации

| Область | Статус на 25.10.2026 |
|---|---|
| HTTP API, SQLite-журнал, проекции, базовые сущности/факты, аудит и идемпотентность | Есть в прототипе; гарантия ограничена кодом и тестами текущей версии |
| Причинный откат и перестроение проекций | Частично реализованы; полная семантика независимых альтернативных причин не подтверждена |
| Механики: bounded effect-intent translation → proposal → approval → canonical commit | Ограниченный перевод трёх intent kinds и интеграция с существующим ProposalService находятся в `main` через PR #280; это не полноценный mechanic executor и не production approval |
| Recalculation oracle / executor | Изолированный oracle и его тесты находятся в `main`; oracle не пересчитывает canonical world state. Полный dependency-aware executor, policy-freshness gate и production enablement не подтверждены |
| Rollback transaction regression | Транзакционная регрессия присутствует в `main`; сама по себе не закрывает полную policy-freshness интеграцию |
| Типизированные отношения | Ограниченный admin-only transition есть; полноценный NPC-facing authorized read и причинная семантика не завершены |
| Actor bindings / authorized read | Частичные инфраструктурные примитивы есть; полной модели приобретения знаний, убеждений, доставки и секретов нет |
| Host → Provider authoritative inventory | **BLOCKED / NON_READY**: полнота активных и исторических/удалённых версий и обнаружение пропущенных изменений не доказаны |
| Реальный Host → Provider → Core → NPC путь | **NOT PROVEN**: Provider-local tests не доказывают Host inventory, реальную интеграцию или Android/Termux persistence |
| Revocation прямо перед disclosure | **BLOCKED / NOT PROVEN** на реальном пути от candidate assembly до финального serializer/outbound transport |
| Автономные NPC, долговременные процессы, StoryBeat, полный World Pack loader, проверенный ST-адаптер | Не реализованы как завершённая end-to-end система |

**Правило доказательств:** архитектурный документ или открытый PR не является реализованной возможностью. Прохождение CI одной ветки не означает merge, интеграционную готовность или разрешение на production. Различать source-inspected, fixture-tested, runtime-observed и real Android/Termux-tested результаты.

**Безопасностная граница:** согласованный SQLite snapshot не является разрешением на доступ. Сырые сущности, факты и метаданные событий нельзя напрямую передавать NPC, повествователю или игроку. Проверки авторизации, версии, lineage, inventory и revocation должны быть доказаны на фактическом пути раскрытия. Пока необходимые gates не пройдены, Memory → NPC остаётся выключенным.

## Активные сквозные блокеры

- **[Issue #264 — Host → Provider evidence and production-readiness gate](https://github.com/necromorphic/Logic-Engine/issues/264):** единый пакет доказательств, Host inventory, Provider reconciliation, точный disclosure boundary и список минимальных решений Core. Не создавать параллельные mapping-документы.
- **[Issue #258 — Host/Adapter lifecycle evidence](https://github.com/necromorphic/Logic-Engine/issues/258):** проверить идентичность и lifecycle на закреплённой версии SillyTavern `1.19.0-1-g06bde939f` (SHA `06bde939fb1e9c4c8d8641d810f0a916b5bce127`). Пока нет доказанного полного inventory; кандидат patch не считается применённым или runtime-проверенным.
- **[Issue #181 — Memory Provider](https://github.com/necromorphic/Logic-Engine/issues/181):** Provider-local archive/reconciliation операции существуют, но их тесты не заменяют доказательства полноты источника Host и сквозной интеграции.
- **[Issue #226 — Mechanics acceptance](https://github.com/necromorphic/Logic-Engine/issues/226):** остаётся блокер policy-freshness — авторитетный источник политики должен быть проверен при approval/commit, включая end-to-end rotation версии политики.
- **[Issue #252 — Portfolio manager](https://github.com/necromorphic/Logic-Engine/issues/252):** общий реестр активных блоков, зависимостей, доказательств, владельцев и следующих действий. Координационный приоритет — устранение сквозных блокеров интеграции, а не запуск отдельного модуля; текущая последовательность и доказательства ведутся в [#264](https://github.com/necromorphic/Logic-Engine/issues/264).

Не добавлять новые persistent fields, API, schemas, stores, journals, cursors, outboxes, lifecycle hooks или production wiring в Host/Provider path до второго явного одобрения Core на конкретный diff. Не менять существующий патч векторизации.

## Документы

### Архитектурные контракты
- `docs/00-architecture-baseline.md` — карта архитектуры и границы ответственности.
- `docs/01-core-domain-model.md` — универсальные типы канонического состояния.
- `docs/02-turn-event-delivery-lifecycle.md` — жизненные циклы Turn, WorldEvent и Delivery, идемпотентность и границы коммита.
- `docs/03-storage-and-persistence-contract.md` — канонические данные, производные индексы, транзакции, изоляция и восстановление.
- `docs/04-world-pack-format.md` — формат и правила декларативного World Pack.
- `docs/05-causal-rollback-algorithm.md` — алгоритм построения RollbackPlan и тесты RB-001–RB-014.
- `docs/06-npc-autonomy-and-process-manager.md` — автономные цели/планы/задачи и параллельные процессы.
- `docs/07-knowledge-and-narrative-boundaries.md` — знания, приватность, повествование и подтверждение доставки.
- `docs/56-context-aware-interpretation-of-communicative-intent.md` — контекстная интерпретация коммуникативного намерения, неопределённость, provenance, пересмотр и отзыв гипотез; архитектурное предложение без runtime-реализации.
- `docs/08-stage1-acceptance-plan.md` — критерии завершения Stage 1, профили миров и матрица тестирования.
- `docs/09-reuse-and-attribution-register.md` — реестр внешних проектов, лицензий и правил переноса кода.
- `docs/10-open-decisions.md` — блокирующие и отложенные решения.
- `docs/11-operations-and-recovery.md` — локальный runtime, безопасность, резервное копирование и восстановление.
- `docs/12-stage-roadmap.md` — этапы реализации и критерии перехода между ними.
- `docs/13-sillytavern-adapter-contract.md` — контракт адаптера SillyTavern и граница векторизации.
- `docs/17-world-agnostic-design-stage1.3.md` — критерий универсальности и граница World Pack.
- `docs/18-rollback-and-causality.md` — требуемая семантика причинного отката.
- `docs/19-reuse-audit-existing-projects.md` — анализ готовых проектов и карта адаптации.
- `docs/21-stage1-causality-contract.md` — гарантии и ограничения текущей причинности, контракт будущей верификации.
- `docs/25-universal-mechanics-system.md` — архитектура универсальной системы механик.
- `docs/26-mechanics-contracts.md` — контракты шаблонов/экземпляров/модулей и текущая граница реализации.
- `docs/32-mechanic-effect-translator-contract.md` — фактическая граница ограниченного translator (только `create_entity`, `update_attribute`, `assert_fact`).
- `docs/33-mechanic-intent-proposal-boundary.md` — путь `effect_intents` через ProposalService и канонический commit.
- `docs/34-mechanics-oracle-reconciliation.md` — что реально вошло в Mechanics/Core интеграцию и чего oracle не доказывает.
- `docs/17-time-process-state-machine-proposal.md` — согласование Time scheduler с Process Manager runtime.
- `docs/22-process-manager-runtime.md` — текущий runtime-контракт долговременных процессов.
- `docs/57-core-evaluation-recalculation-boundary.md` — граница логического ядра: интерпретация, оценка, конфликты, commit, пересчёт производного состояния и авторизованная публикация; архитектурное предложение.

### Исполняемый прототип
- `package.json` — Node.js runtime scripts.
- `src/core/` — ошибки и ограниченный декларативный evaluator.
- `src/application/engine.js` — прикладные команды и проверка входных данных.
- `src/storage/sqlite-store.js` — журнал событий, проекции состояния, аудит и прототип причинного отката.
- `src/api/server.js` — независимый от интерфейса HTTP API.
- `tests/` — контрактные тесты.
- `docs/20-minimal-runtime.md` — запуск, endpoints и ограничения текущей реализации.

Запуск требует Node.js 22.13+, `ENGINE_API_TOKEN` (не менее 16 символов) и явный абсолютный `LOGIC_ENGINE_COORDINATOR_DB_PATH`, указывающий на отдельный SQLite-файл общего координатора; он должен быть одинаковым у Core и всех подключённых участников и не должен совпадать с `ENGINE_DB_PATH`. `ENGINE_HOST_VERSION_LEDGER_DB_PATH` задаёт отдельный digest-only журнал Host-версий (по умолчанию `./data/logic-engine-host-versions.sqlite`). Его API принимает только идентификаторы версий и SHA-256 digest, не текст сообщений. Пока trusted Host inventory verifier не подключён, reconciliation остаётся fail-closed и Memory→NPC не включается. Координатор сериализует только участвующие в нём записи; он не блокирует сторонний процесс, который напрямую открывает Core DB, поэтому OS-level single-writer isolation остаётся обязательным для production. Для создания proposals настрой `ENGINE_ADAPTER_TOKENS` как JSON-объект идентификаторов адаптеров и отдельных секретов; для регистрации механик/модулей задай отдельный `ENGINE_ADMIN_TOKEN`. `ENGINE_APPROVAL_TOKEN` включает отдельный gate подтверждения. Пример переменных находится в `.env.example`. `npm test` запускает текущие тесты. Встроенный `node:sqlite` в используемых версиях Node может помечаться как experimental.

### Решения и схемы
- `docs/decisions/ADR-0006-rollback-semantics.md` — предлагаемая семантика отката.
- `docs/decisions/ADR-0007-world-pack-boundary.md` — предлагаемая граница ядра и World Pack.
- `schemas/world-pack-manifest.schema.json` — начальная JSON Schema манифеста World Pack.
- `schemas/declarative-rule.schema.json` — ограниченный формат условий и эффектов.
- `schemas/rollback-plan.schema.json` — структурный контракт плана отката.
- `schemas/effect-proposal.schema.json` — контракт предложения изменений до валидации и коммита.
- `schemas/mechanic-template.schema.json` — неизменяемый версионируемый шаблон механики.
- `schemas/mechanic-instance.schema.json` — экземпляр механики, изолированный внутри мира.
- `schemas/rule-module-manifest.schema.json` — контракт allowlist-реестра версионированных модулей.

### Примеры и независимое ревью
- `examples/world-packs/biological-world.json` — тестовый профиль с биологическими сущностями.
- `examples/world-packs/magic-world.json` — тестовый профиль с неизвестными магическими механиками.
- `examples/world-packs/digital-world.json` — цифровой мир без обязательных биологических полей.
- `AI_REVIEW_BRIEF.md` — задание для независимого архитектурного аудита Gemini и DeepSeek.

## Статус и порядок работы

Прототип пока не равен полноценному движку и не должен использоваться как production-система. Причинные ссылки задаются вызывающей стороной и не проверяются на полноту; модель знаний, автономные процессы, полный World Pack loader и проверенный SillyTavern-адаптер не завершены. Возможность считается реализованной только после проверки кода, актуального коммита и соответствующих тестов.

Текущая экспериментальная реализация использует JavaScript/Node.js + SQLite. Архитектура API не привязана к SillyTavern; конкретные хуки ST-адаптера необходимо проверять отдельно.
