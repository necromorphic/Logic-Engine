import { eventSource, event_types } from '../../../script.js';
import { extension_settings, saveSettingsDebounced } from '../../../extensions.js';

const EXTENSION_KEY = 'logicEngine';
const DEFAULTS = {
    coreUrl: 'http://127.0.0.1:8787',
    lastHealth: null,
};

let settings;
let panel;

function getSettings() {
    if (!extension_settings[EXTENSION_KEY]) {
        extension_settings[EXTENSION_KEY] = structuredClone(DEFAULTS);
    }
    settings = { ...DEFAULTS, ...extension_settings[EXTENSION_KEY] };
    return settings;
}

function persist() {
    extension_settings[EXTENSION_KEY] = { ...settings };
    saveSettingsDebounced();
}

function normalizeBaseUrl(value) {
    const parsed = new URL(String(value).trim());
    if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new Error('Core URL must use HTTP or HTTPS.');
    }
    if (parsed.username || parsed.password || parsed.search || parsed.hash) {
        throw new Error('Core URL must not contain credentials, query parameters, or a fragment.');
    }
    return parsed.href.replace(/\/+$/, '');
}

function renderPanel() {
    const current = getSettings();
    panel = document.createElement('section');
    panel.id = 'logic_engine_extension';
    panel.className = 'logic-engine-extension';
    panel.innerHTML = `
        <div class="logic-engine-title">Logic-Engine</div>
        <label class="logic-engine-label" for="logic_engine_core_url">Core address</label>
        <input id="logic_engine_core_url" class="text_pole" type="url" spellcheck="false">
        <div class="logic-engine-actions">
            <button id="logic_engine_save" class="menu_button">Save</button>
            <button id="logic_engine_check" class="menu_button">Check connection</button>
        </div>
        <div id="logic_engine_status" class="logic-engine-status" role="status">Not checked</div>
        <div class="logic-engine-note">This extension connects to Logic-Engine. It does not change the selected model or API provider.</div>
    `;
    panel.querySelector('#logic_engine_core_url').value = current.coreUrl;
    panel.querySelector('#logic_engine_save').addEventListener('click', () => {
        try {
            settings.coreUrl = normalizeBaseUrl(panel.querySelector('#logic_engine_core_url').value);
            persist();
            setStatus('Address saved. Check the connection.', 'neutral');
        } catch (error) {
            setStatus(error.message, 'error');
        }
    });
    panel.querySelector('#logic_engine_check').addEventListener('click', checkConnection);
    const target = document.querySelector('#extensions_settings');
    if (target) target.append(panel);
}

function setStatus(message, state = 'neutral') {
    const node = panel?.querySelector('#logic_engine_status');
    if (!node) return;
    node.textContent = message;
    node.dataset.state = state;
}

async function checkConnection() {
    const button = panel?.querySelector('#logic_engine_check');
    if (button) button.disabled = true;
    setStatus('Checking Logic-Engine Core…');
    try {
        const base = normalizeBaseUrl(panel.querySelector('#logic_engine_core_url').value);
        const response = await fetch(base + '/health', {
            method: 'GET',
            headers: { Accept: 'application/json' },
            cache: 'no-store',
            credentials: 'omit',
            redirect: 'error',
            signal: AbortSignal.timeout(5000),
        });
        if (!response.ok) throw new Error(`Core returned HTTP ${response.status}`);
        const data = await response.json();
        if (data?.ok !== true || data?.service !== 'logic-engine') {
            throw new Error('The endpoint responded, but it is not a Logic-Engine Core health endpoint.');
        }
        settings.coreUrl = base;
        settings.lastHealth = new Date().toISOString();
        persist();
        setStatus('Connected to Logic-Engine Core.', 'success');
    } catch (error) {
        setStatus(`Connection failed: ${error.message}`, 'error');
    } finally {
        if (button) button.disabled = false;
    }
}

export async function init() {
    getSettings();
    renderPanel();
    eventSource.on(event_types.APP_READY, () => console.debug('[Logic-Engine] extension ready.'));
}

export function exit() {
    panel?.remove();
}
