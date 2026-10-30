# PC-NEXT-03 — Trusted Host identity и Authorized Read: source-grounded contract

**Status:** Architecture decision / implementation specification  
**Base:** `main` at `52ad14ddfa6ca23858066e7516b4dbd6a190ab01`  
**Scope:** Core ↔ SillyTavern Host identity and authorized read  
**Production changes:** None in this document  
**Memory → NPC:** DISABLED / FAIL-CLOSED

## 1. Purpose

Закрыть первый архитектурный разрыв PC-NEXT-02: связать уже существующие Core adapter authentication, Host conversation binding и ActorBindingService в одну проверяемую цепочку, не выдавая отдельную авторизацию чтения за разрешение на финальную отправку модели.

Документ основан на фактическом current-main source и ранее принятом Core final-disclosure contract. Это не заявление о готовой интеграции.

## 2. Source baseline: что уже реализовано

### 2.1 Adapter authentication

Файл: `src/api/server.js`.

- `createApiServer` требует общий bearer token.
- `adapterIdFor(req)` принимает `x-adapter-id` только если ID присутствует в server-side `adapterTokens`, а `x-adapter-token` совпадает с настроенным секретом через `secretMatches`.
- Adapter ID из заголовка сам по себе не является аутентификацией.
- Успешная проверка удостоверяет adapter instance, но не отдельную browser tab, пользователя или конкретную сессию чата.

### 2.2 Host conversation → world

Файл: `src/application/host-conversation-world-bindings.js`.

- Core-owned mapping: `(adapterId, conversationId) → worldId`.
- `resolve` принимает только `adapterId` и `conversationId`; произвольный `worldId` запрещён.
- Resolve требует активную binding и существующий world.
- Rebind требует явного флага и audit reason.
- В комментарии сервиса прямо указано, что binding не доказывает inventory completeness, freshness, Provider authorization, anti-rollback или dispatch authorization.

API: `POST /v1/host-conversation-bindings/resolve` в `src/api/server.js`. Adapter ID выводится из проверенных credentials; body допускает только `conversation_id`.

### 2.3 Adapter → canonical actor

Файл: `src/application/actor-bindings.js`.

- Отдельная Core-owned allowlist: `(worldId, adapterId, entityId) → actor`.
- Она подтверждает identity resolution, но сама по себе не даёт права на чтение знаний, изменение мира, approval или commit.
- API actor resolve принимает только `entity_id` в body; adapter ID выводится из аутентифицированного заголовка.

### 2.4 Authorized read

Файл: `src/application/authorized-read-service.js`.

- Требует canonical ActorBindingService.
- Требует явную trusted field policy.
- Проверяет recipient и purpose.
- Ограничивает набор entity IDs и fields.
- Не возвращает частичный target set, если часть сущностей отсутствует или полностью скрыта.
- Повторно проверяет actor binding и snapshot cursor после policy callback.
- Внутренний service не является outbound transport и не обеспечивает межпроцессную атомарность до передачи запроса модели.

Файл: `src/api/server.js` создаёт default policy: разрешает только собственные `entity_id`, `entity_type`, `status`. Атрибуты по умолчанию не раскрываются. `src/index.js` не передаёт в `createApiServer` custom `authorizedReadFieldPolicy`, поэтому фактический bootstrap использует именно узкую default policy.

API: `POST /v1/worlds/:world_id/authorized-read`. Route требует adapter authentication. Это существующий authorized-read route, но не Host/NPC context endpoint.

### 2.5 Runtime bootstrap

Файл: `src/index.js`.

- Создаёт Core SQLiteStore, LogicEngine, HostVersionDigestLedger и API server.
- Core по умолчанию слушает loopback.
- В показанном bootstrap не создаются Host-session service, NPC context serializer, NPC receiver или egress gateway.

## 3. Архитектурное решение

### 3.1 Не вводить detached Host lease как dispatch authorization

Отдельный short-lived lease, выданный до окончательного формирования outbound request, не является разрешением на раскрытие. Он может быть использован как correlation/session handle, но не заменяет финальную проверку.

Причина: Core final-disclosure contract требует единую PC-side serialized egress authority, которая принимает решение для точного неизменяемого request и сама владеет единственным outbound transport. Preflight read, bearer token или lease, отделённые от транспорта, недостаточны.

### 3.2 Состав trusted Host identity

Для Core-side операций доверенная идентичность строится из:
1. Проверенного adapter credential (server-side secret).
2. Стабильного Host conversation ID.
3. Core-owned active Host conversation binding, разрешающей world.
4. Core-owned active ActorBinding, разрешающей canonical actor в этом world для этого adapter.
5. Действующего enrollment/consent state, если операция требует enrollment.

Adapter ID и conversation ID — scope keys; только adapter secret подтверждает adapter instance. World и actor нельзя принимать как авторитетные значения из caller body: Core должен получить их из своих binding records.

Текущие две binding таблицы не следует считать атомарно объединёнными. Между ними нет единого Host-session record и нет доказанной транзакции, охватывающей оба lookup и последующий dispatch. До появления общей egress serialization boundary они годятся для scoped read resolution, но не для final disclosure.

### 3.3 Предлагаемый внутренний Core resolver

Добавить в будущем отдельный application service, условное имя `TrustedHostContextResolver`. Это не публичный API и не новый самостоятельный authority.

Вход:
- authenticated adapter identity, переданная только из API middleware/route после проверки adapter secret;
- stable conversation ID;
- operation purpose / recipient;
- при необходимости enrollment requirement.

Запрещённые входы:
- caller-authoritative world ID;
- caller-authoritative actor ID;
- request-supplied policy callback;
- model-generated authorization claims.

Алгоритм:
1. Проверить authenticated adapter context.
2. Разрешить активную Host conversation binding → canonical world.
3. Найти единственную активную ActorBinding для пары world + adapter. Если текущая схема допускает несколько акторов, требовать явного Core-owned selection/assignment record; не выбирать первый и не доверять body.
4. Проверить enrollment и статус операции.
5. Передать immutable trusted requester context в AuthorizedReadService.
6. Выполнить bounded authorized read с обязательной field policy.
7. Вернуть result + provenance/cursors только внутреннему Host integration layer.
8. Не выдавать этот результат как dispatch permit.

Если у одного adapter может быть несколько actor bindings в одном world, текущая модель не позволяет безопасно вывести единственного canonical actor из adapter + conversation. Это отдельный контракт, который должен быть решён явно.

### 3.4 Field visibility policy

Не расширять текущую default policy до произвольных атрибутов.

До утверждения typed visibility schema:
- default остаётся self-identity-only;
- arbitrary attributes остаются withheld;
- unknown field type — deny;
- missing policy — deny;
- throwing policy — deny;
- model/request body не может влиять на policy.

Первая допустимая read slice должна иметь явный allowlist полей с владельцем семантики и sensitivity classification. Для каждого поля фиксируются допустимые purpose и recipient. Не вводить generic `public` fallback.

### 3.5 Authorized read result

Результат должен сохранять:
- canonical world and actor binding identity;
- adapter identity (без credential material);
- world_revision и commit_sequence;
- entity/source IDs и source revisions, если источник поддерживает revision;
- exact allowed fields;
- purpose и recipient;
- visibility-policy revision/version;
- issued-at и freshness boundary.

Epistemic class включается только если он реально хранится/подтверждается источником. Нельзя синтезировать `CONFIRMED`, `OBSERVED`, `REPORTED` или `INFERRED` из отсутствующих metadata. Нельзя подменять существующую терминологию Logic-Engine новой enum без сверки с Core/Provider source model.

## 4. Что не решается этим workstream

Этот этап НЕ реализует:
- cross-process private read transport для Host;
- Host context serializer;
- NPC receiver;
- final dispatch gate;
- Provider/Core cross-store serialization;
- durable dispatch-start;
- automatic retry/recovery;
- Windows service identities или ACL;
- backup/restore isolation.

Эти механизмы зависят от Core final-disclosure contract и требуют отдельного совместного решения с Provider и Host owners.

## 5. Критические открытые решения до production implementation

1. **Canonical actor selection:** допускает ли продукт несколько actor bindings для одного adapter/world? Если да, кто и как Core-owned назначает actor для conversation? Нельзя выводить actor из произвольного body.
2. **Enrollment semantics:** какие enrollment states допускают read purpose `npc_decision`; как revoke/expiry инвалидируют pending context?
3. **Visibility schema owner:** какие поля и значения допустимы для NPC, narrator/model, player и adapter; кто утверждает semantics?
4. **Host conversation identity stability:** какой Host ID переживает rename, export/import, duplicate chat и restore; как duplicate IDs предотвращаются/разрешаются?
5. **Shared serialization authority:** как Core mutations, Provider grant/revocation/reconciliation writers и gateway dispatch-start участвуют в одном durable order? Отдельные SQLite transactions и process mutex недостаточны.
6. **Host transport ownership:** все protected requests должны идти через PC-side gateway; нужно перечислить и закрыть прямые provider, extension, retry, regenerate, continuation и alternate-backend paths.
7. **Revocation semantics:** что происходит с уже начатым dispatch, отменой, timeout и неизвестным upstream acknowledgement; автоматический retry ambiguous dispatch запрещён.

## 6. Обязательные тесты будущей реализации

Тестировать только после фиксации контракта и в disposable environment:
- adapter token missing/invalid → 401/403, no read;
- caller-supplied adapter/world/actor substitution → rejected or ignored, canonical IDs resolved from Core;
- inactive Host binding → deny;
- inactive/missing ActorBinding → deny;
- zero or multiple eligible actor bindings → deny until deterministic Core-owned actor assignment exists;
- enrollment missing/revoked → deny for NPC purpose;
- absent/throwing field policy → no attributes disclosed;
- caller requests withheld field → same safe denial/withheld behavior;
- stale world revision/commit sequence → stale read rejected;
- binding change between resolution and read → rejected;
- policy revision change before final dispatch → dispatch denied by final gate;
- exact outbound payload mutation after authorization → rejected by final gate.

Эти тесты не должны подменять отсутствующий production resolver/gateway mock-объектом и объявлять end-to-end интеграцию PASS.

## 7. Связанные актуальные workstreams

На дату source review:
- PR #755 закрыт как superseded; заменён PR #760.
- PR #760 открыт Draft, содержит Core NPC acquisition reader/belief candidate, но прямо не включает production authorizer configuration, authenticated Host-session identity, private cross-process Core read route, Host context serializer, NPC receiver или final-send wiring.
- PR #751 закрыт как superseded; заменён PR #756.
- PR #756 открыт Draft, содержит Windows accepted-head ACL candidate на базе #750; его CI fixture не доказывает target-PC effective ACL, pre-opened handles или независимый backup/restore domain.
- PR #750 — dependency/base для #756 и #760; до merge/retarget/revalidation не считать установленным на ПК.
- PR #753 и #720 закрыты; installed Direction A artifact проверялся отдельно в PC-NEXT-02.

Ссылки:
- [PR #750](https://github.com/necromorphic/Logic-Engine/pull/750)
- [PR #756](https://github.com/necromorphic/Logic-Engine/pull/756)
- [PR #760](https://github.com/necromorphic/Logic-Engine/pull/760)
- [Core Host binding contract](https://github.com/necromorphic/Logic-Engine/blob/main/docs/architecture/core-owned-host-conversation-world-binding-contract.md)
- [Core final disclosure contract](https://github.com/necromorphic/Logic-Engine/blob/main/docs/architecture/core-final-disclosure-authorization-contract.md)

## 8. Acceptance / release gate

PC-NEXT-03 может быть закрыт как architecture contract only после того, как:
- canonical actor selection resolved;
- enrollment and revocation semantics resolved;
- visibility schema owner and initial allowlist approved;
- Host conversation identity stability defined;
- trusted resolver design maps to current services without trusting body IDs;
- no detached lease is treated as final dispatch authorization.

Implementation is a separate change set and requires its own exact-head tests. Even after PC-NEXT-03, Memory → NPC remains DISABLED / FAIL-CLOSED until the shared serialization authority and sole protected outbound gateway are implemented and proven.

## 9. Current conclusion

Current Core already has adapter authentication, Core-owned Host conversation→world binding, Core-owned adapter→actor binding, and fail-closed AuthorizedReadService. The actual gap is their composition into one trusted conversation-scoped actor context and then into the still-missing serialized final egress path.

Do not create another token type or duplicate identity store until the seven open decisions above are resolved. Do not activate Memory → NPC.
