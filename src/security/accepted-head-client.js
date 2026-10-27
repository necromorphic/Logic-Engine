import { readFileSync } from 'node:fs';

function fail() {
  process.stderr.write('accepted-head IPC failed\n');
  process.exitCode = 1;
}

async function main() {
  let input;
  try {
    const raw = readFileSync(0, 'utf8');
    if (!raw || Buffer.byteLength(raw, 'utf8') > 4096) throw new Error('invalid');
    input = JSON.parse(raw);
  } catch {
    fail();
    return;
  }

  const port = input?.port;
  const timeoutMs = input?.timeout_ms;
  if (!Number.isInteger(port) || port < 1 || port > 65535
    || !Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 10000) {
    fail();
    return;
  }

  const action = input?.action;
  let url;
  let options;
  if (action === 'heads') {
    url = 'http://127.0.0.1:' + port + '/v1/heads';
    options = { method: 'GET', signal: AbortSignal.timeout(timeoutMs) };
  } else if ((action === 'enroll' || action === 'advance' || action === 'finalize')
    && ['core', 'provider'].includes(input.domain)
    && typeof input.operation_id === 'string' && input.operation_id.length > 0
    && typeof input.operation_digest === 'string' && /^[a-f0-9]{64}$/.test(input.operation_digest)
    && typeof input.token === 'string' && input.token.length >= 32
    && (action === 'finalize' || (Number.isSafeInteger(input.expected_head) && input.expected_head >= 0))) {
    url = 'http://127.0.0.1:' + port + (action === 'enroll' ? '/v1/enroll' : action === 'advance' ? '/v1/advance' : '/v1/finalize');
    options = {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + input.token,
        'content-type': 'application/json',
        'cache-control': 'no-store',
      },
      body: JSON.stringify({
        domain: input.domain,
        operation_id: input.operation_id,
        operation_digest: input.operation_digest,
        ...(action === 'finalize' ? {} : { expected_head: input.expected_head }),
      }),
      signal: AbortSignal.timeout(timeoutMs),
    };
  } else {
    fail();
    return;
  }

  try {
    const response = await fetch(url, options);
    if (!response.ok) throw new Error('authority rejected request');
    const body = await response.json();
    if (action === 'heads') {
      if (!Number.isSafeInteger(body?.heads?.core) || body.heads.core < 0
        || !Number.isSafeInteger(body?.heads?.provider) || body.heads.provider < 0
        || typeof body?.pending?.core !== 'boolean' || typeof body?.pending?.provider !== 'boolean'
        || typeof body?.enrolled?.core !== 'boolean' || typeof body?.enrolled?.provider !== 'boolean') {
        throw new Error('invalid response');
      }
      process.stdout.write(JSON.stringify({ ok: true, heads: body.heads, pending: body.pending, enrolled: body.enrolled }));
    } else {
      const result = body?.result;
      const expectedStatuses = action === 'finalize' ? ['committed'] : ['pending', 'committed'];
      if (result?.domain !== input.domain || result?.operation_id !== input.operation_id
        || result?.operation_digest !== input.operation_digest
        || !Number.isSafeInteger(result?.head) || result.head < 1 || !expectedStatuses.includes(result.status)) {
        throw new Error('invalid response');
      }
      process.stdout.write(JSON.stringify({ ok: true, result }));
    }
  } catch {
    fail();
  }
}

await main();
