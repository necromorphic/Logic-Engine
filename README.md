# World Simulation Engine — «Логический движ»

**«Логический движ» — проект универсального движка длительной ролевой симуляции.** Цель — хранить авторитетное состояние мира, рассчитывать причинно связанные изменения и игровое время, поддерживать автономность NPC и передавать подтверждённые результаты в повествование через адаптер SillyTavern.

> **Последний полный статусный снимок: 25 октября 2026 года.** На 26 октября ведётся портфельная сверка интеграционных блокеров; этот README и таблица ниже не являются повторной полной проверкой текущего `main`. Подтверждённые изменения и текущие блокеры фиксируются в [центральном портфельном трекере #252](https://github.com/necromorphic/Logic-Engine/issues/252).
>
> **Снимок на 25 октября:** проект находится на стадии архитектурных контрактов и минимального исполняемого прототипа. В runtime есть HTTP API, SQLite-журнал событий, базовые сущности и факты, идемпотентность, аудит, ограниченный причинный откат, версионируемый реестр механик и базовый жизненный цикл предложений. В `main` также присутствуют ограниченные инфраструктурные срезы: admin-only typed Relationship transition, внутреннее SQLite snapshot-чтение, actor bindings и частичный actor-authorized read endpoint. Это **не** означает, что готова полная модель отношений, знаний, секретов или автономной симуляции.
>
> **Production Memory → NPC выключен и должен оставаться DISABLED / FAIL-CLOSED.** Проверка Host → Provider → Core → NPC выявила незакрытые доказательные блокеры: Host не имеет подтверждённого механизма авторитетного полного inventory активных, исторических и удалённых версий; end-to-end интеграция и Android/Termux persistence не доказаны; проверка отзыва доступа на реальной границе disclosure перед сериализацией/отправкой не подтверждена. Эти пробелы нельзя считать закрытыми по результатам Provider-local тестов или успешного CI на отдельной ветке.

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
- **[Issue #252 — Portfolio manager](https://github.com/necromorphic/Logic-Engine/issues/252):** общий реестр активных блоков, зависимостей, доказательств, владельцев и следующих действий.

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

Запуск требует Node.js 22.13+, `ENGINE_API_TOKEN` (не менее 16 символов) и явный `LOGIC_ENGINE_COORDINATOR_DB_PATH`, указывающий на отдельный SQLite-файл общего координатора. `ENGINE_DB_PATH` и `LOGIC_ENGINE_COORDINATOR_DB_PATH` не должны указывать на один файл. Любой отдельный процесс, который участвует в изменении защищённого состояния (в том числе Provider), обязан получить тот же абсолютный путь координатора; разные пути означают разные блокировки и не обеспечивают межпроцессную сериализацию. Для создания proposals настрой `ENGINE_ADAPTER_TOKENS` как JSON-объект идентификаторов адаптеров и отдельных секретов; для регистрации механик/модулей задай отдельный `ENGINE_ADMIN_TOKEN`. `ENGINE_APPROVAL_TOKEN` включает отдельный gate подтверждения. Пример переменных находится в `.env.example`. Общий lock primitive для участвующих процессов находится в `src/storage/coordinator-lock.js`: `openCoordinatorDatabase(absolutePath)` и `beginCoordinatorLock(db)`. Участник обязан держать lease вокруг своей локальной транзакции; наличие helper само по себе не доказывает, что все Provider/maintenance/recovery пути уже подключены. Этот механизм не реализует egress gateway и не разрешает включать production Memory→NPC. `npm test` запускает текущие тесты. Встроенный `node:sqlite` в используемых версиях Node может помечаться как experimental.

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
