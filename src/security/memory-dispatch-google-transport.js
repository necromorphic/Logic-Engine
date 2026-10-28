export function createGoogleAiStudioTransport({
  apiKey,
  apiVersion = 'v1beta',
  fetchImpl = globalThis.fetch,
}) {
  if (typeof apiKey !== 'string' || apiKey.length < 8
    || !['v1', 'v1beta'].includes(apiVersion)
    || typeof fetchImpl !== 'function') {
    throw new TypeError('Invalid Google AI Studio transport configuration.');
  }

  return async ({ route, model, stream, body, signal, forwardResponse }) => {
    if (route !== 'google-ai-studio-chat-completions'
      || typeof model !== 'string' || !/^[A-Za-z0-9._-]{1,128}$/.test(model)
      || typeof stream !== 'boolean' || typeof body !== 'string'
      || typeof forwardResponse !== 'function') {
      throw new Error('MEMORY_DISPATCH_NOT_READY');
    }

    const action = stream ? 'streamGenerateContent' : 'generateContent';
    const url = new URL(
      'https://generativelanguage.googleapis.com/'
      + apiVersion + '/models/' + encodeURIComponent(model) + ':' + action,
    );
    if (stream) url.searchParams.set('alt', 'sse');

    // The API key and request body are never logged or written to the ledger.
    const upstream = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body,
      signal,
    });
    await forwardResponse(upstream);
    return { status: upstream.status };
  };
}
