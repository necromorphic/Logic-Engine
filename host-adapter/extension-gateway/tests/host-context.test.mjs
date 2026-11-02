import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveGatewayHostContext, dispatchThroughExtensionGateway } from '../host-context.mjs';
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
    getRequestHeaders:()=>({'Content-Type':'application/json','X-CSRF-Token':'csrf-token'}),
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
test('Gateway rejects uppercase generation_type before dispatch', async () => {
  await assert.rejects(
    dispatchThroughExtensionGateway({ requestId, contextSize: 8192, type: 'NORMAL' }, {
      fetchImpl: async () => { throw new Error('unexpected network call'); },
      getHostContext: hostContext(),
      storage: new MemoryStorage(),
      cryptoProvider: { randomUUID: () => conversationUuid },
    }),
    /HOST_DISPATCH_GENERATION_TYPE_INVALID/,
  );
});

test('Gateway dispatch sends only bounded identity metadata and uses ST CSRF headers',async()=>{
  const calls=[];
  const fetchImpl=async(url,options={})=>{
    calls.push({url,options});
    if(url.endsWith('/session')) return response(200,{host_session_id:sessionId,host_session_identity:'SIGNED_AUTHENTICATED_ST_SESSION'});
    if(url.endsWith('/identity')) return response(200,{host_session_id:sessionId,host_installation_id:installationId,authenticated_account_id:accountId,identity_source:'SERVER_PERSISTED_OPAQUE_IDENTITY'});
    return response(503,{status:'NON_READY',code:'CORE_HOST_DISPATCH_ROUTE_UNAVAILABLE'});
  };
  await assert.rejects(dispatchThroughExtensionGateway({requestId,contextSize:8192,type:'normal'},{fetchImpl,getHostContext:hostContext(),storage:new MemoryStorage(),cryptoProvider:{randomUUID:()=>conversationUuid}}),/HOST_GATEWAY_REQUEST_FAILED/);
  const dispatch=calls.at(-1);
  assert.equal(dispatch.url,'/api/plugins/logic-engine-extension-gateway/dispatch');
  assert.equal(dispatch.options.credentials,'same-origin');
  assert.equal(dispatch.options.headers['X-CSRF-Token'],'csrf-token');
  const body=JSON.parse(dispatch.options.body);
  assert.deepEqual(Object.keys(body).sort(),['context_size','conversation_uuid','generation_type','request_id']);
  assert.equal(body.conversation_uuid,conversationUuid);
});
