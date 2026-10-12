/** fetch() wrapper with timeout, cancellation and typed errors. */

export class NetError extends Error {
  /** @param {'timeout'|'network'|'http'|'parse'|'aborted'} kind */
  constructor(kind, message, status = null) {
    super(message);
    this.name = 'NetError';
    this.kind = kind;
    this.status = status;
  }
}

export function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new NetError('aborted', 'Cancelled'));
    const t = setTimeout(() => { cleanup(); resolve(); }, ms);
    const onAbort = () => { clearTimeout(t); cleanup(); reject(new NetError('aborted', 'Cancelled')); };
    const cleanup = () => signal?.removeEventListener('abort', onAbort);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * GET a URL and parse JSON.
 * @param {string} url
 * @param {{signal?: AbortSignal, timeoutMs?: number, headers?: Record<string,string>}} [opts]
 */
export async function fetchJson(url, { signal, timeoutMs = 10000, headers } = {}) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  const onOuterAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', onOuterAbort, { once: true });
  }

  try {
    let res;
    try {
      res = await fetch(url, { signal: controller.signal, headers, credentials: 'omit', cache: 'no-store' });
    } catch (err) {
      if (timedOut) throw new NetError('timeout', 'The request timed out.');
      if (signal?.aborted || err?.name === 'AbortError') throw new NetError('aborted', 'Cancelled');
      throw new NetError('network', 'Network error. Check your connection.');
    }
    if (!res.ok) throw new NetError('http', `Service returned HTTP ${res.status}.`, res.status);
    try {
      return await res.json();
    } catch {
      throw new NetError('parse', 'The service sent a response that could not be read.');
    }
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onOuterAbort);
  }
}
