import { EngineError } from './errors.js';
const OPS = new Set(['eq','neq','exists','gt','gte','lt','lte','in','all','any','not']);
function readPath(root,path) {
  if(typeof path!=='string'||!path||path.split('.').some(k=>!k||['__proto__','constructor','prototype'].includes(k))) throw new EngineError('INVALID_RULE_PATH','Unsafe or empty rule path.');
  let value=root;
  for(const key of path.split('.')) { if(value===null||typeof value!=='object'||!Object.hasOwn(value,key)) return {exists:false}; value=value[key]; }
  return {exists:true,value};
}
export function evaluateCondition(rule,context,depth=0) {
  if(depth>24) throw new EngineError('RULE_DEPTH_EXCEEDED','Rule nesting exceeds 24 levels.');
  if(!rule||typeof rule!=='object'||Array.isArray(rule)) throw new EngineError('INVALID_RULE','Condition must be an object.');
  const op=rule.op; if(!OPS.has(op)) throw new EngineError('UNSUPPORTED_RULE_OPERATOR','Unsupported operator: '+String(op));
  if(op==='all'||op==='any') { if(!Array.isArray(rule.conditions)||rule.conditions.length>100) throw new EngineError('INVALID_RULE',op+' requires at most 100 conditions.'); const a=rule.conditions.map(x=>evaluateCondition(x,context,depth+1)); return op==='all'?a.every(Boolean):a.some(Boolean); }
  if(op==='not') return !evaluateCondition(rule.condition,context,depth+1);
  const found=readPath(context,rule.path); if(op==='exists') return found.exists===Boolean(rule.value??true); if(!found.exists) return false;
  if(op==='eq') return JSON.stringify(found.value)===JSON.stringify(rule.value);
  if(op==='neq') return JSON.stringify(found.value)!==JSON.stringify(rule.value);
  if(['gt','gte','lt','lte'].includes(op)) { if(typeof found.value!=='number'||typeof rule.value!=='number'||!Number.isFinite(found.value)||!Number.isFinite(rule.value)) throw new EngineError('RULE_TYPE_MISMATCH',op+' requires finite numbers.'); return op==='gt'?found.value>rule.value:op==='gte'?found.value>=rule.value:op==='lt'?found.value<rule.value:found.value<=rule.value; }
  if(op==='in') { if(!Array.isArray(rule.values)) throw new EngineError('INVALID_RULE','in requires values.'); return rule.values.some(x=>JSON.stringify(x)===JSON.stringify(found.value)); }
  throw new EngineError('UNSUPPORTED_RULE_OPERATOR','Unsupported operator: '+op);
}
export function validateEffects(effects) {
  if(!Array.isArray(effects)||effects.length>200) throw new EngineError('INVALID_EFFECTS','effects must contain at most 200 entries.');
  for(const e of effects) {
    if(!e||typeof e!=='object'||Array.isArray(e)) throw new EngineError('INVALID_EFFECT','Each effect must be an object.');
    if(e.kind==='entity.upsert') { if(typeof e.entity_id!=='string'||!e.entity_id.trim()||e.entity_id.length>200||typeof e.entity_type!=='string'||!e.entity_type.trim()) throw new EngineError('INVALID_EFFECT','entity.upsert requires entity_id and entity_type.'); if(e.status!==undefined&&!['active','inactive','destroyed','unknown'].includes(e.status)) throw new EngineError('INVALID_EFFECT','Unsupported entity status.'); if(e.attributes!==undefined&&(!e.attributes||typeof e.attributes!=='object'||Array.isArray(e.attributes))) throw new EngineError('INVALID_EFFECT','attributes must be an object.'); }
    else if(e.kind==='entity.delete') { if(typeof e.entity_id!=='string'||!e.entity_id.trim()) throw new EngineError('INVALID_EFFECT','entity.delete requires entity_id.'); }
    else if(e.kind==='fact.set') { if(typeof e.fact_id!=='string'||!e.fact_id.trim()||typeof e.predicate!=='string'||!e.predicate.trim()||!Object.hasOwn(e,'value')) throw new EngineError('INVALID_EFFECT','fact.set requires fact_id, predicate and value.'); if(e.subject_ref!==undefined&&e.subject_ref!==null&&typeof e.subject_ref!=='string') throw new EngineError('INVALID_EFFECT','subject_ref must be a string or null.'); }
    else throw new EngineError('UNSUPPORTED_EFFECT','Unsupported effect kind: '+String(e.kind));
  }
}