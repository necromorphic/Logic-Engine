# Memory Provider — пункт B: фактическая приёмка

**Дата:** 2026-10-28  
**Область:** Provider-local persistence, identity, authorization, tombstone and reconciliation.  
**Политика Core:** исходный текст сообщений SillyTavern НЕ разрешён для долговременного хранения в lifecycle journal или Provider/Core integration (Core decision: [Issue #140, 25 Oct 2026](https://github.com/necromorphic/Logic-Engine/issues/140#issuecomment-6401452420)). Допустимы только digest/identity/lineage без исходного текста. Поэтому capture/read/active-selection должны оставаться закрытыми; это не ожидающее решения разрешение. Production Memory→NPC остаётся **DISABLED / FAIL-CLOSED**.

## Результаты по критериям

| Критерий | Статус | Доказательство / ограничение |
|---|---|---|
| Сохранить Provider record и прочитать после перезапуска | **PASS** | `tests/sqlite-memory-provider.test.js`: `persists raw record identity/version and rebuilds its derived index after restart`. |
| Повторная доставка идентичной записи идемпотентна | **PASS — Provider record** | `does not turn duplicate ingest into a second record or permit identity rebinding`: повтор возвращает `duplicate`, а не создаёт вторую запись. |
| Конфликт одной identity с другим payload не перезаписывает запись | **PASS — Provider record** | Тот же тест проверяет отказ `MEMORY_IDENTITY_CONFLICT`. Это не доказывает raw Host capture, поскольку он закрыт отдельным policy gate. |
| Raw Host capture: duplicate/conflicting payload | **NOT AUTHORIZED — FAIL-CLOSED VERIFIED** | Core запрещает долговременное хранение исходного текста. `tests/memory-provider-raw-archive.test.js`: `raw Host capture is denied and persists no content` проверяет `MEMORY_RAW_CAPTURE_NOT_APPROVED` и ноль строк в `memory_raw_captures`. Duplicate/conflict для raw text не является разрешённым публичным контрактом и не должен открываться ради тестирования. |
| Переключение активной raw swipe-версии | **NOT AUTHORIZED — FAIL-CLOSED VERIFIED** | `unapproved raw versions cannot be selected as active` проверяет `MEMORY_RAW_SOURCE_NOT_APPROVED` и отсутствие active-pointer rows. Это намеренный запрет на raw-text lifecycle, а не ожидающее решения одобрение. |
| Отзыв Provider record не позволяет снова читать запись | **PASS — Provider record** | `denies by default and immediately honors record revocation`; `record revocation survives Provider restart and index rebuild cannot restore access`. |
| Raw source tombstone сохраняется после рестарта и не возвращает удалённую версию в active pointer | **PASS — Provider-local lifecycle** | Добавлен тест `exact-version tombstone persists across Provider restart without resurrecting the deleted version`. Он использует legacy/test fixture rows, не включает raw capture и не утверждает, что Host deletion signal уже надёжен. |
| Raw text read/disclosure | **NOT AUTHORIZED — FAIL-CLOSED VERIFIED** | `raw Host disclosure remains denied even when a read callback grants access` проверяет отказ `MEMORY_RAW_DISCLOSURE_NOT_APPROVED` даже при разрешающем callback. Это соответствует действующему Core запрету на долговременное хранение/раскрытие исходного текста. |
| Старый backup Provider DB не откатывает независимый accepted head | **PASS — enrolled Provider test** | `tests/provider-accepted-head-handshake.test.js`: `Provider rejects restoration of an older enrolled database snapshot`. Это действует только при реально настроенном независимом accepted-head authority; локальный SQLite сам по себе не является защитой от администратора/файлового отката. |
| Прерванная reconciliation не выдаёт готовность после перезапуска | **PASS — Provider-local** | `tests/memory-provider-reconcile-interruption.test.js`: retrieval остаётся `MEMORY_INDEX_NOT_READY` до полного успешного reconciliation. |
| Полный Host→Provider→NPC путь с pinned SillyTavern | **NOT PROVEN HERE** | Нужны Host lifecycle/identity inventory и доказательство sole-egress на целевом развёртывании. Provider-native тесты не подменяют их. |

## Изменение в рамках этой приёмки

Добавлен тест перезапуска для точечного raw tombstone. Он проверяет, что:
1. tombstone остаётся в SQLite после закрытия и повторного открытия Provider;
2. удалённая версия не возвращается в active-version pointer;
3. другая версия того же логического сообщения сохраняет исходный текст;
4. публичное чтение исходного текста всё ещё закрыто policy gate.

Тест намеренно не открывает `captureRawMessage`, `selectActiveRawVersion` или raw disclosure. Эти методы остаются закрытыми по принятому Core решению; legacy/test fixture rows используются только для проверки поведения tombstone и не являются разрешением на создание новых raw-text записей.

## Итог пункта B

**Provider-local acceptance: PASS для проверенных разрешённых Provider-record контрактов и для enforcement действующего запрета на raw-text capture/disclosure.**  
**Raw Host text lifecycle: NOT AUTHORIZED / NOT APPLICABLE as a positive feature.** Core уже решил, что исходный текст нельзя долговременно хранить. Поэтому duplicate/conflict/active-selection/read для raw text не должны получать положительные PASS-статусы; критерий безопасности здесь — fail-closed и отсутствие новых сохранённых текстов. Legacy fixture/tombstone тесты характеризуют обработку ранее существовавших данных, но не разрешают capture.  
**Host metadata-only lifecycle and real Host integration: NOT PROVEN HERE.** Digest/identity/lineage lifecycle должен оцениваться отдельно от исходного текста и требует реального Host evidence.  
**Production Memory→NPC: DISABLED / FAIL-CLOSED.**

Решение Core уже существует; ожидание нового решения больше не является блокером. Не открывать raw-text методы. Следующая работа по Host должна оставаться digest/identity/lineage-only, с отдельной проверкой реального Host lifecycle.

## CI evidence for this revision

The acceptance change was tested in GitHub Actions on the exact branch head `39b6fa27465049b61657ef77475b2c45a629f61e`:
- Provider accepted-head + raw lifecycle focused suite: **30/30 passed**.
- Full Runtime suite: **1054/1054 passed**.
- Recalculation oracle: **20/20 passed**.
- Run: [#40749394006](https://github.com/necromorphic/Logic-Engine/actions/runs/40749394006).

Environment captured in that run: Ubuntu 24.04.5 LTS, Node.js 22.13.0, npm 10.9.2, Node built-in SQLite 3.47.2. This is CI evidence, not a fresh test on the user's Windows/Termux deployment.
