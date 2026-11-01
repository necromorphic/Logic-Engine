import { renderExtensionTemplateAsync } from '../../../extensions.js';
import {
  CONNECTION_STATES,
  describeGatewayFailure,
  describeGatewayResult,
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
  setStatus(status, 'Не проверено', CONNECTION_STATES.idle);
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
