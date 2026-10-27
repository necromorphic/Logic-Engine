const STATUS_ENDPOINT = '/api/extensions/logic-engine-diagnostics/status';

export function describeStatus(response, payload) {
    if (response.status === 404) return { text: 'Серверный диагностический маршрут не установлен.', state: 'warning' };
    const code = payload?.error?.code;
    if (code === 'LOGIC_ENGINE_PROXY_UNCONFIGURED') return { text: 'Не настроен адрес Logic-Engine на сервере SillyTavern.', state: 'warning' };
    if (code === 'LOGIC_ENGINE_UNREACHABLE' || code === 'LOGIC_ENGINE_UNHEALTHY') return { text: 'Logic-Engine недоступен или не прошёл проверку.', state: 'error' };
    if (!response.ok || payload?.status !== 'reachable' || payload?.service !== 'logic-engine') return { text: 'Не удалось подтвердить доступность Logic-Engine.', state: 'error' };
    return { text: 'Logic-Engine доступен (protocol ' + String(payload.protocol_version ?? 'unknown') + ').', state: 'success' };
}

function mountDiagnosticPanel() {
    const host = document.getElementById('extensions_settings');
    if (!host || document.getElementById('logic-engine-diagnostic-panel')) return;

    const panel = document.createElement('section');
    panel.id = 'logic-engine-diagnostic-panel';
    panel.className = 'logic-engine-diagnostic extension_block';
    panel.innerHTML = [
        '<div class="logic-engine-diagnostic__header"><strong>Logic-Engine — диагностика</strong></div>',
        '<p class="logic-engine-diagnostic__description">Проверяет только доступность локального движка. Секреты и содержимое чата не отправляются.</p>',
        '<div class="logic-engine-diagnostic__actions">',
        '<button type="button" class="menu_button logic-engine-diagnostic__check">Проверить подключение</button>',
        '<span class="logic-engine-diagnostic__status" role="status" aria-live="polite">Не проверено.</span>',
        '</div>',
        '<p class="logic-engine-diagnostic__boundary">Memory → NPC: это расширение не читает и не передаёт Memory и не проверяет разрешение защищённого маршрута.</p>',
    ].join('');

    const button = panel.querySelector('.logic-engine-diagnostic__check');
    const status = panel.querySelector('.logic-engine-diagnostic__status');
    button.addEventListener('click', async () => {
        button.disabled = true;
        status.textContent = 'Проверка…';
        status.dataset.state = 'pending';
        try {
            const response = await fetch(STATUS_ENDPOINT, {
                method: 'GET',
                credentials: 'same-origin',
                headers: { Accept: 'application/json' },
                cache: 'no-store',
                signal: AbortSignal.timeout(7000),
            });
            let payload = null;
            try { payload = await response.json(); } catch { /* Invalid response remains a failure. */ }
            const result = describeStatus(response, payload);
            status.textContent = result.text;
            status.dataset.state = result.state;
        } catch {
            status.textContent = 'Не удалось связаться с диагностическим маршрутом SillyTavern.';
            status.dataset.state = 'error';
        } finally {
            button.disabled = false;
        }
    });
    host.append(panel);
}

if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountDiagnosticPanel, { once: true });
    else mountDiagnosticPanel();
}
