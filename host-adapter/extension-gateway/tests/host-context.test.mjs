import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveGatewayHostContext } from '../host-context.mjs';
import { ensureCoreConversationWorldBinding } from '../server-plugin/host-adapter.mjs';
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
  const sessionPayload = Object.freeze({
    host_session_id: sessionId,
    host_session_identity: 'SIGNED_AUTHENTICATED_ST_SESSION',
  });
  const identityPayload = Object.freeze({
    host_session_id: sessionId,
    host_installation_id: installationId,
    authenticated_account_id: accountId,
    identity_source: 'SERVER_PERSISTED_OPAQUE_IDENTITY',
  });
  const fetchImpl=async(url,options={})=>{
    calls.push({url,options});
    const pathname = new URL(String(url), 'http://localhost').pathname;
    if(pathname.endsWith('/session')) return response(200,sessionPayload);
    if(pathname.endsWith('/identity')) return response(200,identityPayload);
    throw new Error('UNEXPECTED_GATEWAY_TEST_PATH');
  };
  const resolved=await resolveGatewayHostContext({fetchImpl,getHostContext:hostContext(),storage:new MemoryStorage(),cryptoProvider:{randomUUID:()=>conversationUuid}});
  assert.equal(resolved.conversationId,installationId+':'+accountId+':'+conversationUuid);
  assert.equal(resolved.hostSessionId,sessionId);
  assert.equal(resolved.hostInstallationId,installationId);
  assert.equal(resolved.authenticatedAccountId,accountId);
  assert.equal(calls.length,2);
});

test('Gateway obtains a fresh ST context snapshot for each generation after chat switches', async () => {
  const storage = new MemoryStorage();
  const firstContext = {
    ...hostContext(),
    getCurrentChatId: () => 'character/first-chat.jsonl',
  };
  const firstMetadata = firstContext.chatMetadata;
  const secondContext = {
    ...hostContext(),
    getCurrentChatId: () => 'character/second-chat.jsonl',
  };
  const secondMetadata = secondContext.chatMetadata;
  let currentContext = firstContext;
  let providerCalls = 0;
  const getHostContext = () => {
    providerCalls++;
    return currentContext;
  };
  const fetchImpl = async url => {
    const pathname = new URL(String(url), 'http://localhost').pathname;
    if (pathname.endsWith('/session')) return response(200, {
      host_session_id: sessionId,
      host_session_identity: 'SIGNED_AUTHENTICATED_ST_SESSION',
    });
    if (pathname.endsWith('/identity')) return response(200, {
      host_session_id: sessionId,
      host_installation_id: installationId,
      authenticated_account_id: accountId,
      identity_source: 'SERVER_PERSISTED_OPAQUE_IDENTITY',
    });
    throw new Error('UNEXPECTED_GATEWAY_TEST_PATH');
  };
  let generated = 0;
  const cryptoProvider = {
    randomUUID: () => generated++ === 0 ? conversationUuid : '55555555-5555-4555-8555-555555555556',
  };

  const first = await resolveGatewayHostContext({ fetchImpl, getHostContext, storage, cryptoProvider });
  currentContext = secondContext;
  const second = await resolveGatewayHostContext({ fetchImpl, getHostContext, storage, cryptoProvider });

  assert.equal(providerCalls, 2);
  assert.equal(firstMetadata.logic_engine_conversation_id, conversationUuid);
  assert.equal(secondMetadata.logic_engine_conversation_id, '55555555-5555-4555-8555-555555555556');
  assert.notEqual(first.conversationId, second.conversationId);
});

test('Host persists the server-derived Core conversation binding before the read-only Gateway runs', async () => {
  let captured;
  const result = await ensureCoreConversationWorldBinding({
    env: {
      LOGIC_ENGINE_CORE_URL: 'http://127.0.0.1:52087',
      LOGIC_ENGINE_API_TOKEN: 'a'.repeat(32),
      LOGIC_ENGINE_ADAPTER_ID: 'sillytavern-main',
      LOGIC_ENGINE_ADAPTER_TOKEN: 'b'.repeat(32),
    },
    fetchImpl: async (url, options) => {
      captured = { url, options, body: JSON.parse(options.body) };
      return response(200, { context: {
        adapter_id: 'sillytavern-main',
        conversation_id: sessionId + ':' + installationId + ':' + conversationUuid,
        world_id: 'world-default',
        actor_id: 'actor-main',
        actor_type: 'character',
      } });
    },
    context: {
      host_session_id: sessionId,
      host_installation_id: installationId,
      authenticated_account_id: accountId,
      conversation_uuid: conversationUuid,
    },
  });
  assert.deepEqual(result, { status: 'READY' });
  assert.equal(captured.url.pathname, '/v1/host-context/resolve');
  assert.equal(captured.options.headers['x-adapter-id'], 'sillytavern-main');
  assert.deepEqual(captured.body, {
    conversation_id: sessionId + ':' + installationId + ':' + conversationUuid,
    host_session_id: sessionId,
    host_installation_id: installationId,
    conversation_uuid: conversationUuid,
  });
});

test('Host does not dispatch when Core cannot create or resolve a deployment-owned World binding', async () => {
  const result = await ensureCoreConversationWorldBinding({
    env: {
      LOGIC_ENGINE_CORE_URL: 'http://127.0.0.1:52087',
      LOGIC_ENGINE_API_TOKEN: 'a'.repeat(32),
      LOGIC_ENGINE_ADAPTER_ID: 'sillytavern-main',
      LOGIC_ENGINE_ADAPTER_TOKEN: 'b'.repeat(32),
    },
    fetchImpl: async () => response(403, {
      error: { code: 'HOST_DEFAULT_WORLD_NOT_CONFIGURED' },
    }),
    context: {
      host_session_id: sessionId,
      host_installation_id: installationId,
      authenticated_account_id: accountId,
      conversation_uuid: conversationUuid,
    },
  });
  assert.deepEqual(result, { status: 'NON_READY', code: 'HOST_DEFAULT_WORLD_NOT_CONFIGURED' });
});
