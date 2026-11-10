import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

const require = createRequire(process.env.PLAYWRIGHT_PACKAGE_JSON);
const { chromium } = require('playwright');
const baseUrl = new URL(process.env.ST_BASE_URL || 'http://127.0.0.1:60619');
const reportDir = process.env.ST_ACCEPTANCE_REPORT_DIR || process.cwd();
const timeoutMs = Number(process.env.ST_ACCEPTANCE_TIMEOUT_MS || 120000);

const profileDir = process.env.ST_EDGE_PROFILE_DIR;
const edgeExe = process.env.ST_EDGE_EXECUTABLE;
fs.mkdirSync(reportDir, { recursive: true });

const results = [];
const errors = [];
const record = (name, status, detail = '') => {
  results.push({ name, status, detail });
  const prefix = status === 'PASS' ? '[PASS]' : status === 'FAIL' ? '[FAIL]' : '[BLOCKED]';
  console.log(prefix + ' ' + name + (detail ? ' — ' + detail : ''));
};

let context;
let page;
try {
  if (!profileDir || !edgeExe) throw new Error('EDGE_PROFILE_OR_EXECUTABLE_NOT_CONFIGURED');
  console.log('[INFO] Launching Edge with isolated profile: ' + profileDir);
  context = await chromium.launchPersistentContext(profileDir, {
    executablePath: edgeExe, headless: false,
    args: ['--profile-directory=Default', '--no-first-run', '--no-default-browser-check'],
    viewport: null,
    timeout: 60000,
  });
  console.log('[INFO] Edge started; navigating to ' + baseUrl.href);
  page = context.pages()[0] || await context.newPage();
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
  record('SillyTavern UI', 'PASS', 'HTTP ' + response.status() + ', composer rendered in the existing Edge profile');

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

  console.log('');
  console.log('[ACTION REQUIRED] In the opened SillyTavern window:');
  console.log('  1. Select the character and chat you want to use for this test.');
  console.log('  2. If the API is disconnected, click Connect. Do not change the selected model, API URL, or key.');
  console.log('  3. Return to this console and press Enter once. The runner will send one test message in the currently open chat.');
  console.log('[INFO] Waiting for your confirmation...');
  if (!stdin.isTTY) throw new Error('INTERACTIVE_TERMINAL_REQUIRED_FOR_ST_UI_STEP');
  const prompt = createInterface({ input: stdin, output: stdout });
  try { await prompt.question('Press Enter after the SillyTavern chat is ready... '); }
  finally { prompt.close(); }
  record('Manual SillyTavern preparation', 'PASS', 'User confirmed the character/chat is selected and API connection is ready.');

  const composer = page.locator('#send_textarea');
  const sendButton = page.locator('#send_but');
  const assistantCountBeforeSend = await page.locator('#chat .mes[is_user="false"][is_system="false"]').count();
  const marker = 'LOGIC_ENGINE_ACCEPTANCE_' + new Date().toISOString() + '_' + Math.random().toString(16).slice(2, 8);
  await composer.fill('Automated Logic Engine acceptance check. Reply with the exact word ACCEPTED. Test marker: ' + marker);
  if (await sendButton.isVisible().catch(() => false)) await sendButton.click();
  else await composer.press('Enter');

  let assistantText = '';
  let previousText = '';
  let stablePolls = 0;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const assistantMessages = page.locator('#chat .mes[is_user="false"][is_system="false"] .mes_text');
    if (await assistantMessages.count() > assistantCountBeforeSend) {
      const currentText = (await assistantMessages.last().innerText().catch(() => '')).trim();
      const stopVisible = await page.locator('#mes_stop').isVisible().catch(() => false);
      if (currentText && currentText !== '...' && currentText === previousText && !stopVisible) stablePolls += 1;
      else stablePolls = 0;
      previousText = currentText;
      if (stablePolls >= 3) { assistantText = currentText; break; }
    }
    await page.waitForTimeout(1000);
  }
  if (!assistantText) {
    record('Model generation', 'FAIL', 'No assistant response within ' + timeoutMs + ' ms; inspect browser/server logs.');
  } else {
    record('Model generation', 'PASS', 'Assistant response received (' + assistantText.length + ' characters).');
    const userMessage = page.locator('#chat .mes[is_user="true"] .mes_text').filter({ hasText: marker });
    if (await userMessage.count() === 0) record('User message rendered', 'FAIL', 'Unique test marker not found in chat.');
    else record('User message rendered', 'PASS', 'Unique test marker found.');
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.locator('#send_textarea').waitFor({ state: 'visible', timeout: 45000 });
    const persisted = await page.locator('#chat .mes[is_user="true"] .mes_text').filter({ hasText: marker }).count();
    const persistedAssistant = await page.locator('#chat .mes[is_user="false"][is_system="false"] .mes_text').filter({ hasText: assistantText }).count();
    if (persisted > 0 && persistedAssistant > 0) record('Chat persistence after reload', 'PASS', 'The exact test marker and assistant response were restored.');
    else record('Chat persistence after reload', 'FAIL', 'Restored user marker=' + persisted + ', matching assistant response=' + persistedAssistant);
  }

  const screenshot = path.join(reportDir, 'browser-acceptance.png');
  await page.screenshot({ path: screenshot, fullPage: true }).catch(() => {});
  const uncaught = errors.filter(item => item.type === 'pageerror');
  record('Browser diagnostics', uncaught.length ? 'FAIL' : 'PASS',
    errors.length + ' console/network warning(s), ' + uncaught.length + ' uncaught page error(s); screenshot: ' + screenshot);
} catch (error) {
  record('Browser acceptance execution', 'FAIL', error.stack || error.message);
  if (page) await page.screenshot({ path: path.join(reportDir, 'browser-acceptance-failure.png'), fullPage: true }).catch(() => {});
}
if (context) await context.close().catch(() => {});
const summary = {
  schema_version: 3, base_url: baseUrl.href, browser: 'Microsoft Edge launched with existing profile; no remote debugging', completed_at: new Date().toISOString(),
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
