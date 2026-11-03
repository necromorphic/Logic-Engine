import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(process.argv[2] ?? 'SillyTavern');
const script = await readFile(resolve(root, 'public/script.js'), 'utf8');
const chats = await readFile(resolve(root, 'src/endpoints/chats.js'), 'utf8');
const serverMain = await readFile(resolve(root, 'src/server-main.js'), 'utf8');
const pluginLoader = await readFile(resolve(root, 'src/plugin-loader.js'), 'utf8');
const extensions = await readFile(resolve(root, 'public/scripts/extensions.js'), 'utf8');
const openai = await readFile(resolve(root, 'public/scripts/openai.js'), 'utf8');
const serverStartup = await readFile(resolve(root, 'src/server-startup.js'), 'utf8');
const gatewayManifest = JSON.parse(await readFile(resolve(process.cwd(), 'host-adapter/extension-gateway/manifest.json'), 'utf8'));
const gatewayClient = await readFile(resolve(process.cwd(), 'host-adapter/extension-gateway/index.js'), 'utf8');
const gatewayServer = await readFile(resolve(process.cwd(), 'host-adapter/extension-gateway/server-plugin/index.mjs'), 'utf8');
const revision = '06bde939fb1e9c4c8d8641d810f0a916b5bce127';

function has(source, pattern, message) {
  assert.match(source, pattern, message);
}

// Static source assertions only. They do not claim runtime delivery or inventory completeness.
has(script, /await eventSource\.emit\(event_types\.MESSAGE_SENT, chat_id\)/, 'user-message send event must be present');
has(script, /eventSource\.emit\(event_types\.MESSAGE_RECEIVED, this\.messageId, this\.type\)/, 'assistant receive event with index/type must be present');
has(script, /eventSource\.emit\(event_types\.MESSAGE_EDITED, this_edit_mes_id\)/, 'edit event with numeric index must be present');
has(script, /eventSource\.emit\(event_types\.MESSAGE_DELETED, chat\.length\)/, 'delete event with array length must be present');
has(script, /eventSource\.emit\(event_types\.MESSAGE_SWIPED, \(mesId\)\)/, 'swipe event with numeric index must be present');
has(script, /eventSource\.emit\(event_types\.CHAT_CHANGED, getCurrentChatId\(\)\)/, 'chat-change event must be present');
has(script, /await eventSource\.emit\(event_types\.GENERATION_STARTED, type, \{[\s\S]{0,400}?signal[\s\S]{0,150}?\}, dryRun\)/, 'generation start must expose type/options/signal/dryRun');
has(script, /eventSource\.emit\(event_types\.GENERATION_STOPPED\)/, 'generation stop event must be present');
has(script, /eventSource\.emit\(event_types\.GENERATION_ENDED, chat\.length\)/, 'generation end event must be present');
has(script, /export function getCurrentChatId\(\)\s*\{[\s\S]{0,260}?groups\.find\(x => x\.id == selected_group\)\?\.chat_id[\s\S]{0,180}?characters\[this_chid\]\?\.chat/, 'current chat ID must not be treated as immutable authority');
has(script, /export async function saveChatConditional\(\)[\s\S]{0,1800}?catch \(error\) \{\s*console\.error\('Error saving chat', error\);\s*\}/, 'saveChatConditional catches and logs save failures');
has(chats, /router\.post\('\/save'[\s\S]{0,1600}?request\.body\.chat[\s\S]{0,500}?request\.body\.file_name/, 'server chat save endpoint must be inspected for caller-supplied chat/file name');

console.log(`PASS: pinned SillyTavern source audit at ${revision}`);
console.log('Evidence class: SOURCE-INSPECTED only; not runtime/browser/Android evidence.');
console.log('Lifecycle callbacks use indexes/current chat IDs; save helper catches persistence errors; these checks do not establish source identity, complete inventory, or anti-rollback.');


has(serverMain, /app\.use\(requireLoginMiddleware\)[\s\S]*?loadPlugins\(app, pluginsDirectory\)/,
  'native server plugins must be loaded after SillyTavern login middleware');
has(pluginLoader, /const enableServerPlugins = !!getConfigValue\('enableServerPlugins', false, 'boolean'\)/,
  'server plugin loading must remain opt-in');
has(pluginLoader, /app\.use\(\`\/api\/plugins\/\$\{id\}\`, router\)/,
  'native server plugin router must mount under /api/plugins/{id}');
has(extensions, /runGenerationInterceptors/,
  'the native interceptor chain exists but is not used as the Memory ingress');
has(script, /await eventSource\.emit\(event_types\.GENERATE_AFTER_DATA, generate_data\)/,
  'text-generation locator event must be awaited before native request serialization');
has(openai, /await eventSource\.emit\(event_types\.CHAT_COMPLETION_SETTINGS_READY, generate_data\)/,
  'Chat Completions locator event must be awaited before native request serialization');
assert.equal(Object.hasOwn(gatewayManifest, 'generate_interceptor'), false,
  'Logic Engine must not register a parallel browser generation interceptor');
has(gatewayClient, /CHAT_COMPLETION_SETTINGS_READY/,
  'Extension must attach a locator at the native Chat Completions data event');
has(gatewayClient, /GENERATE_AFTER_DATA/,
  'Extension must attach a locator at the native text-generation data event');
has(gatewayClient, /logic_engine_conversation_uuid/,
  'Extension may attach only an untrusted Host conversation locator');
has(gatewayServer, /id: 'logic-engine-extension-gateway'/,
  'server-side gateway must be a native SillyTavern server plugin');
assert.doesNotMatch(gatewayServer, /router\.post\(['"]\/dispatch/,
  'the browser-facing Memory dispatch route must not exist');
assert.doesNotMatch(gatewayServer, /\/api\/logic-engine/,
  'the adapter must not register separate ST /api/logic-engine routes');
assert.doesNotMatch(serverStartup, /logic-engine-(?:lifecycle|host-inventory)/,
  'pinned SillyTavern startup source must not be patched to mount Logic Engine routes');
assert.doesNotMatch(script, /logicEngineHostLifecycle/,
  'pinned SillyTavern public source must remain unmodified');
