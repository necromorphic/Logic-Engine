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
const conversationId=installation+':'+account+':'+conversation;
const userHandle='default-user';

test('in-process Host capability binds stable installation/account/conversation and keeps session separate',async()=>{
  const request={session:{logicEngineSessionId:session,logicEngineSessionHandle:userHandle},user:{profile:{handle:userHandle}}};
  const isAuthenticated=()=>true;
  const resolveConversation=()=>conversationId;
  const context=createAuthenticatedHostSessionContext(request,conversationId,isAuthenticated,resolveConversation);
  assert.equal(context.host_installation_id,installation);
  assert.equal(context.authenticated_account_id,account);
  assert.equal(context.host_session_id,session);
  assert.equal(context.conversation_id,conversationId);
  assert.equal(isAuthenticatedHostSessionContext(context,conversationId),true);
  await runWithAuthenticatedHostSession(request,conversationId,()=>{
    assert.equal(getAuthenticatedHostSessionContext().host_session_id,session);
  },isAuthenticated,resolveConversation);
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
    issued_at:1_800_000_000,
    nonce:'55555555-5555-4555-8555-555555555555',
  };
  const canonical=JSON.stringify([
    assertion.protocol_version,assertion.host_installation_id,assertion.authenticated_account_id,
    assertion.host_session_id,assertion.conversation_id,assertion.issued_at,assertion.nonce,
  ]);
  const signature=createHmac('sha256',secret).update(canonical,'utf8').digest('hex');
  const result=runner.run(assertion,signature,()=>getAuthenticatedHostSessionContext());
  assert.equal(result.conversation_id,conversationId);
  assert.equal(result.host_session_id,session);
  const wrong={...assertion,nonce:'66666666-6666-4666-8666-666666666666',conversation_id:session+':'+installation+':'+conversation};
  const wrongCanonical=JSON.stringify([
    wrong.protocol_version,wrong.host_installation_id,wrong.authenticated_account_id,
    wrong.host_session_id,wrong.conversation_id,wrong.issued_at,wrong.nonce,
  ]);
  const wrongSignature=createHmac('sha256',secret).update(wrongCanonical,'utf8').digest('hex');
  assert.throws(()=>runner.run(wrong,wrongSignature,()=>{}),/HOST_SESSION_ASSERTION_INVALID/);
});
