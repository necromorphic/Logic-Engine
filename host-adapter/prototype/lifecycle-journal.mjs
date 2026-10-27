const REQUIRED_COVERAGE = Object.freeze(['create-message','message-send','message-receive','create-swipe','select-swipe','delete-swipe','delete-message','delete-chat','delete-group-chat','delete-character-chat-recursive','edit-message','regenerate','generation-start','generation-end','generation-stop','cancel-generation','partial-generation','persistence-ordering','clear-chat','import','import-character-chat','import-group-chat','export','copy-branch','restore','backup-restore','create-branch','group-metadata-migration','chat-switch','external-edit','rollback','restart','replay']);
const canonical = x => Array.isArray(x) ? '[' + x.map(canonical).join(',') + ']' : x && typeof x === 'object' ? '{' + Object.keys(x).sort().map(k => JSON.stringify(k) + ':' + canonical(x[k])).join(',') + '}' : JSON.stringify(x);
const digest = async x => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(x))))].map(n => n.toString(16).padStart(2, '0')).join('');
const id = () => { if (!crypto.randomUUID) throw Error('crypto.randomUUID unavailable; NON_READY'); return crypto.randomUUID(); };

/** Opt-in IndexedDB journal. Never stores raw message text; caller must await before mutating ST state. */
export class HostLifecycleJournal {
  #db; #locks = new Map(); #bad = new Map();
  constructor(db) { if (!db) throw TypeError('IndexedDB database required'); this.#db = db; }
  static async open(name = 'logic-engine-host-lifecycle-v1') {
    if (!globalThis.indexedDB) throw Error('IndexedDB unavailable; NON_READY');
    const req = indexedDB.open(name, 2);
    req.onupgradeneeded = () => { const db = req.result; if (!db.objectStoreNames.contains('records')) { const s = db.createObjectStore('records', { keyPath: 'id' }); s.createIndex('conversationId', 'conversationId'); } if (!db.objectStoreNames.contains('heads')) db.createObjectStore('heads', { keyPath: 'conversationId' }); };
    const db = await new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); req.onblocked = () => reject(Error('IndexedDB upgrade blocked; NON_READY')); });
    return new HostLifecycleJournal(db);
  }
  async #records(cid) {
    const tx = this.#db.transaction(['records'], 'readonly'), done = txDone(tx);
    const req = tx.objectStore('records').index('conversationId').getAll(IDBKeyRange.only(cid));
    const rows = await new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
    await done; return rows.sort((a,b) => a.sequence-b.sequence);
  }
  async #head(cid) {
    const tx = this.#db.transaction(['heads'], 'readonly'), done = txDone(tx), req = tx.objectStore('heads').get(cid);
    const head = await new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result ?? null); req.onerror = () => reject(req.error); });
    await done; return head;
  }
  async #verifyStored(cid, rows) {
    const chain = await this.#verify(rows); if (!chain.ok) return chain;
    const head = await this.#head(cid), tail = rows.at(-1);
    if (!tail && head) return { ok: false, reason: 'records missing but head checkpoint exists' };
    if (tail && (!head || head.sequence !== tail.sequence || head.recordDigest !== tail.recordDigest)) return { ok: false, reason: 'head checkpoint mismatch' };
    return { ok: true };
  }
  async #put(row) {
    const tx = this.#db.transaction(['records','heads'], 'readwrite', { durability: 'strict' });
    tx.objectStore('records').add(row);
    tx.objectStore('heads').put({ conversationId: row.conversationId, sequence: row.sequence, recordDigest: row.recordDigest, sourceFingerprint: row.sourceFingerprint });
    await txDone(tx);
  }
  async enroll({ conversationId, sourceFingerprint, messages }) {
    if (!conversationId || !sourceFingerprint || !Array.isArray(messages)) throw TypeError('Invalid baseline');
    if ((await this.#records(conversationId)).length || await this.#head(conversationId)) throw Error('Already enrolled or checkpoint exists; explicit re-baseline is not supported');
    const mapping = [];
    for (let i=0;i<messages.length;i++) {
      const m=messages[i], versions=Array.isArray(m.versions)&&m.versions.length?m.versions:[m.text ?? ''];
      mapping.push({ messageId:id(), messageIndex:i, role:String(m.role ?? 'unknown'), activeVersionIndex:Number.isInteger(m.activeVersionIndex)?m.activeVersionIndex:0,
        versions: await Promise.all(versions.map(async (text,j)=>({versionId:id(), versionIndex:j, payloadDigest:await digest(String(text))}))) });
    }
    const row=await this.append({conversationId,eventId:id(),operation:'baseline',sourceFingerprint,payload:{captureBoundary:'enrollment-forward-only',messages:mapping}});
    if (row?.status === 'NON_READY') throw Error('NON_READY: baseline append rejected: ' + row.reason);
    return {mapping, baselineSequence:row.sequence, preEnrollmentHistory:'UNKNOWN_UNRECOVERABLE'};
  }
  async append({conversationId,eventId,operation,payload,sourceFingerprint=null}) {
    if (!conversationId||!eventId||!operation||!payload||typeof payload!=='object') throw TypeError('Invalid event');
    const prev=this.#locks.get(conversationId)||Promise.resolve(); let release; const hold=new Promise(r=>release=r), chain=prev.then(()=>hold); this.#locks.set(conversationId,chain); await prev;
    try {
      if(this.#bad.has(conversationId)) throw Error('NON_READY: '+this.#bad.get(conversationId));
      const rows=await this.#records(conversationId), check=await this.#verifyStored(conversationId, rows);
      if(!check.ok) return this.#fail(conversationId,check.reason);
      const eventDigest=await digest({conversationId,eventId,operation,payload,sourceFingerprint}), duplicate=rows.find(r=>r.eventId===eventId);
      if(duplicate) return duplicate.eventDigest===eventDigest?duplicate:this.#fail(conversationId,'event ID conflict: '+eventId);
      if(operation==='baseline'&&rows.length) return this.#fail(conversationId,'baseline already exists');
      if(operation!=='baseline'&&!rows.length) return this.#fail(conversationId,'event before baseline');
      const p=rows.at(-1), base={id:conversationId+':'+String((p?.sequence||0)+1).padStart(12,'0'),schemaVersion:2,conversationId,sequence:(p?.sequence||0)+1,eventId,operation,sourceFingerprint,payload,eventDigest,previousRecordDigest:p?.recordDigest??null};
      const row={...base,recordDigest:await digest(base)};
      try { await this.#put(row); } catch(e) { this.#bad.set(conversationId,'durable append failed: '+(e?.message||e)); throw Error('NON_READY: durable append failed; caller MUST abort mutation ('+(e?.message||e)+')'); }
      return row;
    } finally { release(); if(this.#locks.get(conversationId)===chain) this.#locks.delete(conversationId); }
  }
  async isEnrolled(cid) {
    const rows = await this.#records(cid);
    return rows.length > 0 && rows[0].operation === 'baseline';
  }
  async latestSourceFingerprint(cid) {
    const rows = await this.#records(cid);
    return rows.at(-1)?.sourceFingerprint ?? null;
  }
  async exportCaptureLedger(cid) {
    const integrity = await this.verifyIntegrity(cid);
    if (integrity.status !== 'INTEGRITY_OK') {
      throw Error('NON_READY: cannot export an unverified Host capture ledger: ' + integrity.reason);
    }
    const records = await this.#records(cid);
    return {
      status: 'REVIEW_ONLY',
      conversationId: cid,
      captureBoundary: 'enrollment-forward-only',
      preEnrollmentHistory: 'UNKNOWN_UNRECOVERABLE',
      sourceFingerprint: integrity.sourceFingerprint,
      sequence: integrity.sequence,
      records,
    };
  }
  async latestIdentitySnapshot(cid) {
    const rows = await this.#records(cid);
    for (let index = rows.length - 1; index >= 0; index--) {
      const row = rows[index];
      if (Array.isArray(row.payload?.changes)) {
        return row.payload.changes;
      }
      if (row.operation === 'baseline' && Array.isArray(row.payload?.messages)) {
        return row.payload.messages;
      }
    }
    return null;
  }
  async beforeMutation(args) {
    if(!Array.isArray(args.affectedVersions)) throw TypeError('affectedVersions must be an array');
    const result=await this.append({...args,operation:'before:'+args.operation,payload:{affectedVersions:args.affectedVersions,details:args.details??{}}});
    if(result?.status==='NON_READY') throw Error('NON_READY: '+result.reason+'; caller MUST abort mutation');
    return result;
  }
  async verifyIntegrity(cid) {
    if (this.#bad.has(cid)) return { status: 'NON_READY', reason: this.#bad.get(cid) };
    let rows;
    try {
      rows = await this.#records(cid);
    } catch (error) {
      return this.#fail(cid, 'journal unreadable: ' + (error?.message || error));
    }
    const check = await this.#verify(rows);
    if (!check.ok) return this.#fail(cid, check.reason);
    if (!rows.length || rows[0].operation !== 'baseline') {
      return { status: 'NON_READY', reason: 'missing baseline' };
    }
    return {
      status: 'INTEGRITY_OK',
      sequence: rows.at(-1).sequence,
      sourceFingerprint: rows.at(-1).sourceFingerprint ?? null,
    };
  }

  /**
   * Compares the live native source inventory with the latest locally journaled
   * fingerprint. A match proves local checkpoint consistency only: the journal
   * and head live in the same Host-controlled storage domain, so this cannot
   * establish authenticity or anti-rollback. The result therefore never grants
   * trust or production readiness.
   */
  async verifyCurrentSource(cid,{messages,sourceLocator=null}={}) {
    if(this.#bad.has(cid)) return {status:'NON_READY',journalIntegrity:'FAILED',reason:this.#bad.get(cid)};
    let rows;
    try { rows=await this.#records(cid); } catch(e) { return {status:'NON_READY',journalIntegrity:'FAILED',reason:'journal unreadable: '+(e?.message||e)}; }
    const check=await this.#verifyStored(cid,rows);
    if(!check.ok) return {status:'NON_READY',journalIntegrity:'FAILED',reason:check.reason};
    if(!rows.length||rows[0].operation!=='baseline') return {status:'NON_READY',journalIntegrity:'VERIFIED',reason:'missing baseline'};
    if(!Array.isArray(messages)) return {status:'NON_READY',journalIntegrity:'VERIFIED',reason:'live source inventory unavailable'};
    const expected=rows.at(-1).sourceFingerprint;
    if(typeof expected!=='string'||!expected) return {status:'NON_READY',journalIntegrity:'VERIFIED',reason:'latest journal record has no source fingerprint'};
    let actual;
    try { actual=await fingerprintSource(messages,sourceLocator); }
    catch(e) { return {status:'NON_READY',journalIntegrity:'VERIFIED',reason:'live source inventory cannot be fingerprinted: '+(e?.message||e)}; }
    if(actual!==expected) return {status:'NON_READY',journalIntegrity:'VERIFIED',reason:'live source inventory fingerprint mismatch',sequence:rows.at(-1).sequence};
    return {
      status:'LOCAL_MATCH_NON_AUTHORITATIVE',
      journalIntegrity:'VERIFIED',
      authority:'NON_AUTHORITATIVE',
      trustDecision:'NON_READY',
      sequence:rows.at(-1).sequence,
      sourceFingerprint:actual,
      blockers:[
        'NO_INDEPENDENT_TRUST_ANCHOR',
        'HOST_STORAGE_REWRITE_AND_ROLLBACK_NOT_EXCLUDED',
        'COMPLETE_NATIVE_LIFECYCLE_COVERAGE_UNPROVEN',
        'PRE_ENROLLMENT_HISTORY_UNKNOWN',
        'PINNED_SOURCE_ATTESTATION_NOT_VERIFIED',
      ],
    };
  }

  async status(cid,{instrumentedPaths=[]}={}) {
    if(this.#bad.has(cid)) return {status:'NON_READY',reason:this.#bad.get(cid)};
    let rows; try { rows=await this.#records(cid); } catch(e) { return this.#fail(cid,'journal unreadable: '+(e?.message||e)); }
    const check=await this.#verifyStored(cid,rows); if(!check.ok) return this.#fail(cid,check.reason);
    if(!rows.length||rows[0].operation!=='baseline') return {status:'NON_READY',reason:'missing baseline'};
    const missing=REQUIRED_COVERAGE.filter(p=>!instrumentedPaths.includes(p));
    if(missing.length) return {status:'NON_READY',reason:'incomplete mutation instrumentation',missingPaths:missing,baselineBoundary:'enrollment-forward-only'};
    return {status:'NON_READY',reason:'live source verification must run through the Host bridge; native hook coverage has no trusted pinned-source attestation',sequence:rows.at(-1).sequence,baselineBoundary:'enrollment-forward-only'};
  }
  async #verify(rows) {
    let previous=null;
    for(let i=0;i<rows.length;i++) { const r=rows[i]; if(r.schemaVersion!==2)return {ok:false,reason:'unsupported journal schema at '+(i+1)}; if(r.sequence!==i+1)return {ok:false,reason:'sequence gap at '+(i+1)}; if(r.previousRecordDigest!==previous)return {ok:false,reason:'chain mismatch at '+r.sequence}; const {recordDigest,...base}=r; if(await digest(base)!==recordDigest)return {ok:false,reason:'record digest mismatch at '+r.sequence}; if(await digest({conversationId:r.conversationId,eventId:r.eventId,operation:r.operation,payload:r.payload,sourceFingerprint:r.sourceFingerprint})!==r.eventDigest)return {ok:false,reason:'event digest mismatch at '+r.sequence}; previous=recordDigest; }
    return {ok:true};
  }
  #fail(cid,reason) { this.#bad.set(cid,reason); return {status:'NON_READY',reason}; }
}
function txDone(tx) { return new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error||Error('IndexedDB transaction failed'));tx.onabort=()=>reject(tx.error||Error('IndexedDB transaction aborted'));}); }
export async function contentDigest(text) { return digest(String(text)); }
export async function fingerprintSource(messages, sourceLocator = null) {
  if (!Array.isArray(messages)) throw TypeError('Malformed native message inventory');
  const projection = messages.map(message => {
    if (!message || typeof message !== 'object' || Array.isArray(message)) {
      throw TypeError('Malformed native message entry');
    }
    // Do not normalize malformed source metadata to "absent": that would make
    // invalid swipe/branch state fingerprint-identical to a valid empty state.
    if (message.swipes !== undefined && !Array.isArray(message.swipes)) {
      throw TypeError('Malformed native swipe inventory');
    }
    if (message.swipe_id !== undefined && !Number.isInteger(message.swipe_id)) {
      throw TypeError('Malformed native active-swipe index');
    }
    const versions = Array.isArray(message.swipes) && message.swipes.length ? message.swipes : [message.mes ?? ''];
    const activeVersionIndex = message.swipe_id ?? 0;
    if (activeVersionIndex < 0 || activeVersionIndex >= versions.length) {
      throw TypeError('Native active-swipe index is out of range');
    }
    const branchReferences = message.extra?.branches;
    if (branchReferences !== undefined && !Array.isArray(branchReferences)) {
      throw TypeError('Malformed native branch-reference inventory');
    }
    return {
      role: message.is_user ? 'user' : message.is_system ? 'system' : 'assistant',
      isUser: message.is_user === true,
      isSystem: message.is_system === true,
      systemType: message.extra?.type ?? null,
      // ST stores child branch names on the source message's extra.branches.
      // Fingerprint these observed references; this does not authenticate parent-child lineage.
      branchReferences: branchReferences ?? [],
      name: message.name ?? null,
      currentMessage: message.mes ?? '',
      versions,
      activeVersionIndex,
    };
  });
  return digest({ sourceLocator: sourceLocator ?? null, projection });
}
export const lifecycleJournalContract=Object.freeze({schemaVersion:2,requiredCoveragePaths:REQUIRED_COVERAGE});
