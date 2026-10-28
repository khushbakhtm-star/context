/** A failed connection must not leave the foreground sync waiting forever. */
export const ACCOUNT_REQUEST_TIMEOUT_MS = 20_000;

export class AccountRequestTimeoutError extends Error {
  readonly code = 'ACCOUNT_REQUEST_TIMEOUT';
  constructor() { super('The account connection timed out. Check your connection and tap Sync to retry.'); }
}

function cancelled() { return new Error('The account request was canceled.'); }

/** Settle once, abort cooperative transports, and ignore late native results. */
export function accountRequestDeadline<T>(operation: (signal: AbortSignal) => Promise<T>,
  options: { signal?: AbortSignal | null; timeoutMs?: number } = {}): Promise<T> {
  const timeoutMs = options.timeoutMs ?? ACCOUNT_REQUEST_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return Promise.reject(new Error('Use a valid account request deadline.'));
  return new Promise<T>((resolve, reject) => {
    const controller = new AbortController(); let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (value: T | undefined, error?: unknown) => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      if (error !== undefined) { controller.abort(); reject(error); } else resolve(value!);
    };
    const onAbort = () => finish(undefined, cancelled());
    if (options.signal?.aborted) { onAbort(); return; }
    options.signal?.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(() => finish(undefined, new AccountRequestTimeoutError()), timeoutMs);
    Promise.resolve().then(() => {
      if (settled) throw cancelled();
      return operation(controller.signal);
    }).then((value) => finish(value), (error) => finish(undefined, error));
  });
}

/** Response methods retain the native Response receiver. Body downloads have
 * their own deadline as fetch can resolve as soon as headers arrive. */
function boundedResponse(response: Response, abortFetch: () => void, signal?: AbortSignal | null): Response {
  return new Proxy(response, {
    get(target, property) {
      if (property === 'clone') return () => boundedResponse(target.clone(), abortFetch, signal);
      if (property === 'json' || property === 'text' || property === 'arrayBuffer' || property === 'blob' || property === 'formData') {
        return () => accountRequestDeadline(async (bodySignal) => {
          const abort = () => abortFetch();
          bodySignal.addEventListener('abort', abort, { once: true });
          try { return await target[property](); }
          finally { bodySignal.removeEventListener('abort', abort); }
        }, { signal });
      }
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

export async function accountFetchWithDeadline(url: string, init: RequestInit = {},
  transport: typeof fetch = fetch): Promise<Response> {
  const controller = new AbortController();
  const response = await accountRequestDeadline(async (signal) => {
    const abort = () => controller.abort();
    signal.addEventListener('abort', abort, { once: true });
    try { return await transport(url, { ...init, signal: controller.signal }); }
    finally { signal.removeEventListener('abort', abort); }
  }, { signal: init.signal });
  return boundedResponse(response, () => controller.abort(), init.signal);
}
