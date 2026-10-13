import { QqApiError } from '../protocol/errors';

export interface HttpRequest {
  url: string;
  body: string;
  headers: Record<string, string>;
  signal: AbortSignal;
}

export interface HttpResponse {
  status: number;
  body?: unknown;
  retryAfterMs?: number;
}

export type HttpTransport = (request: HttpRequest) => Promise<HttpResponse>;

/** An adapter observation, containing no native exception, URL, body or credential. */
export class HttpTransportError extends Error {
  public readonly code?: string;
  public readonly phase: 'connect' | 'read' | 'unknown';

  constructor(observation: { code?: string; phase: 'connect' | 'read' | 'unknown' }) {
    super('HTTP transport failed');
    this.name = 'HttpTransportError';
    this.code = observation.code;
    this.phase = observation.phase;
  }
}

export const checkAbort = (signal: AbortSignal): void => {
  if (signal.aborted) throw new QqApiError('network', { errorKey: 'network.aborted' });
};

export const sleep = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    checkAbort(signal);
    const finish = () => {
      signal.removeEventListener('abort', abort);
      resolve();
    };
    const timer = setTimeout(finish, Math.min(ms, 2_147_483_647));
    const abort = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      reject(new QqApiError('network', { errorKey: 'network.aborted' }));
    };
    signal.addEventListener('abort', abort, { once: true });
  });

/** One budget covers queueing, every attempt, reading the body and backoff. */
export const withDeadline = async <T>(
  run: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  external?: AbortSignal,
): Promise<T> => {
  if (external?.aborted) throw new QqApiError('network', { errorKey: 'network.aborted' });
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort = () => {};
  const interrupted = new Promise<never>((_resolve, reject) => {
    abort = () => {
      reject(new QqApiError('network', { errorKey: 'network.aborted' }));
      controller.abort();
    };
    external?.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => {
      reject(new QqApiError('network', { errorKey: 'network.timeout' }));
      controller.abort();
    }, timeoutMs);
  });
  try {
    return await Promise.race([interrupted, run(controller.signal)]);
  } finally {
    clearTimeout(timer);
    external?.removeEventListener('abort', abort);
    controller.abort();
  }
};
