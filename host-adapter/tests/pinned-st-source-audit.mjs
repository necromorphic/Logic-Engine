import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(process.argv[2] ?? 'SillyTavern');
const script = await readFile(resolve(root, 'public/script.js'), 'utf8');
const chats = await readFile(resolve(root, 'src/endpoints/chats.js'), 'utf8');
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
