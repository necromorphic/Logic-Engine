# Issue #258 — Host/Adapter: проверка захвата изменений SillyTavern

**Дата:** 2026-10-29  
**Статус:** `PARTIAL / NON_READY`  
**Решение:** Host capture — `NON_READY`; Stage 2 — `NO-GO`; Memory → NPC — `DISABLED / FAIL-CLOSED`.

## Зафиксированные ревизии

- SillyTavern target: `1.19.0-1-g06bde939f`
- SillyTavern SHA: `06bde939fb1e9c4c8d8641d810f0a916b5bce127`
- Host-кандидат: [PR #680](https://github.com/necromorphic/Logic-Engine/pull/680)
- Проверенный HEAD PR #680: `b86c7738676eb88052965c220d5b5287c1542b69`
- База `main`: `38392882997eb5634e2c716c7b203f16d3308207`

Загруженный SillyTavern ZIP не содержит `.git`, поэтому его Git SHA нельзя независимо подтвердить локально через `git rev-parse`. Проверка exact pin выполняется в CI, который делает checkout конкретного SHA.

## Результаты локальных проверок

| Проверка | Результат | Что именно подтверждено |
|---|---:|---|
| `npm test` на загруженном архиве Logic-Engine | 800/800 passed | Тесты содержимого загруженного архива, не свежего checkout PR #680 |
| Host prototype tests | 71/71 passed | Идентичность, конфликты, повторная обработка, tombstone, журнал и recovery в тестовых сценариях |
| Проверка применимости патча к SillyTavern ZIP | PASS | Патч применим к имеющимся файлам архива |
| Проверка синтаксиса host-файлов/модулей | 8/8 PASS | Синтаксис, не поведение живого UI |
| Source audit на архиве | 6 passed | Git SHA assertion исключён из-за отсутствия `.git` |

## Exact-HEAD CI

Все пять workflow завершились успешно на HEAD `b86c7738676eb88052965c220d5b5287c1542b69`:

- [Host lifecycle patch check](https://github.com/necromorphic/Logic-Engine/actions/runs/40821424508)
- [Host lifecycle patch validation](https://github.com/necromorphic/Logic-Engine/actions/runs/40821424495)
- [Chromium IndexedDB restart](https://github.com/necromorphic/Logic-Engine/actions/runs/40821424484)
- [Pinned SillyTavern source audit — Linux и Windows](https://github.com/necromorphic/Logic-Engine/actions/runs/40821424464)
- [Runtime tests](https://github.com/necromorphic/Logic-Engine/actions/runs/40821424463)

В pinned-router harness проверены отдельные маршруты импорта обычного и группового чата, удаления backup, Data Maid и пользователя. Для охваченных сценариев тесты подтверждают отказ до native handler и сохранность проверяемых байтов. Это не покрывает все плагины и внешние изменения файлов.

## Матрица доказательств

| Сценарий | Наблюдение | Класс доказательства | Ограничение |
|---|---|---|---|
| Сообщение пользователя | В исследованном пути save идёт до `MESSAGE_SENT`, затем `USER_MESSAGE_RENDERED` | Source inspection + pinned-source CI | Событие не подтверждает, что пользователь прочитал сообщение |
| Ответ генерации | `MESSAGE_RECEIVED` может возникать до последующего сохранения | Source inspection + pinned-source CI | Не является подтверждением persistence или доставки NPC |
| Edit / update | События используют индекс массива SillyTavern | Source inspection + pinned-source CI | Индекс не является долговечной идентичностью сообщения |
| Swipe | Событие использует host-local индекс | Source inspection | Полная история веток не доказана только событием |
| Delete | `MESSAGE_DELETED` передаёт новый `chat.length`, не ID удалённого сообщения | Source inspection + pinned-source CI | Нужно сопоставлять состояние до и после операции |
| Duplicate/replay | Проверяются идемпотентность и конфликт повторного ID с другим содержимым | Host prototype tests | Только покрытые тестами случаи |
| Tombstone / journal recovery | Проверены тестовые удаления и восстановление журнала | Host prototype + persistence tests | Не доказывает перехват каждого возможного источника удаления |
| Browser restart | Проверено сохранение IndexedDB через перезапуск Chromium | CI | Не доказывает отсутствие внешних изменений |
| Import / backup / Data Maid / user delete | Проверены отдельные pinned server routes | CI real-router harness | Не полный инвентарь всех маршрутов |
| Полный интерактивный цикл в установленном ST | Не выполнен в этой проверке | Unknown / not reproduced | Acceptance gate остаётся открытым |

## Что подтверждено

1. Кандидат PR #680 проходит exact-HEAD CI на указанной ревизии.
2. Прототип Host проходит локальные тесты на идентичность, конфликты, повторы, tombstone и восстановление в покрытых сценариях.
3. События SillyTavern сами по себе не доказывают долговременную идентичность и сохранение.
4. Для перечисленных опасных серверных маршрутов есть проверки отказа до мутации.
5. `MESSAGE_RECEIVED` нельзя трактовать как «факт получен NPC», «сообщение сохранено» или «сообщение доставлено».

## Оставшиеся acceptance gates

- Полный inventory всех путей изменения истории: расширения, внешние файловые операции, import/restore/migration, copy/branch lineage.
- Полнота исторических сообщений до подключения Host capture.
- Живой браузерный сценарий: create → edit → swipe/regenerate → delete → chat switch → reload/restart с независимым чтением сохранённой истории после каждого шага.
- Независимый anti-rollback trust anchor и проверка ACL/backup-restore на целевом устройстве.
- Доказательство единственного Gateway egress и правильного порядка отзыва доступа относительно финальной отправки.
- Независимое принятие Core/security и проверка установленного SillyTavern/Android-Termux.

## Решение

- Оставить PR #680 в Draft.
- Не закрывать Issue #258 как полностью выполненный: `PARTIAL / NON_READY`.
- Не включать production retrieval и Memory → NPC.
- Не добавлять новые Core API/schema или Provider mutation ради закрытия этого пункта.
- Не считать зелёный CI независимым security review или разрешением на production activation.

Обновление опубликовано в [Issue #258](https://github.com/necromorphic/Logic-Engine/issues/258#issuecomment-6488520428).
