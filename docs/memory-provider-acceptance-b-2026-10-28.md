# Memory Provider — пункт B: фактическая приёмка

**Дата:** 2026-10-28  
**Область:** Provider-local persistence, identity, authorization, tombstone and reconciliation.  
**Ограничение:** эта матрица не является разрешением на хранение исходного текста SillyTavern. Production Memory→NPC остаётся **DISABLED / FAIL-CLOSED**.

## Результаты по критериям

| Критерий | Статус | Доказательство / ограничение |
|---|---|---|
| Сохранить Provider record и прочитать после перезапуска | **PASS** | `tests/sqlite-memory-provider.test.js`: `persists raw record identity/version and rebuilds its derived index after restart`. |
| Повторная доставка идентичной записи идемпотентна | **PASS — Provider record** | `does not turn duplicate ingest into a second record or permit identity rebinding`: повтор возвращает `duplicate`, а не создаёт вторую запись. |
| Конфликт одной identity с другим payload не перезаписывает запись | **PASS — Provider record** | Тот же тест проверяет отказ `MEMORY_IDENTITY_CONFLICT`. Это не доказывает raw Host capture, поскольку он закрыт отдельным policy gate. |
| Raw Host capture: duplicate/conflicting payload | **BLOCKED BY POLICY** | `captureRawMessage()` всегда отклоняет запрос с `MEMORY_RAW_CAPTURE_NOT_APPROVED`. Проверить ветки duplicate/conflict через публичный путь нельзя без одобрения Core; недостижимый код не засчитывается как PASS. |
| Переключение активной raw swipe-версии без изменения старой | **BLOCKED BY POLICY** | `selectActiveRawVersion()` закрыт с `MEMORY_RAW_SOURCE_NOT_APPROVED`. Тесты жизненного цикла подтверждают сохранение альтернативной версии при точечном tombstone, но это не эквивалент успешного переключения active pointer через публичный API. |
| Отзыв Provider record не позволяет снова читать запись | **PASS — Provider record** | `denies by default and immediately honors record revocation`; `record revocation survives Provider restart and index rebuild cannot restore access`. |
| Raw source tombstone сохраняется после рестарта и не возвращает удалённую версию в active pointer | **PASS — Provider-local lifecycle** | Добавлен тест `exact-version tombstone persists across Provider restart without resurrecting the deleted version`. Он использует legacy/test fixture rows, не включает raw capture и не утверждает, что Host deletion signal уже надёжен. |
| Raw text read/disclosure | **BLOCKED BY POLICY / FAIL-CLOSED** | `readRawMessageVersion()` и `readActiveRawMessages()` отклоняют запрос с `MEMORY_RAW_DISCLOSURE_NOT_APPROVED`, даже при callback, возвращающем разрешение. |
| Старый backup Provider DB не откатывает независимый accepted head | **PASS — enrolled Provider test** | `tests/provider-accepted-head-handshake.test.js`: `Provider rejects restoration of an older enrolled database snapshot`. Это действует только при реально настроенном независимом accepted-head authority; локальный SQLite сам по себе не является защитой от администратора/файлового отката. |
| Прерванная reconciliation не выдаёт готовность после перезапуска | **PASS — Provider-local** | `tests/memory-provider-reconcile-interruption.test.js`: retrieval остаётся `MEMORY_INDEX_NOT_READY` до полного успешного reconciliation. |
| Полный Host→Provider→NPC путь с pinned SillyTavern | **NOT PROVEN HERE** | Нужны Host lifecycle/identity inventory и доказательство sole-egress на целевом развёртывании. Provider-native тесты не подменяют их. |

## Изменение в рамках этой приёмки

Добавлен тест перезапуска для точечного raw tombstone. Он проверяет, что:
1. tombstone остаётся в SQLite после закрытия и повторного открытия Provider;
2. удалённая версия не возвращается в active-version pointer;
3. другая версия того же логического сообщения сохраняет исходный текст;
4. публичное чтение исходного текста всё ещё закрыто policy gate.

Тест намеренно не открывает `captureRawMessage`, `selectActiveRawVersion` или raw disclosure.

## Итог пункта B

**Provider-local acceptance: PASS для доступных и разрешённых контрактов.**  
**Raw Host archive identity lifecycle: PARTIAL / BLOCKED BY POLICY.** Не объявлять пункт B целиком PASS, пока Core не утвердит правила хранения/чтения исходного текста и не будет разрешено проверять публичные duplicate/conflict/active-selection пути.  
**Production Memory→NPC: DISABLED / FAIL-CLOSED.**

Следующий необходимый шаг для полного B — отдельное решение Core по raw-text retention/disclosure. До этого безопасная реализация обязана оставаться закрытой; обходить gate только ради тестов нельзя.

## CI evidence for this revision

The acceptance change was tested in GitHub Actions on the exact branch head `fbe41bf7b07ff31ac1b6c09974cc17e756ecc397`:
- Provider accepted-head + raw lifecycle focused suite: **30/30 passed**.
- Full Runtime suite: **1054/1054 passed**.
- Recalculation oracle: **20/20 passed**.
- Run: [#40749235166](https://github.com/necromorphic/Logic-Engine/actions/runs/40749235166).

Environment captured in that run: Ubuntu 24.04.5 LTS, Node.js 22.13.0, npm 10.9.2, Node built-in SQLite 3.47.2. This is CI evidence, not a fresh test on the user's Windows/Termux deployment.
