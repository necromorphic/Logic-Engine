import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto, createHash } from 'node:crypto';
import { HostLifecycleJournal } from '../lifecycle-journal.mjs';
import { reconcileFilesystemInventory } from '../filesystem-reconciliation.mjs';

globalThis.crypto ??= webcrypto;
globalThis.IDBKeyRange = { only: value => ({ only: value }) };
class Request { result; error=null; onsuccess=null; onerror=null; }
class Store {
  constructor(db,tx){this.db=db;this.tx=tx;}
  index(){return {getAll:range=>{const r=new Request();queueMicrotask(()=>{r.result=[...this.db.rows.values()].filter(x=>x.conversationId===range.only);r.onsuccess?.();this.db.finish(this.tx);});return r;}};}
  get(key){const r=new Request();queueMicrotask(()=>{r.result=this.db.heads.get(key);r.onsuccess?.();this.db.finish(this.tx);});return r;}
  add(row){this.db.rows.set(row.id,structuredClone(row));queueMicrotask(()=>this.db.finish(this.tx));}
  put(row){this.db.heads.set(row.conversationId,structuredClone(row));queueMicrotask(()=>this.db.finish(this.tx));}
}
class Tx {oncomplete=null;onerror=null;onabort=null;constructor(db){this.db=db;}objectStore(){return new Store(this.db,this);}}
class DB {rows=new Map();heads=new Map();transaction(){return new Tx(this);}finish(tx){setImmediate(()=>tx.oncomplete?.());}}
const root='/disposable/st-data';
const scan=(unused='a'.repeat(64),textHash='b'.repeat(64))=>{
 const entries=[{path:'chats/a.jsonl',identity:{dev:'1',ino:'2',size:4,mtimeMs:1,ctimeMs:1},sha256:textHash}];
 return {status:'complete',scope:'single-root-regular-files-only',root,file_count:1,snapshot_sha256:createHash('sha256').update(JSON.stringify(entries)).digest('hex'),entries};
};
async function fixture(){const journal=new HostLifecycleJournal(new DB());await journal.enroll({conversationId:'chat',sourceFingerprint:'chat-fp',messages:[]});return journal;}

test('first complete filesystem scan is durably anchored in the existing lifecycle journal',async()=>{
 const journal=await fixture();
 const result=await reconcileFilesystemInventory({journal,conversationId:'chat',inventory:scan(),sourceFingerprint:'chat-fp',expectedRoot:root});
 assert.equal(result.status,'BASELINED_REVIEW_ONLY');
 const ledger=await journal.exportCaptureLedger('chat');
 assert.equal(ledger.records.at(-1).operation,'filesystem-inventory-baseline');
 assert.equal(JSON.stringify(ledger).includes('raw message'),false);
});
test('identical filesystem scan reconciles without growing the journal',async()=>{
 const journal=await fixture(),args={journal,conversationId:'chat',inventory:scan(),sourceFingerprint:'chat-fp',expectedRoot:root};
 await reconcileFilesystemInventory(args);
 const before=(await journal.exportCaptureLedger('chat')).sequence;
 const result=await reconcileFilesystemInventory(args);
 assert.equal(result.status,'UNCHANGED_REVIEW_ONLY');
 assert.equal((await journal.exportCaptureLedger('chat')).sequence,before);
});
test('any unexplained add, edit, delete, replacement or restore delta fails closed',async()=>{
 const journal=await fixture(),args={journal,conversationId:'chat',inventory:scan(),sourceFingerprint:'chat-fp',expectedRoot:root};
 await reconcileFilesystemInventory(args);
 const changed=await reconcileFilesystemInventory({...args,inventory:scan('c'.repeat(64),'d'.repeat(64))});
 assert.equal(changed.status,'NON_READY');
 assert.match(changed.reason,/unexplained filesystem change/);
});
test('incomplete or wrong-root inventory cannot establish a baseline',async()=>{
 const journal=await fixture();
 const bad=await reconcileFilesystemInventory({journal,conversationId:'chat',inventory:{...scan(),status:'non_ready'},sourceFingerprint:'chat-fp',expectedRoot:root});
 assert.equal(bad.status,'NON_READY');
 const wrong=await reconcileFilesystemInventory({journal,conversationId:'chat',inventory:scan(),sourceFingerprint:'chat-fp',expectedRoot:'/other/root'});
 assert.equal(wrong.status,'NON_READY');
});
