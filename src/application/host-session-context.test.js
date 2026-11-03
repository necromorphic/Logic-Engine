import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import {
  createAuthenticatedHostSessionContext,
  createHostSessionAssertionRunner,
  getAuthenticatedHostSessionContext,
  isAuthenticatedHostSessionContext,
  runWithAuthenticatedHostSession,
} from './host-session-context.js';

const installation='11111111-1111-4111-8111-111111111111';
const account='22222222-2222-4222-8222-222222222222';
const session='33333333-3333-4333-8333-333333333333';
const conversation='44444444-4444-4444-8444-444444444444';
const conversationId=session+':'+installation+':'+conversation;
const userHandle='default-user';
const worldId='world-main';
const actorId='actor-player';
const resolveBindings=()=>({world_id:worldId,actor_id:actorId});
const resolveIdentity=()=>({host_installation_id:installation,authenticated_account_id:account});

test('in-process Host capability binds session-scoped conversation with separately resolved installation/account',async()=>{
  const request={session:{logicEngineSessionId:session,logicEngineSessionHandle:userHandle},user:{profile:{handle:userHandle}}};
  const isAuthenticated=()=>true;
  const resolveConversation=()=>conversationId;
  const context=createAuthenticatedHostSessionContext(request,conversationId,isAuthenticated,resolveConversation,resolveBindings,resolveIdentity);
  assert.equal(context.host_installation_id,installation);
  assert.equal(context.authenticated_account_id,account);
  assert.equal(context.host_session_id,session);
  assert.equal(context.conversation_id,conversationId);
  assert.equal(context.world_id,worldId);
  assert.equal(context.actor_id,actorId);
  assert.equal(isAuthenticatedHostSessionContext(context,conversationId),true);
  await runWithAuthenticatedHostSession(request,conversationId,()=>{
    assert.equal(getAuthenticatedHostSessionContext().host_session_id,session);
  },isAuthenticated,resolveConversation,resolveBindings,resolveIdentity);
});

test('signed Host assertion accepts stable conversation tuple and rejects mismatched installation/account',()=>{
  const secret='adapter-secret-that-is-long-enough';
  const now=()=>1_800_000_000_000;
  const runner=createHostSessionAssertionRunner({secret,now});
  const assertion={
    protocol_version:1,
    host_installation_id:installation,
    authenticated_account_id:account,
    host_session_id:session,
    conversation_id:conversationId,
    world_id:worldId,
    actor_id:actorId,
    issued_at:1_800_000_000,
    nonce:'55555555-5555-4555-8555-555555555555',
  };
  const canonical=JSON.stringify([
    assertion.protocol_version,assertion.host_installation_id,assertion.authenticated_account_id,
    assertion.host_session_id,assertion.conversation_id,assertion.world_id,assertion.actor_id,assertion.issued_at,assertion.nonce,
  ]);
  const signature=createHmac('sha256',secret).update(canonical,'utf8').digest('hex');
  const result=runner.run(assertion,signature,()=>getAuthenticatedHostSessionContext());
  assert.equal(result.conversation_id,conversationId);
  assert.equal(result.host_session_id,session);
  assert.equal(result.world_id,worldId);
  assert.equal(result.actor_id,actorId);
  const wrong={...assertion,nonce:'66666666-6666-4666-8666-666666666666',conversation_id:session+':99999999-9999-4999-8999-999999999999:'+conversation};
  const wrongCanonical=JSON.stringify([
    wrong.protocol_version,wrong.host_installation_id,wrong.authenticated_account_id,
    wrong.host_session_id,wrong.conversation_id,wrong.world_id,wrong.actor_id,wrong.issued_at,wrong.nonce,
  ]);
  const wrongSignature=createHmac('sha256',secret).update(wrongCanonical,'utf8').digest('hex');
  assert.throws(()=>runner.run(wrong,wrongSignature,()=>{}),/HOST_SESSION_ASSERTION_INVALID/);
});

test('in-process Host capability fails closed when trusted World/Actor bindings are missing or ambiguous', () => {
  const request={session:{logicEngineSessionId:session,logicEngineSessionHandle:userHandle},user:{profile:{handle:userHandle}}};
  const isAuthenticated=()=>true;
  const resolveConversation=()=>conversationId;
  assert.equal(createAuthenticatedHostSessionContext(request,conversationId,isAuthenticated,resolveConversation),null);
  assert.equal(createAuthenticatedHostSessionContext(
    request,conversationId,isAuthenticated,resolveConversation,()=>({world_id:worldId,actor_id:''}),resolveIdentity,
  ),null);
  assert.equal(createAuthenticatedHostSessionContext(
    request,conversationId,isAuthenticated,resolveConversation,()=>({world_id:worldId,actor_id:actorId,extra:'caller-controlled'}),resolveIdentity,
  ),null);
  assert.equal(createAuthenticatedHostSessionContext(
    request,conversationId,isAuthenticated,resolveConversation,resolveBindings,()=>({
      host_installation_id:installation,authenticated_account_id:account,extra:'caller-controlled',
    }),
  ),null);
  let getterCalled=false;
  const accessorIdentity={host_installation_id:installation};
  Object.defineProperty(accessorIdentity,'authenticated_account_id',{
    enumerable:true,get(){getterCalled=true;throw new Error('must not execute');},
  });
  assert.equal(createAuthenticatedHostSessionContext(
    request,conversationId,isAuthenticated,resolveConversation,resolveBindings,()=>accessorIdentity,
  ),null);
  assert.equal(getterCalled,false);
  const proxyIdentity=new Proxy({host_installation_id:installation,authenticated_account_id:account},{});
  assert.equal(createAuthenticatedHostSessionContext(
    request,conversationId,isAuthenticated,resolveConversation,resolveBindings,()=>proxyIdentity,
  ),null);
});


test('signed Host assertion rejects an assertion outside the 30-second freshness window', () => {
  const secret='adapter-secret-that-is-long-enough';
  const nowSeconds=1_800_000_000;
  const runner=createHostSessionAssertionRunner({secret,now:()=>nowSeconds*1000});
  const assertion={
    protocol_version:1,host_installation_id:installation,authenticated_account_id:account,
    host_session_id:session,conversation_id:conversationId,world_id:worldId,actor_id:actorId,
    issued_at:nowSeconds-31,nonce:'88888888-8888-4888-8888-888888888888',
  };
  const canonical=JSON.stringify([
    assertion.protocol_version,assertion.host_installation_id,assertion.authenticated_account_id,
    assertion.host_session_id,assertion.conversation_id,assertion.world_id,assertion.actor_id,
    assertion.issued_at,assertion.nonce,
  ]);
  const signature=createHmac('sha256',secret).update(canonical,'utf8').digest('hex');
  assert.throws(()=>runner.run(assertion,signature,()=>{}),/HOST_SESSION_ASSERTION_EXPIRED/);
});

test('signed Host assertion requires World and Actor identity in the HMAC envelope', () => {
  const secret='adapter-secret-that-is-long-enough';
  const runner=createHostSessionAssertionRunner({secret,now:()=>1_800_000_000_000});
  const assertion={
    protocol_version:1,host_installation_id:installation,authenticated_account_id:account,
    host_session_id:session,conversation_id:conversationId,world_id:worldId,actor_id:actorId,
    issued_at:1_800_000_000,nonce:'77777777-7777-4777-8777-777777777777',
  };
  const canonical=JSON.stringify([
    assertion.protocol_version,assertion.host_installation_id,assertion.authenticated_account_id,
    assertion.host_session_id,assertion.conversation_id,assertion.world_id,assertion.actor_id,
    assertion.issued_at,assertion.nonce,
  ]);
  const signature=createHmac('sha256',secret).update(canonical,'utf8').digest('hex');
  assert.throws(()=>runner.run({...assertion,actor_id:undefined},signature,()=>{}),/HOST_SESSION_ASSERTION_INVALID/);
});


test('live Host capability is permanently invalidated by logout, account switch, or session rotation', async () => {
  const request = {
    session: { logicEngineSessionId: session, logicEngineSessionHandle: userHandle },
    user: { profile: { handle: userHandle } },
  };
  let authenticated = true;
  let accountId = account;
  const isAuthenticated = candidate => candidate === request && authenticated;
  const resolveConversation = candidate => candidate === request ? conversationId : null;
  const resolveLiveBindings = candidate => candidate === request ? { world_id: worldId, actor_id: actorId } : null;
  const resolveLiveIdentity = candidate => candidate === request
    ? { host_installation_id: installation, authenticated_account_id: accountId } : null;

  await runWithAuthenticatedHostSession(
    request, conversationId, async () => {
      assert.equal(getAuthenticatedHostSessionContext()?.authenticated_account_id, account);

      // Logout invalidates the in-flight capability and restoring the request
      // object cannot revive it within the same async operation.
      authenticated = false;
      assert.equal(getAuthenticatedHostSessionContext(), null);
      authenticated = true;
      assert.equal(getAuthenticatedHostSessionContext(), null);
    }, isAuthenticated, resolveConversation, resolveLiveBindings, resolveLiveIdentity,
  );

  await runWithAuthenticatedHostSession(
    request, conversationId, async () => {
      assert.equal(getAuthenticatedHostSessionContext()?.authenticated_account_id, account);
      request.user.profile.handle = 'other-account';
      request.session.logicEngineSessionHandle = 'other-account';
      accountId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
      assert.equal(getAuthenticatedHostSessionContext(), null);
    }, isAuthenticated, resolveConversation, resolveLiveBindings, resolveLiveIdentity,
  ).catch(error => {
    // The first capability was invalidated by the account switch; the runner
    // rejects only if identity is already inconsistent at entry.
    if (error.message !== 'HOST_SESSION_AUTHENTICATION_REQUIRED') throw error;
  });

  request.user.profile.handle = userHandle;
  request.session.logicEngineSessionHandle = userHandle;
  await runWithAuthenticatedHostSession(
    request, conversationId, async () => {
      assert.equal(getAuthenticatedHostSessionContext()?.host_session_id, session);
      request.session.logicEngineSessionId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
      assert.equal(getAuthenticatedHostSessionContext(), null);
    }, isAuthenticated, resolveConversation, resolveLiveBindings, resolveLiveIdentity,
  );
  assert.throws(
    () => runWithAuthenticatedHostSession(
      request, conversationId, async () => getAuthenticatedHostSessionContext(),
      isAuthenticated, resolveConversation, resolveLiveBindings, resolveLiveIdentity,
    ),
    /HOST_SESSION_AUTHENTICATION_REQUIRED/,
  );
});
