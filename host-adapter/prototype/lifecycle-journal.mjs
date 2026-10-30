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
  async #put(row, { requireNoPendingMutation = false, requirePendingMutationOperation = null } = {}) {
    const tx = this.#db.transaction(['records','heads'], 'readwrite', { durability: 'strict' });
    const done = txDone(tx);
    const records = tx.objectStore('records');
    const heads = tx.objectStore('heads');
    let rowsReady = false;
    let headReady = false;
    let currentRows = [];
    let currentHead;
    let validationFailure = null;
    let expectedFailure = false;

    const abortWith = (reason, expected = false) => {
      if (validationFailure) return;
      validationFailure = reason;
      expectedFailure = expected;
      try { tx.abort(); } catch {}
    };
    const commitIfReady = () => {
      if (!rowsReady || !headReady || validationFailure) return;
      currentRows.sort((a, b) => a.sequence - b.sequence);
      const tail = currentRows.at(-1) ?? null;
      if (currentRows.length !== row.sequence - 1
        || (tail?.recordDigest ?? null) !== row.previousRecordDigest) {
        abortWith('journal changed during append; retry from the verified head', true);
        return;
      }
      if (tail
        ? (!currentHead || currentHead.sequence !== tail.sequence || currentHead.recordDigest !== tail.recordDigest)
        : Boolean(currentHead)) {
        abortWith('journal head checkpoint changed during append', true);
        return;
      }
      const lifecycleRows = currentRows.filter(record =>
        typeof record.operation === 'string'
        && (record.operation.startsWith('before:') || record.operation.startsWith('after:')));
      const latestLifecycle = lifecycleRows.at(-1);
      if (requireNoPendingMutation && latestLifecycle?.operation.startsWith('before:')) {
        abortWith('cannot append checkpoint while Host lifecycle mutation is pending: '
          + latestLifecycle.operation.slice('before:'.length), true);
        return;
      }
      if (requirePendingMutationOperation !== null
        && latestLifecycle?.operation !== 'before:' + requirePendingMutationOperation) {
        abortWith('after receipt has no matching durable beforeMutation for '
          + requirePendingMutationOperation, true);
        return;
      }
      try {
        records.add(row);
        heads.put({
          conversationId: row.conversationId,
          sequence: row.sequence,
          recordDigest: row.recordDigest,
          sourceFingerprint: row.sourceFingerprint,
        });
      } catch (error) {
        abortWith(error?.message || 'journal append transaction failed');
      }
    };

    const rowsRequest = records.index('conversationId').getAll(IDBKeyRange.only(row.conversationId));
    rowsRequest.onsuccess = () => {
      currentRows = rowsRequest.result ?? [];
      rowsReady = true;
      commitIfReady();
    };
    rowsRequest.onerror = () => abortWith('journal records could not be read in append transaction');

    const headRequest = heads.get(row.conversationId);
    headRequest.onsuccess = () => {
      currentHead = headRequest.result;
      headReady = true;
      commitIfReady();
    };
    headRequest.onerror = () => abortWith('journal head could not be read in append transaction');

    try {
      await done;
    } catch (error) {
      if (validationFailure && expectedFailure) return { status: 'NON_READY', reason: validationFailure };
      if (validationFailure) throw Error(validationFailure);
      throw error;
    }
    return null;
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
  async append({conversationId,eventId,operation,payload,sourceFingerprint=null,requireNoPendingMutation=false}) {
    if (!conversationId || !eventId || typeof operation !== 'string' || !operation || !payload || typeof payload !== 'object') throw TypeError('Invalid event');
    const prev=this.#locks.get(conversationId)||Promise.resolve(); let release; const hold=new Promise(r=>release=r), chain=prev.then(()=>hold); this.#locks.set(conversationId,chain); await prev;
    try {
      if(this.#bad.has(conversationId)) throw Error('NON_READY: '+this.#bad.get(conversationId));
      const rows=await this.#records(conversationId), check=await this.#verifyStored(conversationId, rows);
      if(!check.ok) return this.#fail(conversationId,check.reason);
      if (typeof requireNoPendingMutation !== 'boolean') throw TypeError('requireNoPendingMutation must be a boolean');
      const eventDigest=await digest({conversationId,eventId,operation,payload,sourceFingerprint}), duplicate=rows.find(r=>r.eventId===eventId);
      if(duplicate) return duplicate.eventDigest===eventDigest?duplicate:this.#fail(conversationId,'event ID conflict: '+eventId);
      const lifecycleRows = rows.filter(row =>
        typeof row.operation === 'string'
        && (row.operation.startsWith('before:') || row.operation.startsWith('after:')));
      const latestLifecycle = lifecycleRows.at(-1);
      if ((requireNoPendingMutation || operation.startsWith('before:'))
        && latestLifecycle?.operation.startsWith('before:')) {
        return { status: 'NON_READY', reason: 'cannot append checkpoint while Host lifecycle mutation is pending: '
          + latestLifecycle.operation.slice('before:'.length) };
      }
      if (operation.startsWith('after:')
        && latestLifecycle?.operation !== 'before:' + operation.slice('after:'.length)) {
        return { status: 'NON_READY', reason: 'after receipt has no matching durable beforeMutation for '
          + operation.slice('after:'.length) };
      }
      if(operation==='baseline'&&rows.length) return this.#fail(conversationId,'baseline already exists');
      if(operation!=='baseline'&&!rows.length) return this.#fail(conversationId,'event before baseline');
      const p=rows.at(-1), base={id:conversationId+':'+String((p?.sequence||0)+1).padStart(12,'0'),schemaVersion:2,conversationId,sequence:(p?.sequence||0)+1,eventId,operation,sourceFingerprint,payload,eventDigest,previousRecordDigest:p?.recordDigest??null};
      const row={...base,recordDigest:await digest(base)};
      const requiredPendingOperation = operation.startsWith('after:') ? operation.slice('after:'.length) : null;
      let putResult;
      try {
        putResult = await this.#put(row, {
          requireNoPendingMutation: requireNoPendingMutation || operation.startsWith('before:'),
          requirePendingMutationOperation: requiredPendingOperation,
        });
      } catch (error) {
        this.#bad.set(conversationId, 'durable append failed: ' + (error?.message || error));
        throw Error('NON_READY: durable append failed; caller MUST abort mutation ('
          + (error?.message || error) + ')');
      }
      if (putResult?.status === 'NON_READY') return putResult;
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
  async pendingMutation(conversationId) {
    if (this.#bad.has(conversationId)) {
      return { status: 'NON_READY', reason: this.#bad.get(conversationId) };
    }
    let rows;
    try {
      rows = await this.#records(conversationId);
    } catch (error) {
      return this.#fail(conversationId, 'journal unreadable: ' + (error?.message || error));
    }
    const check = await this.#verifyStored(conversationId, rows);
    if (!check.ok) return this.#fail(conversationId, check.reason);
    if (!rows.length || rows[0].operation !== 'baseline') {
      return { status: 'NON_READY', reason: 'missing baseline' };
    }
    const lifecycleRows = rows.filter(row =>
      typeof row.operation === 'string'
      && (row.operation.startsWith('before:') || row.operation.startsWith('after:')));
    const latest = lifecycleRows.at(-1);
    if (!latest || !latest.operation.startsWith('before:')) {
      return { status: 'NO_PENDING_MUTATION' };
    }
    return {
      status: 'PENDING_MUTATION',
      operation: latest.operation.slice('before:'.length),
      eventId: latest.eventId,
      sequence: latest.sequence,
    };
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

  async status(cid,{instrumentedPaths=[],sourceFingerprintMatches=false}={}) {
    if(this.#bad.has(cid)) return {status:'NON_READY',reason:this.#bad.get(cid)};
    let rows; try { rows=await this.#records(cid); } catch(e) { return this.#fail(cid,'journal unreadable: '+(e?.message||e)); }
    const check=await this.#verifyStored(cid,rows); if(!check.ok) return this.#fail(cid,check.reason);
    if(!rows.length||rows[0].operation!=='baseline') return {status:'NON_READY',reason:'missing baseline'};
    const missing=REQUIRED_COVERAGE.filter(p=>!instrumentedPaths.includes(p));
    if(missing.length) return {status:'NON_READY',reason:'incomplete mutation instrumentation',missingPaths:missing,baselineBoundary:'enrollment-forward-only'};
    if(!sourceFingerprintMatches) return {status:'NON_READY',reason:'source fingerprint mismatch or unverified'};
    return {status:'NON_READY',reason:'native hook coverage has no trusted pinned-source attestation',sequence:rows.at(-1).sequence,baselineBoundary:'enrollment-forward-only'};
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
  const projection = messages.map(message => ({
    role: message.is_user ? 'user' : message.is_system ? 'system' : 'assistant',
    isUser: message.is_user === true,
    isSystem: message.is_system === true,
    systemType: message.extra?.type ?? null,
    name: message.name ?? null,
    currentMessage: message.mes ?? '',
    versions: Array.isArray(message.swipes) && message.swipes.length ? message.swipes : [message.mes ?? ''],
    activeVersionIndex: Number.isInteger(message.swipe_id) ? message.swipe_id : 0,
  }));
  return digest({ sourceLocator: sourceLocator ?? null, projection });
}
export const lifecycleJournalContract=Object.freeze({schemaVersion:2,requiredCoveragePaths:REQUIRED_COVERAGE});
