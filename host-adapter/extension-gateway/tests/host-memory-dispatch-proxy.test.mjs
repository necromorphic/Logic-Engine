import test from 'node:test';
import assert from 'node:assert/strict';
import { createHostMemoryDispatchProxyHandler } from '../../prototype/st-server-digest-proxy.mjs';
const installation='11111111-1111-4111-8111-111111111111';
const account='22222222-2222-4222-8222-222222222222';
const session='33333333-3333-4333-8333-333333333333';
const conversation='44444444-4444-4444-8444-444444444444';
const requestId='55555555-5555-4555-8555-555555555555';
const conversationId=installation+':'+account+':'+conversation;
const env={LOGIC_ENGINE_CORE_URL:'http://127.0.0.1:8787',LOGIC_ENGINE_API_TOKEN:'core-api-token-long-enough',LOGIC_ENGINE_ADAPTER_ID:'st-gateway',LOGIC_ENGINE_ADAPTER_TOKEN:'adapter-token-long-enough'};
function recorder(){return{statusCode:null,payload:null,set(){return this;},status(c){this.statusCode=c;return this;},json(p){this.payload=p;return this;},sendStatus(c){this.statusCode=c;return this;}};}
test('Gateway signs server-resolved installation/account/session/conversation tuple for Core only',async()=>{
  let outbound;
  const handler=createHostMemoryDispatchProxyHandler({env,resolveHostContext:()=>({host_installation_id:installation,authenticated_account_id:account,host_session_id:session,conversation_id:conversationId}),fetchImpl:async(url,options)=>{outbound={url:String(url),options};return{ok:false,status:404,json:async()=>({error:{code:'NOT_FOUND'}})};}});
  const response=recorder();
  await handler({body:{request_id:requestId,conversation_uuid:conversation,context_size:8192,generation_type:'normal'}},response);
  assert.equal(response.statusCode,503);
  assert.equal(response.payload.code,'CORE_HOST_DISPATCH_ROUTE_UNAVAILABLE');
  assert.match(outbound.url,/\/v1\/host\/memory-npc\/retrieve$/);
  const body=JSON.parse(outbound.options.body);
  assert.deepEqual(Object.keys(body).sort(),['assertion','context_size','generation_type','request_id','signature']);
  assert.equal(body.assertion.host_installation_id,installation);
  assert.equal(body.assertion.authenticated_account_id,account);
  assert.equal(body.assertion.host_session_id,session);
  assert.equal(body.assertion.conversation_id,conversationId);
  assert.equal('world_id' in body,false);
  assert.equal('actor_id' in body,false);
  assert.equal('chat' in body,false);
});
