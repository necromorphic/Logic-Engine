import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { HostLifecycleJournal, fingerprintSource, lifecycleJournalContract } from '../lifecycle-journal.mjs';

globalThis.crypto ??= webcrypto;
globalThis.IDBKeyRange = { only: value => ({ only: value }) };
class FakeRequest { result=undefined; error=null; onsuccess=null; onerror=null; }
class FakeStore {
  constructor(db, tx, name) { this.db=db; this.tx=tx; this.name=name; }
  index() { return { getAll: range => { const req=new FakeRequest(); queueMicrotask(()=>{req.result=[...this.db.rows.values()].filter(row=>row.conversationId===range.only);req.onsuccess?.();this.db.finish(this.tx);});return req; } }; }
  get(key) { const req=new FakeRequest(); queueMicrotask(()=>{req.result=this.db.heads.get(key)??undefined;req.onsuccess?.();this.db.finish(this.tx);});return req; }
  add(record) { if(this.db.failNextWrite){this.db.failNextWrite=false;throw Error('simulated disk full');}if(this.db.rows.has(record.id))throw Error('duplicate key');this.db.rows.set(record.id,structuredClone(record));queueMicrotask(()=>this.db.finish(this.tx)); }
  put(record) { this.db.heads.set(record.conversationId,structuredClone(record));queueMicrotask(()=>this.db.finish(this.tx)); }
}
class FakeTransaction { error=null;oncomplete=null;onerror=null;onabort=null;constructor(db,names){this.db=db;this.names=names;}objectStore(name){return new FakeStore(this.db,this,name);} }
class FakeDB { rows=new Map();heads=new Map();failNextWrite=false;transaction(names){return new FakeTransaction(this,names);}finish(tx){setImmediate(()=>tx.oncomplete?.());} }
const canonical=x=>Array.isArray(x)?'['+x.map(canonical).join(',')+']':x&&typeof x==='object'?'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}':JSON.stringify(x);
const sha256=x=>createHash('sha256').update(canonical(x)).digest('hex');
const seed=()=>({conversationId:'chat-1',sourceFingerprint:'fp-1',messages:[{role:'user',text:'hello'},{role:'assistant',versions:['first','second'],activeVersionIndex:1}]});

test('baseline has durable IDs and digests but no raw text',async()=>{
 const journal=new HostLifecycleJournal(new FakeDB()),result=await journal.enroll(seed());
 assert.equal(result.baselineSequence,1);assert.equal(result.preEnrollmentHistory,'UNKNOWN_UNRECOVERABLE');
 assert.equal(result.mapping.length,2);assert.equal(result.mapping[1].versions.length,2);
 assert.notEqual(result.mapping[1].versions[0].versionId,result.mapping[1].versions[1].versionId);
 assert.equal(JSON.stringify(result).includes('hello'),false);
});
test('same event replay is idempotent; event ID reused with different payload fails closed',async()=>{
 const journal=new HostLifecycleJournal(new FakeDB());await journal.enroll(seed());
 const event={conversationId:'chat-1',eventId:'evt-1',operation:'before:delete-swipe',payload:{affectedVersions:['v1']}};
 const first=await journal.append(event),replay=await journal.append(event);assert.equal(first.recordDigest,replay.recordDigest);
 const conflict=await journal.append({...event,payload:{affectedVersions:['v2']}});
 assert.equal(conflict.status,'NON_READY');assert.match(conflict.reason,/event ID conflict/);
});
test('durable write failure requires caller to abort mutation and marks scope NON_READY',async()=>{
 const db=new FakeDB(),journal=new HostLifecycleJournal(db);await journal.enroll(seed());db.failNextWrite=true;
 await assert.rejects(journal.beforeMutation({conversationId:'chat-1',eventId:'evt-fail',operation:'delete-message',affectedVersions:['v1']}),/MUST abort mutation/);
 assert.deepEqual(await journal.status('chat-1'),{status:'NON_READY',reason:'durable append failed: simulated disk full'});
});
test('readiness remains fail-closed when a mutation path is not instrumented',async()=>{
 const journal=new HostLifecycleJournal(new FakeDB());await journal.enroll(seed());
 const result=await journal.status('chat-1',{instrumentedPaths:['delete-message'],sourceFingerprintMatches:true});
 assert.equal(result.status,'NON_READY');assert.ok(result.missingPaths.includes('create-message'));
 for (const path of ['delete-chat', 'delete-group-chat', 'delete-character-chat-recursive', 'import-character-chat', 'import-group-chat', 'backup-restore', 'create-branch', 'group-metadata-migration']) {
  assert.ok(lifecycleJournalContract.requiredCoveragePaths.includes(path), `missing required lifecycle coverage path: ${path}`);
 }
});
test('live source inventory is compared to the journaled checkpoint but a match remains non-authoritative',async()=>{
 const messages=[{is_user:true,mes:'hello',swipes:['hello'],swipe_id:0}];
 const sourceFingerprint=await fingerprintSource(messages,'chat.jsonl');
 const journal=new HostLifecycleJournal(new FakeDB());
 await journal.enroll({conversationId:'chat-1',sourceFingerprint,messages:[{role:'user',text:'hello'}]});
 const result=await journal.verifyCurrentSource('chat-1',{messages,sourceLocator:'chat.jsonl'});
 assert.equal(result.status,'LOCAL_MATCH_NON_AUTHORITATIVE');
 assert.equal(result.authority,'NON_AUTHORITATIVE');
 assert.equal(result.trustDecision,'NON_READY');
 assert.ok(result.blockers.includes('NO_INDEPENDENT_TRUST_ANCHOR'));
});
test('coordinated rewrite of local record and head can defeat local hashes and therefore never proves authenticity',async()=>{
 const db=new FakeDB();
 const original=[{is_user:true,mes:'hello',swipes:['hello'],swipe_id:0}];
 const originalFingerprint=await fingerprintSource(original,'chat.jsonl');
 const journal=new HostLifecycleJournal(db);
 await journal.enroll({conversationId:'chat-1',sourceFingerprint:originalFingerprint,messages:[{role:'user',text:'hello'}]});
 const changed=[{is_user:true,mes:'attacker-controlled',swipes:['attacker-controlled'],swipe_id:0}];
 const row=[...db.rows.values()][0];
 row.sourceFingerprint=await fingerprintSource(changed,'chat.jsonl');
 row.eventDigest=sha256({conversationId:row.conversationId,eventId:row.eventId,operation:row.operation,payload:row.payload,sourceFingerprint:row.sourceFingerprint});
 const {recordDigest:ignored,...base}=row;
 row.recordDigest=sha256(base);
 db.rows.set(row.id,structuredClone(row));
 db.heads.set('chat-1',{conversationId:'chat-1',sequence:row.sequence,recordDigest:row.recordDigest,sourceFingerprint:row.sourceFingerprint});
 const result=await journal.verifyCurrentSource('chat-1',{messages:changed,sourceLocator:'chat.jsonl'});
 assert.equal(result.status,'LOCAL_MATCH_NON_AUTHORITATIVE');
 assert.equal(result.trustDecision,'NON_READY');
 assert.ok(result.blockers.includes('HOST_STORAGE_REWRITE_AND_ROLLBACK_NOT_EXCLUDED'));
});

test('live source inventory drift fails closed even when local journal integrity is intact',async()=>{
 const messages=[{is_user:true,mes:'hello',swipes:['hello'],swipe_id:0}];
 const sourceFingerprint=await fingerprintSource(messages,'chat.jsonl');
 const journal=new HostLifecycleJournal(new FakeDB());
 await journal.enroll({conversationId:'chat-1',sourceFingerprint,messages:[{role:'user',text:'hello'}]});
 const changed=[{is_user:true,mes:'tampered',swipes:['tampered'],swipe_id:0}];
 const result=await journal.verifyCurrentSource('chat-1',{messages:changed,sourceLocator:'chat.jsonl'});
 assert.equal(result.status,'NON_READY');
 assert.equal(result.journalIntegrity,'VERIFIED');
 assert.equal(result.reason,'live source inventory fingerprint mismatch');
});

test('mutation before enrollment is NON_READY',async()=>{
 const journal=new HostLifecycleJournal(new FakeDB());
 const result=await journal.append({conversationId:'chat-1',eventId:'evt-1',operation:'before:delete-message',payload:{affectedVersions:[]}});
 assert.equal(result.status,'NON_READY');assert.equal(result.reason,'event before baseline');
});
test('journal corruption is detected on status check',async()=>{
 const db=new FakeDB(),journal=new HostLifecycleJournal(db);await journal.enroll(seed());
 [...db.rows.values()][0].payload.messages[0].role='tampered';
 const result=await journal.status('chat-1',{instrumentedPaths:lifecycleJournalContract.requiredCoveragePaths,sourceFingerprintMatches:true});
 assert.equal(result.status,'NON_READY');assert.match(result.reason,/digest mismatch/);
});
test('concurrent appends serialize to a gap-free sequence',async()=>{
 const db=new FakeDB(),journal=new HostLifecycleJournal(db);await journal.enroll(seed());
 await Promise.all(Array.from({length:8},(_,i)=>journal.append({conversationId:'chat-1',eventId:'evt-'+i,operation:'test-event',payload:{i}})));
 const rows=[...db.rows.values()].sort((a,b)=>a.sequence-b.sequence);assert.deepEqual(rows.map(row=>row.sequence),[1,2,3,4,5,6,7,8,9]);
});
test('tail truncation is detected by the independent atomic head checkpoint',async()=>{
 const db=new FakeDB(),journal=new HostLifecycleJournal(db);await journal.enroll(seed());
 const tail=[...db.rows.values()][0];db.rows.delete(tail.id);
 const result=await journal.status('chat-1',{instrumentedPaths:lifecycleJournalContract.requiredCoveragePaths,sourceFingerprintMatches:true});
 assert.equal(result.status,'NON_READY');assert.match(result.reason,/records missing|head checkpoint mismatch/);
});

test('journal status cannot be upgraded by caller-supplied source data or booleans',async()=>{
 const journal=new HostLifecycleJournal(new FakeDB());await journal.enroll(seed());
 const result=await journal.status('chat-1',{instrumentedPaths:lifecycleJournalContract.requiredCoveragePaths});
 assert.equal(result.status,'NON_READY');
 assert.match(result.reason,/live source verification must run through the Host bridge/);
});
