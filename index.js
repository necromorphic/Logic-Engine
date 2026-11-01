import { getRequestHeaders, saveSettingsDebounced } from '../../../../script.js';
import { extension_settings } from '../../../extensions.js';

const EXTENSION_KEY = 'logicEngine';
const DEFAULTS = { lastHealth: null };
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

function renderPanel() {
    getSettings();
    panel = document.createElement('section');
    panel.id = 'logic_engine_extension';
    panel.className = 'logic-engine-extension';
    panel.innerHTML = `
        <div class="logic-engine-title">Logic-Engine</div>
        <div class="logic-engine-description">Connects SillyTavern to the local Logic-Engine Host Adapter. Your model provider settings are not changed.</div>
        <div class="logic-engine-actions">
            <button id="logic_engine_check" class="menu_button">Check connection</button>
        </div>
        <div id="logic_engine_status" class="logic-engine-status" role="status">Not checked</div>
    `;
    panel.querySelector('#logic_engine_check').addEventListener('click', checkConnection);
    const target = document.querySelector('#extensions_settings');
    if (target) target.append(panel);
    if (current.lastHealth) {
        setStatus('Last successful check: ' + new Date(current.lastHealth).toLocaleString(), 'neutral');
    }
}

function setStatus(message, state = 'neutral') {
    const node = panel?.querySelector('#logic_engine_status');
    if (!node) return;
    node.textContent = message;
    node.dataset.state = state;
}

async function requestPlugin(path) {
    const response = await fetch('/api/plugins/logic-engine' + path, {
        method: 'GET',
        headers: { ...getRequestHeaders(), Accept: 'application/json' },
        cache: 'no-store',
        credentials: 'same-origin',
        redirect: 'error',
        signal: AbortSignal.timeout(5000),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        const code = data?.error?.code || 'HOST_ADAPTER_REQUEST_FAILED';
        throw new Error(`${code} (HTTP ${response.status})`);
    }
    return data;
}

async function checkConnection() {
    const button = panel?.querySelector('#logic_engine_check');
    if (button) button.disabled = true;
    setStatus('Checking authenticated Host Adapter…');
    try {
        const session = await requestPlugin('/session');
        if (session?.host_context_valid !== true || session?.adapter !== 'sillytavern-server-plugin') {
            throw new Error('The server did not confirm an SillyTavern server-resolved user context.');
        }
        const health = await requestPlugin('/health');
        if (health?.ok !== true || health?.host_adapter !== true || health?.core?.service !== 'logic-engine') {
            throw new Error('Logic-Engine Core is not ready.');
        }
        settings.lastHealth = new Date().toISOString();
        persist();
        setStatus('Connected: SillyTavern host context resolved; Logic-Engine Core reachable.', 'success');
    } catch (error) {
        setStatus(`Connection failed: ${error.message}. Check that the Logic-Engine server plugin is installed/enabled and Core is running.`, 'error');
    } finally {
        if (button) button.disabled = false;
    }
}

export async function init() {
    getSettings();
    renderPanel();
}

export function exit() {
    panel?.remove();
}
