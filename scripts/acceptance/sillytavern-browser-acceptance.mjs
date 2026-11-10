import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(process.env.PLAYWRIGHT_PACKAGE_JSON);
const { chromium } = require('playwright');
const baseUrl = new URL(process.env.ST_BASE_URL || 'http://127.0.0.1:8000');
const reportDir = process.env.ST_ACCEPTANCE_REPORT_DIR || process.cwd();
const timeoutMs = Number(process.env.ST_ACCEPTANCE_TIMEOUT_MS || 120000);
const skipGeneration = process.env.ST_ACCEPTANCE_SKIP_GENERATION === '1';
const headless = process.env.ST_ACCEPTANCE_HEADLESS !== '0';
fs.mkdirSync(reportDir, { recursive: true });

const results = [];
const errors = [];
const record = (name, status, detail = '') => {
  results.push({ name, status, detail });
  const prefix = status === 'PASS' ? '[PASS]' : status === 'FAIL' ? '[FAIL]' : '[BLOCKED]';
  console.log(prefix + ' ' + name + (detail ? ' — ' + detail : ''));
};

let browser;
let page;
try {
  browser = await chromium.launch({ headless });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on('console', message => {
    if (message.type() === 'error') errors.push({ type: 'console', text: message.text() });
  });
  page.on('pageerror', error => errors.push({ type: 'pageerror', text: error.message }));
  page.on('requestfailed', request => errors.push({
    type: 'requestfailed', url: request.url(), error: request.failure()?.errorText || 'unknown',
  }));

  const response = await page.goto(baseUrl.href, { waitUntil: 'domcontentloaded', timeout: 45000 });
  if (!response || response.status() >= 400) throw new Error('ST_PAGE_HTTP_' + (response?.status() ?? 'NO_RESPONSE'));
  await page.locator('#send_textarea').waitFor({ state: 'visible', timeout: 45000 });
  record('SillyTavern UI', 'PASS', 'HTTP ' + response.status() + ', composer rendered');

  // ST mounts this extension router under its plugin namespace; these are not root routes.
  const gatewayPrefix = '/api/plugins/logic-engine-extension-gateway';
  for (const endpoint of [gatewayPrefix + '/session', gatewayPrefix + '/identity']) {
    try {
      const result = await page.evaluate(async route => {
        const response = await fetch(route, { credentials: 'same-origin', cache: 'no-store' });
        const text = await response.text();
        return { status: response.status, body: text.slice(0, 300) };
      }, endpoint);
      record(endpoint, result.status === 200 ? 'PASS' : 'FAIL', 'HTTP ' + result.status);
    } catch (error) {
      record(endpoint, 'FAIL', error.message);
    }
  }

  const composer = page.locator('#send_textarea');
  const sendButton = page.locator('#send_but');
  const placeholder = await composer.getAttribute('placeholder') || '';
  const sendVisible = await sendButton.isVisible().catch(() => false);
  const connected = !/not connected to api/i.test(placeholder) && sendVisible;
  if (!connected) {
    record('Model/API readiness', 'BLOCKED', 'No active API connection or send control is hidden; generation was not attempted.');
  } else if (skipGeneration) {
    record('Generation and chat persistence', 'BLOCKED', 'Skipped by -SkipGeneration.');
  } else {
    await page.locator('#options_button').click();
    const newChat = page.locator('#option_start_new_chat');
    const canStartNewChat = await newChat.isVisible().catch(() => false);
    if (!canStartNewChat) {
      record('Generation and chat persistence', 'BLOCKED', 'No active character/chat context is available to start a clean test chat.');
    } else {
      await newChat.click();
      await page.waitForTimeout(1200);

      const marker = 'LOGIC_ENGINE_ACCEPTANCE_' + new Date().toISOString() + '_' + Math.random().toString(16).slice(2, 8);
    await composer.fill('Automated Logic Engine acceptance check. Reply with the exact word ACCEPTED. Test marker: ' + marker);
    await sendButton.click();

    let assistantText = '';
    let previousText = '';
    let stablePolls = 0;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const assistantMessages = page.locator('#chat .mes:not(.is_user) .mes_text');
      if (await assistantMessages.count() > 0) {
        const currentText = (await assistantMessages.last().innerText().catch(() => '')).trim();
        const stopVisible = await page.locator('#mes_stop').isVisible().catch(() => false);
        if (currentText && currentText !== '...' && currentText === previousText && !stopVisible) {
          stablePolls += 1;
        } else {
          stablePolls = 0;
        }
        previousText = currentText;
        if (stablePolls >= 3) { assistantText = currentText; break; }
      }
      await page.waitForTimeout(1000);
    }
    if (!assistantText) {
      record('Model generation', 'FAIL', 'No assistant response within ' + timeoutMs + ' ms; inspect browser/server logs.');
    } else {
      record('Model generation', 'PASS', 'Assistant response received (' + assistantText.length + ' characters).');
      const userMessage = page.locator('#chat .mes.is_user .mes_text').filter({ hasText: marker });
      if (await userMessage.count() === 0) {
        record('User message rendered', 'FAIL', 'Unique test marker not found in chat.');
      } else {
        record('User message rendered', 'PASS', 'Unique test marker found.');
      }
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.locator('#send_textarea').waitFor({ state: 'visible', timeout: 45000 });
      const persisted = await page.locator('#chat .mes.is_user .mes_text').filter({ hasText: marker }).count();
      const persistedAssistant = await page.locator('#chat .mes:not(.is_user) .mes_text').count();
      if (persisted > 0 && persistedAssistant > 0) {
        record('Chat persistence after reload', 'PASS', 'Test user message and assistant response remain visible.');
      } else {
        record('Chat persistence after reload', 'FAIL', 'One or both test messages were not restored.');
      }
    }
    }
  }

  const screenshot = path.join(reportDir, 'browser-acceptance.png');
  await page.screenshot({ path: screenshot, fullPage: true }).catch(() => {});
  const uncaught = errors.filter(item => item.type === 'pageerror');
  record('Browser diagnostics', uncaught.length ? 'FAIL' : 'PASS',
    errors.length + ' console/network warning(s), ' + uncaught.length + ' uncaught page error(s); screenshot: ' + screenshot);
} catch (error) {
  record('Browser acceptance execution', 'FAIL', error.stack || error.message);
  if (page) await page.screenshot({ path: path.join(reportDir, 'browser-acceptance-failure.png'), fullPage: true }).catch(() => {});
} finally {
  if (browser) await browser.close().catch(() => {});
}

const summary = {
  schema_version: 1, base_url: baseUrl.href, completed_at: new Date().toISOString(),
  results, browser_errors: errors,
  totals: {
    pass: results.filter(x => x.status === 'PASS').length,
    fail: results.filter(x => x.status === 'FAIL').length,
    blocked: results.filter(x => x.status === 'BLOCKED').length,
  },
};
fs.writeFileSync(path.join(reportDir, 'browser-acceptance.json'), JSON.stringify(summary, null, 2) + '\n');
console.log('\nSUMMARY PASS=' + summary.totals.pass + ' FAIL=' + summary.totals.fail + ' BLOCKED=' + summary.totals.blocked);
if (summary.totals.fail > 0) process.exitCode = 1;
else if (summary.totals.blocked > 0) process.exitCode = 2;
