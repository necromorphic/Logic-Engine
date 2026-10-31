import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { HostLifecycleJournal, lifecycleJournalContract } from '../lifecycle-journal.mjs';

globalThis.crypto ??= webcrypto;
globalThis.IDBKeyRange = { only: value => ({ only: value }) };
class FakeRequest { result=undefined; error=null; onsuccess=null; onerror=null; }
class FakeStore {
  constructor(db, tx, name) { this.db=db; this.tx=tx; this.name=name; }
  index() { return { getAll: range => { const req=new FakeRequest(); queueMicrotask(()=>{req.result=[...this.db.rows.values()].filter(row=>row.conversationId===range.only);req.onsuccess?.();if(this.tx.mode==='readonly')this.db.finish(this.tx);});return req; } }; }
  get(key) { const req=new FakeRequest(); queueMicrotask(()=>{req.result=this.db.heads.get(key)??undefined;req.onsuccess?.();if(this.tx.mode==='readonly')this.db.finish(this.tx);});return req; }
  add(record) { if(this.db.failNextWrite){this.db.failNextWrite=false;throw Error('simulated disk full');}if(this.db.rows.has(record.id))throw Error('duplicate key');this.db.rows.set(record.id,structuredClone(record));queueMicrotask(()=>this.db.finish(this.tx)); }
  put(record) { this.db.heads.set(record.conversationId,structuredClone(record));queueMicrotask(()=>this.db.finish(this.tx)); }
}
class FakeTransaction { error=null;oncomplete=null;onerror=null;onabort=null;constructor(db,names,mode){this.db=db;this.names=names;this.mode=mode;}objectStore(name){return new FakeStore(this.db,this,name);}abort(){this.error=Error('transaction aborted');setImmediate(()=>this.onabort?.());} }
class FakeDB { rows=new Map();heads=new Map();failNextWrite=false;transaction(names,mode='readonly'){return new FakeTransaction(this,names,mode);}finish(tx){setImmediate(()=>tx.oncomplete?.());} }
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

test('caller-supplied path list cannot assert trusted capture readiness',async()=>{
 const journal=new HostLifecycleJournal(new FakeDB());await journal.enroll(seed());
 const result=await journal.status('chat-1',{instrumentedPaths:lifecycleJournalContract.requiredCoveragePaths,sourceFingerprintMatches:true});
 assert.equal(result.status,'NON_READY');assert.match(result.reason,/no trusted pinned-source attestation/);
});
