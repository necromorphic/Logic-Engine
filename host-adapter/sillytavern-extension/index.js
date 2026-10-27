import { saveSettingsDebounced } from '../../../script.js';
import { extension_settings, renderExtensionTemplateAsync } from '../../../extensions.js';
import { fetchHealth, normalizeEngineUrl } from './bridge-core.mjs';

const MODULE_NAME = 'third-party/logic-engine';
const DEFAULTS = Object.freeze({ engineUrl: 'http://127.0.0.1:8787' });
let lifecycleController = null;
let initPromise = null;

function setStatus(element, text, state = 'neutral') {
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
    initPromise = initialize();
    try {
        await initPromise;
    } catch (error) {
        initPromise = null;
        throw error;
    }
}

async function initialize() {
    // A reactivation must not leave duplicate panels or stale handlers.
    cleanup();
    lifecycleController = new AbortController();
    const signal = lifecycleController.signal;

    extension_settings.logicEngine ??= { ...DEFAULTS };
    extension_settings.logicEngine.engineUrl ??= DEFAULTS.engineUrl;

    const html = await renderExtensionTemplateAsync(MODULE_NAME, 'settings');
    if (signal.aborted) return;
    const settingsRoot = document.querySelector('#extensions_settings');
    if (!settingsRoot) throw new Error('SillyTavern settings container #extensions_settings was not found.');
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

    checkButton.addEventListener('click', async () => {
        checkButton.disabled = true;
        setStatus(status, 'Проверка…');
        try {
            const body = await fetchHealth(saveUrl(), fetch, signal);
            setStatus(status, `Связь есть: ${body.service}, протокол ${body.protocol_version}. Авторизация адаптера и Memory → NPC не проверены.`, 'ok');
        } catch (error) {
            if (!signal.aborted) setStatus(status, `Связь не подтверждена: ${error?.message || 'неизвестная ошибка'}`, 'error');
        } finally {
            if (!signal.aborted) checkButton.disabled = false;
        }
    }, { signal });

    enrollButton.addEventListener('click', async () => {
        enrollButton.disabled = true;
        setStatus(hostStatus, 'Подключение чата…');
        try {
            const bridge = hostBridge();
            if (!bridge) throw new Error('Host lifecycle bridge не установлен или не совместим.');
            const result = await bridge.enrollCurrentConversation();
            const capture = await bridge.getCoreCaptureStatus();
            setStatus(hostStatus, `Журнал подключён: ${result?.status || 'состояние не указано'}. Core capture: ${capture?.status || 'не подтверждён'}.`, 'neutral');
        } catch (error) {
            if (!signal.aborted) setStatus(hostStatus, `Не готово: ${error?.message || 'неизвестная ошибка'}`, 'error');
        } finally {
            if (!signal.aborted) enrollButton.disabled = !hostBridge();
        }
    }, { signal });

    syncButton.addEventListener('click', async () => {
        syncButton.disabled = true;
        setStatus(hostStatus, 'Сверка дайджестов…');
        try {
            const bridge = hostBridge();
            if (!bridge) throw new Error('Host lifecycle bridge не установлен или не совместим.');
            const result = await bridge.syncCurrentDigestInventory();
            const capture = await bridge.getCoreCaptureStatus();
            setStatus(hostStatus, `Сверка: ${result?.status || 'статус не указан'}. Core capture: ${capture?.status || 'не подтверждён'}. Полнота истории не подтверждена.`, 'neutral');
        } catch (error) {
            if (!signal.aborted) setStatus(hostStatus, `Сверка не готова: ${error?.message || 'неизвестная ошибка'}`, 'error');
        } finally {
            if (!signal.aborted) syncButton.disabled = !hostBridge();
        }
    }, { signal });

    const bridgeAvailable = Boolean(hostBridge());
    enrollButton.disabled = !bridgeAvailable;
    syncButton.disabled = !bridgeAvailable;
    setStatus(hostStatus, bridgeAvailable
        ? 'Host lifecycle bridge найден. Полнота источника и готовность Memory → NPC не подтверждены.'
        : 'Host lifecycle bridge не найден. Доступна только диагностическая проверка /health.', 'neutral');
}

export function cleanup() {
    lifecycleController?.abort();
    lifecycleController = null;
    document.querySelector('#logic_engine_extension')?.remove();
    initPromise = null;
}
