import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SQLiteSourceVersionLedger } from '../src/application/source-version-ledger.js';

const sha = s => createHash('sha256').update(s).digest('hex');
const canonical = value => Array.isArray(value) ? '['+value.map(canonical).join(',')+']' : value && typeof value==='object' ? '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}' : JSON.stringify(value);
const inventorySha = versions => sha(canonical([...versions].map(v=>({message_id:v.message_id,version_id:v.version_id,payload_sha256:v.payload_sha256,parent_version_id:v.parent_version_id??null,active:v.active===true})).sort((a,b)=>a.message_id.localeCompare(b.message_id)||a.version_id.localeCompare(b.version_id))));
const base = { world_id:'world-a', conversation_id:'chat-a', host_installation_id:'host-a', branch_id:'branch-a' };
const version = (message_id, version_id, text, parent_version_id = null) => ({message_id,version_id,payload_sha256:sha(text),parent_version_id});
const snapshot = (sequence, versions, extra = {}) => ({...base,snapshot_id:'snapshot-'+sequence,snapshot_sequence:sequence,complete:true,inventory_sha256:inventorySha(versions),versions,...extra});
const make = path => new SQLiteSourceVersionLedger({path,validateSnapshot:s=>s.complete===true&&s.world_id==='world-a'&&s.host_installation_id==='host-a'&&s.branch_id==='branch-a',validateVersion:v=>v.world_id==='world-a'&&v.conversation_id==='chat-a'&&v.host_installation_id==='host-a'&&v.branch_id==='branch-a'});

test('digest-only storage and duplicate idempotency',()=>{const db=make(':memory:'),v={...base,...version('m1','v1','private text'),snapshot_sequence:1};assert.equal(db.recordVersion(v).status,'recorded');assert.equal(db.recordVersion(v).status,'duplicate');assert.equal(JSON.stringify(db.getVersion(v)).includes('private text'),false);db.close();});
test('same identity with different digest fails closed',()=>{const db=make(':memory:');db.recordVersion({...base,...version('m1','v1','first'),snapshot_sequence:1});assert.deepEqual(db.recordVersion({...base,...version('m1','v1','different'),snapshot_sequence:2}),{status:'NON_READY',reason:'SOURCE_VERSION_ID_CONFLICT'});db.close();});
test('swipe selection changes pointer, not version retention',()=>{const db=make(':memory:'),a={...base,...version('m1','v1','one'),snapshot_sequence:1},b={...base,...version('m1','v2','two','v1'),snapshot_sequence:2};db.recordVersion(a);db.recordVersion(b);db.selectActiveVersion(a);db.selectActiveVersion(b);assert.equal(db.getVersion(a).lifecycle,'present');assert.equal(db.getVersion(a).active,0);assert.equal(db.getVersion(b).active,1);db.close();});
test('tombstone is version-specific and cannot be resurrected',()=>{const db=make(':memory:'),a=version('m1','v1','one');db.recordVersion({...base,...a,snapshot_sequence:1});assert.equal(db.tombstoneVersion({...base,...a}).status,'tombstoned');assert.equal(db.reconcileSnapshot(snapshot(2,[a])).reason,'TOMBSTONE_REAPPEARED');db.close();});
test('full snapshot recovers missed event and survives restart',()=>{const dir=mkdtempSync(join(tmpdir(),'source-ledger-')),path=join(dir,'provider.sqlite');try{let db=make(path),a=version('m1','v1','one');assert.equal(db.reconcileSnapshot(snapshot(1,[a])).status,'READY');db.close();db=make(path);assert.equal(db.getHead(base).snapshot_sequence,1);const b=version('m2','v1','two');assert.equal(db.reconcileSnapshot(snapshot(2,[a,b])).status,'READY');assert.equal(db.getVersion({...base,...b}).payload_sha256,sha('two'));db.close();}finally{rmSync(dir,{recursive:true,force:true});}});
test('partial, stale and alternate-branch snapshots fail closed',()=>{const db=make(':memory:'),a=version('m1','v1','one');assert.equal(db.reconcileSnapshot(snapshot(1,[a],{complete:false})).reason,'INCOMPLETE_OR_INVALID_SNAPSHOT');assert.equal(db.reconcileSnapshot(snapshot(1,[a])).status,'READY');assert.equal(db.reconcileSnapshot(snapshot(1,[a])).reason,'STALE_OR_DIFFERENT_BRANCH');assert.equal(db.reconcileSnapshot(snapshot(2,[a],{branch_id:'restored'})).reason,'STALE_OR_DIFFERENT_BRANCH');db.close();});
test('untrusted snapshot is rejected',()=>{const db=new SQLiteSourceVersionLedger({path:':memory:',validateSnapshot:()=>false,validateVersion:()=>false});assert.equal(db.reconcileSnapshot(snapshot(1,[])).reason,'SNAPSHOT_NOT_AUTHORIZED');db.close();});
