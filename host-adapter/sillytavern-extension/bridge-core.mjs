export function normalizeEngineUrl(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Укажите адрес движка.');
  let url;
  try { url = new URL(value.trim()); } catch { throw new Error('Некорректный адрес движка.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
    || url.search || url.hash || !['', '/'].includes(url.pathname)) {
    throw new Error('Нужен базовый HTTP(S)-адрес без логина, пути, параметров и фрагмента.');
  }
  return url.origin;
}

export async function fetchHealth(baseUrl, fetchImpl = fetch) {
  const url = normalizeEngineUrl(baseUrl) + '/health';
  const response = await fetchImpl(url, {
    method: 'GET',
    credentials: 'omit',
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(2500),
  });
  if (!response.ok) throw new Error(`Движок ответил HTTP ${response.status}.`);
  const body = await response.json();
  if (body?.ok !== true || body?.service !== 'logic-engine' || body?.protocol_version !== 'v1') {
    throw new Error('Ответ не соответствует контракту Logic-Engine /health.');
  }
  return body;
}
