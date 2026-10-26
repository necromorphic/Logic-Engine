import { saveSettingsDebounced } from '../../../../script.js';
import { extension_settings, renderExtensionTemplateAsync } from '../../../extensions.js';

const EXTENSION_NAME = 'third-party/logic-engine';
const SETTINGS_KEY = 'logicEngineBridge';
const DEFAULT_URL = 'http://192.168.0.84:8789';

function getSettings() {
    extension_settings[SETTINGS_KEY] ??= { baseUrl: DEFAULT_URL };
    return extension_settings[SETTINGS_KEY];
}

function normalizeBaseUrl(value) {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) {
        throw new Error('Only HTTP(S) URLs are supported.');
    }
    if (url.username || url.password || url.search || url.hash) {
        throw new Error('URL must not contain credentials, query parameters, or a fragment.');
    }
    return url.toString().replace(/\/$/, '');
}

function setStatus(message, state = 'neutral') {
    const element = document.getElementById('logic_engine_bridge_status');
    if (!element) return;
    element.textContent = message;
    element.dataset.state = state;
}

async function checkConnection() {
    const settings = getSettings();
    let baseUrl;
    try {
        baseUrl = normalizeBaseUrl(document.getElementById('logic_engine_bridge_url')?.value || settings.baseUrl);
    } catch (error) {
        setStatus(error.message, 'error');
        return;
    }

    setStatus('Checking /health…');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
        const response = await fetch(baseUrl + '/health', {
            method: 'GET',
            headers: { Accept: 'application/json' },
            signal: controller.signal,
            cache: 'no-store',
        });
        if (!response.ok) {
            setStatus('HTTP ' + response.status + ' from ' + baseUrl + '/health', 'error');
            return;
        }
        const data = await response.json();
        if (data?.ok !== true || data?.service !== 'logic-engine') {
            setStatus('Endpoint answered, but did not identify itself as Logic-Engine. No engine operations were sent.', 'error');
            return;
        }
        setStatus('Connected · ' + data.service + ' · protocol ' + (data.protocol_version || 'unknown'), 'ok');
    } catch (error) {
        const message = error?.name === 'AbortError' ? 'Connection check timed out after 5 seconds.' : (error?.message || 'Connection failed.');
        setStatus(message + ' Check the PC address, firewall, and API process.', 'error');
    } finally {
        clearTimeout(timeout);
    }
}

export async function init() {
    const settings = getSettings();
    const html = await renderExtensionTemplateAsync(EXTENSION_NAME, 'settings');
    const container = document.getElementById('extensions_settings');
    if (!container || document.getElementById('logic_engine_bridge_url')) return;
    container.insertAdjacentHTML('beforeend', html);

    const input = document.getElementById('logic_engine_bridge_url');
    input.value = settings.baseUrl || DEFAULT_URL;

    document.getElementById('logic_engine_bridge_save')?.addEventListener('click', () => {
        try {
            settings.baseUrl = normalizeBaseUrl(input.value);
            saveSettingsDebounced();
            setStatus('URL saved. No game data has been sent.', 'ok');
        } catch (error) {
            setStatus(error.message, 'error');
        }
    });
    document.getElementById('logic_engine_bridge_check')?.addEventListener('click', checkConnection);
}

