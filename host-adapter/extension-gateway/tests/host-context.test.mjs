import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveGatewayHostContext } from '../host-context.mjs';
const sessionId='11111111-1111-4111-8111-111111111111';
const installationId='22222222-2222-4222-8222-222222222222';
const accountId='33333333-3333-4333-8333-333333333333';
const conversationUuid='44444444-4444-4444-8444-444444444444';
const requestId='55555555-5555-4555-8555-555555555555';
class MemoryStorage {
  values=new Map();
  get length(){return this.values.size;}
  getItem(k){return this.values.has(k)?this.values.get(k):null;}
  setItem(k,v){this.values.set(k,String(v));}
  removeItem(k){this.values.delete(k);}
  key(i){return [...this.values.keys()][i]??null;}
}
function hostContext(){
  return {
    chatMetadata:{},
    getCurrentChatId:()=> 'character/chat.jsonl',
    saveMetadata:async()=>{},
  };
}
const response=(status,payload)=>({ok:status>=200&&status<300,status,json:async()=>payload});
test('Gateway resolves stable installation/account/conversation identity with session kept separate',async()=>{
  const calls=[];
  const fetchImpl=async(url,options={})=>{
    calls.push({url,options});
    if(url.endsWith('/session')) return response(200,{host_session_id:sessionId,host_session_identity:'SIGNED_AUTHENTICATED_ST_SESSION'});
    return response(200,{host_session_id:sessionId,host_installation_id:installationId,authenticated_account_id:accountId,identity_source:'SERVER_PERSISTED_OPAQUE_IDENTITY'});
  };
  const resolved=await resolveGatewayHostContext({fetchImpl,getHostContext:hostContext(),storage:new MemoryStorage(),cryptoProvider:{randomUUID:()=>conversationUuid}});
  assert.equal(resolved.conversationId,installationId+':'+accountId+':'+conversationUuid);
  assert.equal(resolved.hostSessionId,sessionId);
  assert.equal(resolved.hostInstallationId,installationId);
  assert.equal(resolved.authenticatedAccountId,accountId);
  assert.equal(calls.length,2);
});
