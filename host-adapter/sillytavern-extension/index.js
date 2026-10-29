import { saveSettingsDebounced } from '../../../../script.js';
import { extension_settings, renderExtensionTemplateAsync } from '../../../extensions.js';
import {
    CONNECTION_STATES,
    describeHealthFailure,
    describeHealthResult,
    fetchHealth,
    normalizeEngineUrl,
} from './bridge-core.mjs';

const MODULE_NAME = 'third-party/logic-engine';
const DEFAULTS = Object.freeze({ engineUrl: 'http://127.0.0.1:8787' });
let lifecycleController = null;
let initPromise = null;

function setStatus(element, text, state = CONNECTION_STATES.idle) {
    if (!element?.isConnected) return;
    element.textContent = text;
    element.dataset.state = state;
}

function hostBridge() {
    const bridge = globalThis.window?.logicEngineHostLifecycle;
    if (!bridge || typeof bridge.enrollCurrentConversation !== 'function'
        || typeof bridge.syncCurrentDigestInventory !== 'function'
        || typeof bridge.getCoreCaptureStatus !== 'function') return null;
    return bridge;
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
    // A reactivation must not leave duplicate panels or stale handlers.
    teardown();
    lifecycleController = new AbortController();
    const signal = lifecycleController.signal;

    extension_settings.logicEngine ??= { ...DEFAULTS };
    extension_settings.logicEngine.engineUrl ??= DEFAULTS.engineUrl;

    const html = await renderExtensionTemplateAsync(MODULE_NAME, 'settings');
    if (signal.aborted) return;
    const settingsRoot = document.querySelector('#extensions_settings2')
        || document.querySelector('#extensions_settings');
    if (!settingsRoot) throw new Error('SillyTavern settings container #extensions_settings2 was not found.');
    settingsRoot.insertAdjacentHTML('beforeend', html);

    const root = document.querySelector('#logic_engine_extension');
    if (!root) throw new Error('Logic-Engine settings panel failed to render.');
    const urlInput = root.querySelector('#logic_engine_url');
    const status = root.querySelector('#logic_engine_status');
    const hostStatus = root.querySelector('#logic_engine_host_status');
    const checkButton = root.querySelector('#logic_engine_check');
    const enrollButton = root.querySelector('#logic_engine_enroll');
    const syncButton = root.querySelector('#logic_engine_sync');
    urlInput.value = extension_settings.logicEngine.engineUrl;

    const saveUrl = () => {
        const normalized = normalizeEngineUrl(urlInput.value);
        extension_settings.logicEngine.engineUrl = normalized;
        urlInput.value = normalized;
        saveSettingsDebounced();
        return normalized;
    };

    const runCheck = async () => {
        checkButton.disabled = true;
        setStatus(status, 'Проверка…', CONNECTION_STATES.checking);
        try {
            const body = await fetchHealth(saveUrl(), fetch, signal);
            const result = describeHealthResult(body);
            setStatus(status, result.text, result.state);
        } catch (error) {
            if (signal.aborted) return;
            const failure = describeHealthFailure(error);
            setStatus(status, failure.text, failure.state);
        } finally {
            if (!signal.aborted) checkButton.disabled = false;
        }
    };

    checkButton.addEventListener('click', runCheck, { signal });

    enrollButton.addEventListener('click', async () => {
        enrollButton.disabled = true;
        setStatus(hostStatus, 'Подключение чата…', CONNECTION_STATES.checking);
        try {
            const bridge = hostBridge();
            if (!bridge) throw new Error('Host lifecycle bridge не установлен или не совместим.');
            const result = await bridge.enrollCurrentConversation();
            const capture = await bridge.getCoreCaptureStatus();
            setStatus(hostStatus, `Журнал подключён: ${result?.status || 'состояние не указано'}. Core capture: ${capture?.status || 'не подтверждён'}.`, CONNECTION_STATES.idle);
        } catch (error) {
            if (!signal.aborted) setStatus(hostStatus, `Не готово: ${error?.message || 'неизвестная ошибка'}`, CONNECTION_STATES.error);
        } finally {
            if (!signal.aborted) enrollButton.disabled = !hostBridge();
        }
    }, { signal });

    syncButton.addEventListener('click', async () => {
        syncButton.disabled = true;
        setStatus(hostStatus, 'Сверка дайджестов…', CONNECTION_STATES.checking);
        try {
            const bridge = hostBridge();
            if (!bridge) throw new Error('Host lifecycle bridge не установлен или не совместим.');
            const result = await bridge.syncCurrentDigestInventory();
            const capture = await bridge.getCoreCaptureStatus();
            setStatus(hostStatus, `Сверка: ${result?.status || 'статус не указан'}. Core capture: ${capture?.status || 'не подтверждён'}. Полнота истории не подтверждена.`, CONNECTION_STATES.idle);
        } catch (error) {
            if (!signal.aborted) setStatus(hostStatus, `Сверка не готова: ${error?.message || 'неизвестная ошибка'}`, CONNECTION_STATES.error);
        } finally {
            if (!signal.aborted) syncButton.disabled = !hostBridge();
        }
    }, { signal });

    const bridgeAvailable = Boolean(hostBridge());
    enrollButton.disabled = !bridgeAvailable;
    syncButton.disabled = !bridgeAvailable;
    setStatus(hostStatus, bridgeAvailable
        ? 'Host lifecycle bridge найден. Полнота источника и готовность Memory → NPC не подтверждены.'
        : 'Host lifecycle bridge не найден. Доступна только диагностическая проверка /health.', CONNECTION_STATES.idle);

    // Activation performs one read-only health check so a page reload shows the
    // current state without a click. Later checks are always user-initiated.
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
