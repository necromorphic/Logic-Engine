import { renderExtensionTemplateAsync } from '../../../extensions.js';
import { chat_metadata, getCurrentChatId, getRequestHeaders, saveMetadata } from '../../../../script.js';
import { resolveStableHostConversationIdentity } from './conversation-identity.mjs';
import {
  CONNECTION_STATES,
  describeGatewayFailure,
  describeGatewayResult,
  fetchGatewayIdentity,
  fetchGatewaySession,
} from './bridge-core.mjs';

const MODULE_NAME = 'third-party/logic-engine';
let lifecycleController = null;
let initPromise = null;

function setStatus(element, text, state = CONNECTION_STATES.idle) {
  if (!element?.isConnected) return;
  element.textContent = text;
  element.dataset.state = state;
}

export async function init() {
  if (initPromise) return initPromise;
  const pending = initialize();
  initPromise = pending;
  try {
    await pending;
  } catch (error) {
    teardown();
    initPromise = null;
    throw error;
  }
}

async function initialize() {
  teardown();
  lifecycleController = new AbortController();
  const signal = lifecycleController.signal;
  const html = await renderExtensionTemplateAsync(MODULE_NAME, 'settings');
  if (signal.aborted) return;
  const settingsRoot = document.querySelector('#extensions_settings2')
    || document.querySelector('#extensions_settings');
  if (!settingsRoot) throw new Error('SillyTavern settings container #extensions_settings2 was not found.');
  settingsRoot.insertAdjacentHTML('beforeend', html);

  const root = document.querySelector('#logic_engine_extension');
  if (!root) throw new Error('Logic-Engine settings panel failed to render.');
  const status = root.querySelector('#logic_engine_status');
  const checkButton = root.querySelector('#logic_engine_check');
  const contextStatus = root.querySelector('#logic_engine_context_status');
  const contextButton = root.querySelector('#logic_engine_context');

  const runCheck = async () => {
    checkButton.disabled = true;
    setStatus(status, 'Проверка Extension Gateway…', CONNECTION_STATES.checking);
    try {
      const body = await fetchGatewaySession(fetch, signal);
      const result = describeGatewayResult(body);
      setStatus(status, result.text, result.state);
    } catch (error) {
      if (signal.aborted) return;
      const failure = describeGatewayFailure(error);
      setStatus(status, failure.text, failure.state);
    } finally {
      if (!signal.aborted) checkButton.disabled = false;
    }
  };

  checkButton.addEventListener('click', runCheck, { signal });
  contextButton.addEventListener('click', async () => {
    contextButton.disabled = true;
    setStatus(contextStatus, 'Проверка identity и текущего чата…', CONNECTION_STATES.checking);
    try {
      const session = await fetchGatewaySession(fetch, signal);
      const identity = await fetchGatewayIdentity(fetch, signal);
      if (identity.host_session_id !== session.host_session_id) {
        throw new Error('Host session и account identity не совпадают');
      }
      const locator = getCurrentChatId();
      const metadata = chat_metadata;
      const resolved = await resolveStableHostConversationIdentity({
        locator,
        hostSessionId: session.host_session_id,
        hostInstallationId: identity.host_installation_id,
        authenticatedAccountId: identity.authenticated_account_id,
        metadata,
        storage: globalThis.localStorage,
        saveMetadata,
        getCurrentLocator: getCurrentChatId,
        getCurrentMetadata: () => chat_metadata,
        cryptoProvider: globalThis.crypto,
      });
      if (resolved.status !== 'READY_FOR_REVIEW'
        || getCurrentChatId() !== locator || chat_metadata !== metadata) {
        throw new Error(resolved.reason || 'Текущий чат изменился во время identity enrollment');
      }
      setStatus(contextStatus, 'Отправка подписанного Host context в Core…', CONNECTION_STATES.checking);
      const response = await fetch('/api/plugins/logic-engine-extension-gateway/context', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
        headers: getRequestHeaders(),
        body: JSON.stringify({ conversation_uuid: resolved.conversationUuid }),
        signal: AbortSignal.any([signal, AbortSignal.timeout(7000)]),
      });
      let body;
      try { body = await response.json(); } catch { throw new Error('Gateway вернул некорректный JSON'); }
      if (!response.ok || body?.status !== 'HOST_CONTEXT_AUTHENTICATED'
        || body?.world_binding_verified !== true || body?.actor_binding_verified !== true) {
        throw new Error(body?.code || 'Core не подтвердил текущие bindings');
      }
      setStatus(contextStatus, 'Core подтвердил Host session и текущие Conversation → World → Actor bindings. Memory retrieval и final-send остаются отключены.', CONNECTION_STATES.connected);
    } catch (error) {
      if (!signal.aborted) setStatus(contextStatus, `Контекст не подтверждён: ${error?.message || 'неизвестная ошибка'}`, CONNECTION_STATES.error);
    } finally {
      if (!signal.aborted) contextButton.disabled = false;
    }
  }, { signal });
  setStatus(status, 'Не проверено', CONNECTION_STATES.idle);
  setStatus(contextStatus, 'Core context не проверен', CONNECTION_STATES.idle);
  void runCheck();
}

export function cleanup() {
  teardown();
  initPromise = null;
}

function teardown() {
  lifecycleController?.abort();
  lifecycleController = null;
  document.querySelector('#logic_engine_extension')?.remove();
}
