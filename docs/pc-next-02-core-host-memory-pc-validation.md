# PC-NEXT-02 — Проверка реальной PC-интеграции Core ↔ Host ↔ Memory

**Тип:** read-only deployment audit + безопасные PC-specific integration checks.  
**Статус до начала:** NOT STARTED.  
**Базовый main на момент постановки:** `52ad14ddfa6ca23858066e7516b4dbd6a190ab01` (2026-10-30).  
**Цель:** проверить только те условия на целевом ПК, которые нельзя доказать обычным GitHub CI. Не повторять уже пройденные функциональные тесты модулей.

## 1. Цель и границы

Установить, какие реальные deployment-условия уже выполнены на ПК для будущего безопасного пути:

**SillyTavern Host → доверенная Host session/world/actor binding → Core authorization/acquisition → Memory Provider evidence → NPC context → единственная final-dispatch boundary.**

Это проверка готовности интеграции, а не включение интеграции. Итог может быть BLOCKED/NON_READY. Отсутствующий runtime-механизм нельзя заменять mock-объектом и объявлять интеграцию проверенной.

## 2. Что уже проверено — не повторять

### 2.1 Host / SillyTavern

Отчёты D4/D5.1/D5.3 уже содержат фактические проверки в изолированной ST 8010:

- UI creation/edit/delete;
- Direction A UI delete и запись before/after lifecycle hooks;
- sync idempotency;
- chat switching и restart;
- IndexedDB digest-only, без raw chat text;
- сохранение REVIEW_ONLY / CAPTURED_REVIEW_ONLY;
- изоляция основной ST 8000 и Core 8787.

Не повторять эти сценарии без конкретной причины или изменения тестируемого артефакта. DA-04—DA-08, LOCK-03—05, LOCK-07—08 и LLM Swipe/Regenerate/Cancel остаются отложенными отдельным решением пользователя. Не возвращать их в эту задачу.

### 2.2 Core и Provider

- Core proposal → approval → commit, stale revision, replay/idempotency и базовые rollback/recovery имеют существующие тесты и exact-head CI.
- #243 Process Manager закрыт; PR #694 merged, checkpoint mismatch/restart/replay acceptance покрыты тестами и CI. Не повторять весь lifecycle suite.
- #181 Memory Provider vertical slice закрыт; provider acceptance/Blocker 3 CI уже запускались.
- #262 остаётся отдельной Core competency/design областью. Универсальный dependency/recalculation planner и полный result-publication pipeline не заявлены как готовые.

### 2.3 Vectorization

**Полностью вне scope.** Не запускать тесты Ollama embeddings, ST-VectorService, Vectra/SQLite vector collections, query/insert/delete, размерностей, similarity, threshold или embedding proxy. Не менять существующий Ollama vectorization/remote-store код, его конфигурацию, данные и сетевой путь.

## 3. Текущие GitHub статусы — учитывать при проверке

На момент постановки:

- Current main: `52ad14ddfa6ca23858066e7516b4dbd6a190ab01`.
- PR #750 — Draft, Windows SQLite file-identity BigInt fix; exact-head CI прошёл на candidate, но PR не merged.
- PR #751 — Draft, Windows accepted-head ACL candidate; CI/PowerShell fixture smoke прошли, но это не доказывает effective ACL на целевом ПК, pre-opened handles или backup/restore isolation.
- PR #753 — Draft, Host Direction A delete-safety overlay, stacked on #750; не считать установленным/принятым на основании CI.
- PR #755 — Draft, Core NPC acquisition reader/belief candidate, stacked on #750; fresh exact-head CI pending на момент последней проверки.
- #755 не включает production authorizer configuration, authenticated Host-session identity, private cross-process Core read route, Host context serializer, NPC receiver или final-send wiring.
- #243 закрыт; его bounded process checkpoint recovery не означает наличие глобальной cross-process recalculation.

Перед началом повторно проверить статусы и SHAs. Не переносить CI-результаты между разными head/base.

## 4. Запреты

- Не менять production-код, конфигурацию, миграции или runtime-поведение.
- Не применять PR #750/#751/#753/#755 и другие патчи к рабочим установкам.
- Не переключать и не обновлять основной локальный Logic-Engine: ранее он был dirty и отставал от origin.
- Не перезапускать Core 8787, основную ST 8000, Ollama или другие рабочие процессы.
- Не менять рабочие SQLite/IndexedDB, чаты, историю, векторные БД и backup-файлы.
- Не выполнять commit/push/merge/rebase/deploy.
- Не создавать новые API, route, schema, fields, stores, outbox, cursor, scheduler или lifecycle hooks.
- Не создавать Windows users/service identities, не менять ACL и не выдавать права на реальные рабочие каталоги без отдельного разрешения.
- Не запускать ACL apply script на рабочих путях. Для изменения ACL разрешены только disposable fixtures, если скрипт имеет безопасный fixture mode и его применение не затрагивает реальные учётные записи/каталоги.
- Не использовать caller-supplied `adapter_id`, `recipient`, actor/world/conversation ID или manifest membership как доказательство аутентификации.
- Не активировать Memory → NPC. Статус остаётся DISABLED / FAIL-CLOSED.
- Не использовать прямой SQL для обхода API. Read-only SQLite inspection допустим только если он уже входит в утверждённый диагностический процесс; не выполнять SQL writes.
- Не выводить секреты, токены, hashes секретов, Authorization headers или содержимое secret-файлов.

Если для проверки требуется остановить процесс, изменить права, восстановить БД, включить production authorizer или отправить модельный запрос — остановиться и запросить отдельное разрешение.

## 5. Этап 0 — фактический baseline (read-only)

Снять до тестов:

1. PID, executable path, command line, working directory и listen address для:
   - Core на 8787;
   - основной ST на 8000;
   - изолированной ST на 8010;
   - других процессов Logic-Engine/Provider/Authority/Gateway, если обнаружены.
2. Фактические Git HEAD/status для локальных репозиториев только read-only. Не исправлять dirty state.
3. Фактические пути Core DB, Provider DB, accepted-head authority DB, coordinator DB, WAL/SHM и backup roots, если они настроены.
4. Состояние Core `GET /health` — только health endpoint, без изменения состояния.
5. Проверить, какой именно build/commit обслуживает порт 8787. Если процесс нельзя однозначно привязать к исходникам/HEAD, указать VERSION_UNKNOWN. Не считать health 200 доказательством интеграции.
6. Зафиксировать, что рабочие экземпляры и данные не изменены.

Не угадывать пути и не считать старые PID актуальными.

## 6. PC-01 — Windows filesystem identity и accepted-head ACL

Это основной deployment-specific блок, который CI fixtures не могут закрыть за целевой ПК.

### 6.1 Read-only инвентаризация

Для Core, Provider, Authority и Gateway определить:

- фактические OS identities/process owners;
- каталоги данных и backup roots;
- владельцев и effective ACL на существующих каталогах/файлах;
- наследование ACL, reparse points, junctions, symlinks и hard-link aliases;
- открытые файловые handles на DB/WAL/SHM/authority files;
- пересечения между Core/Provider/Authority/Gateway и backup/restore domains.

Секреты и чувствительные ACL SID/учётные данные не публиковать без необходимости; достаточно доказуемой матрицы owner/access.

### 6.2 Проверка PR #751 только на disposable fixture

Если PR #751 остаётся актуальным и доступен:

1. Проверить его base/head и точный diff.
2. Изучить plan-first поведение и все условия отказа.
3. Выполнить только предусмотренный disposable-fixture/smoke режим в отдельном временном каталоге.
4. Проверить отказ при reparse point, ADS, пересекающихся roots, небезопасном parent ACL, unexpected entries и работающем PID.
5. Проверить, что ошибочный план не изменяет fixture ACL.
6. Не применять скрипт к реальным Core/Provider/Authority путям.

### 6.3 Что считается доказательством

- Реальные effective ACL на целевом ПК — отдельный результат.
- Успешный disposable fixture — только PASS для fixture-сценария.
- Если отдельные OS identities не созданы/не настроены, backup domain общий или ACL нельзя безопасно проверить, результат соответствующего production gate — BLOCKED, не PASS.
- Не создавать пользователей и не менять ACL самостоятельно.

### 6.4 Backup/restore boundary

На копиях disposable fixture проверить, что восстановление старого Core/Provider DB+WAL+SHM не откатывает независимый accepted-head authority. Проверка должна быть безопасной и не использовать рабочие базы.

Если текущий PC не имеет раздельного authority identity/storage и независимого backup domain, зафиксировать это как deployment blocker. Не пытаться компенсировать его локальным sidecar/counter.

## 7. PC-02 — Core authorizer и trusted Host identity

Проверить текущий реально запущенный Core и точные source/build references:

1. Какие read authorizers и per-acquisition visibility authorizers реально конфигурируются при bootstrap.
2. Откуда берутся trusted implementations и кто владелец их deployment configuration.
3. Что происходит при отсутствующем authorizer, ошибке инициализации или исключении: отказ/не-ready, без permissive fallback.
4. Есть ли реальная аутентифицированная Host-session identity, отличимая от chat locator и caller-supplied `adapter_id`/`recipient`.
5. Есть ли server-side binding Host session → enrolled conversation → world → canonical actor.
6. Не выводятся ли эти значения из request body без независимой проверки.

Не добавлять временные production authorizers и не подменять реальные механизмы тестовыми callbacks. Если текущий endpoint/route отсутствует, не придумывать URL и не вызывать несуществующий API.

Ожидаемый результат на текущем candidate #755 может быть BLOCKED: сам PR прямо не включает production authorizer configuration и authenticated Host-session identity. Это нужно подтвердить по фактическому current main/candidate, а не маскировать mock-тестом.

## 8. PC-03 — private Core read и Host context serialization

Проверить наличие полного фактического пути:

1. Host session authentication.
2. Server-side resolution of conversation/world/actor.
3. Core-owned authorized acquisition/read.
4. Получение только допустимых данных и source epistemic classes.
5. Сборка Host context.
6. Сериализация точного outbound request.

Установить конкретные файлы, функции и вызовы на каждом шаге. Если цепочка обрывается, отметить точку обрыва и владельца.

Не создавать тестовый receiver, mock route или serializer, чтобы изобразить отсутствующую production-интеграцию. Не читать/передавать реальные чаты.

## 9. PC-04 — final disclosure / dispatch gate

Проверить, существует ли на текущем установленном коде одна реальная граница перед отправкой модели, в которой одновременно учитываются:

- действующая Host session и binding;
- Core source/currentness/authorization;
- Provider grant/revocation/readiness;
- tombstone/source replacement/rollback;
- exact request/model/route/body;
- durable dispatch-start ordering.

Если реального final-send пути нет, runtime-тест не запускать и не строить mock как замену. Зафиксировать BLOCKED с точным отсутствующим звеном.

Если и только если такой путь уже существует в текущем согласованном коде и может быть проверен в полностью изолированном окружении без реальных чатов/секретов, подготовить тестовую матрицу:

- denial/revocation до dispatch-start → 0 upstream calls;
- valid authorized request → ровно 1 upstream call;
- race: candidate A отозван во время проверки candidate B → A не раскрывается;
- ambiguous crash/restart после dispatch-start → автоматического повторного upstream вызова нет;
- missing/throwing authorizer, Core/Provider outage, stale source → 0 calls.

Не включать production traffic и не использовать реальные пользовательские сообщения.

## 10. PC-05 — Host installation status (только контроль, без повторного D5)

Для изолированной ST 8010:

- проверить установленный lifecycle/Direction A artifact hash и сопоставить с ранее проверенным D5.3 артефактом;
- проверить, что основная ST 8000 и Core 8787 не изменены;
- не повторять creation/edit/delete/sync/restart/IndexedDB сценарии, уже пройденные в D4/D5.1/D5.3;
- не выполнять отложенные DA/LOCK/LLM сценарии;
- если установленный артефакт отличается от D5.3, только зафиксировать diff/hash и запросить отдельное решение о повторном тестировании.

PR #753 — Draft и stacked на #750; его CI не означает, что он установлен на ПК.

## 11. Что не входит в эту задачу

- Любые тесты VectorService, Ollama embeddings, Vectra, vector query/insert/delete и remote-store.
- Повторный полный `npm test`, recalculation oracle или Provider acceptance suite только ради повторения зелёного CI.
- Повторные тесты Process Manager #243.
- Повторные D4/D5 lifecycle тесты.
- DA-04—DA-08, LOCK-03—05, LOCK-07—08, LLM Swipe/Regenerate/Cancel.
- NPC production activation, Memory→NPC enablement, реальная передача чатов модели.
- Исправления найденных проблем, новые API/schema/runtime fields или изменения production-кода.

## 12. Формат отчёта

Каждый результат должен иметь evidence class:

- SOURCE — source inspection;
- CI — GitHub exact-head CI;
- PC-READONLY — наблюдение реального ПК без записи;
- PC-FIXTURE — тест disposable fixture;
- PC-RUNTIME — реальный runtime-тест изолированного экземпляра;
- NOT TESTED / BLOCKED — не выполнено или отсутствует prerequisite.

Таблица:

| ID | Проверка | Evidence class | Фактический результат | Статус | Доказательство |
|---|---|---|---|---|---|

В конце обязательно:

1. Фактический baseline и точные SHAs.
2. Реальные PID/process paths и service identities.
3. Effective ACL / backup-domain matrix либо причина, почему её нельзя получить.
4. Проверка PR #751 только на disposable fixture, если безопасно доступна.
5. Authorizer/bootstrap result.
6. Host session binding result.
7. Private read/context serializer trace.
8. Final dispatch boundary trace либо точка отсутствия.
9. Host installed artifact hash без повторного функционального теста.
10. Baseline/after integrity confirmation.
11. Отдельный список BLOCKED prerequisites и владельцев.
12. Подтверждение, что vectorization, production code, рабочие DB/chats, ST 8000, Core 8787 и GitHub workstreams не изменялись.

## 13. Критерий завершения

PC-NEXT-02 завершён, когда:

- безопасно собран baseline целевого ПК;
- Windows deployment/ACL состояние измерено read-only и candidate script проверен только на disposable fixture, если это возможно;
- реальные authorizer/session/read/serializer/dispatch звенья прослежены до конкретных файлов и runtime endpoints;
- отсутствующие механизмы честно отмечены BLOCKED, без mock-подмены;
- уже пройденные Host/Core/Provider/Process Manager/vectorization тесты не дублировались;
- рабочие процессы, БД, чаты, код и safety статусы не изменились.

**Итоговый verdict должен отвечать на один вопрос: какие реальные PC deployment gates уже доказаны, а какие конкретно мешают безопасной интеграции Host → Core → Provider → NPC → final dispatch?**
