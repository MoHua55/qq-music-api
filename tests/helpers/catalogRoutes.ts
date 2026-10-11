import request from 'supertest';
import app from '../../src/app';
import { handleRequest } from '../../src/serverless';
import {
  getLegacyHttpTransport,
  type LegacyHttpTransport,
  setLegacyHttpTransport,
} from '../../src/services/httpTransport';

/**
 * Runs one catalog route case on both hosts against the same synthetic musicu upstream.
 *
 * Node keeps its real controller and service and only swaps the legacy transport; serverless keeps
 * its real handler and fetch transport and only swaps `fetch`. Every recorded call is reduced to
 * the fields both hosts send, so one expectation covers both.
 */

export type CatalogRuntimeName = 'node' | 'serverless';

export interface RouteResult {
  status: number;
  body: unknown;
}

export interface UpstreamCall {
  endpoint: string;
  format?: unknown;
  singermid?: unknown;
  payload: unknown;
}

type Reply = { body: unknown } | { error: unknown };

const MUSICU_URL = 'https://u.y.qq.com/cgi-bin/musicu.fcg';

const toCall = (endpoint: string, params: Record<string, unknown>): UpstreamCall => ({
  endpoint,
  ...(params.format === undefined ? {} : { format: params.format }),
  ...(params.singermid === undefined ? {} : { singermid: params.singermid }),
  payload: typeof params.data === 'string' ? JSON.parse(params.data) : undefined,
});

/** Call from inside a `describe`; it installs and removes the stub around every test. */
export const useCatalogUpstream = (runtime: CatalogRuntimeName) => {
  const calls: UpstreamCall[] = [];
  let reply: Reply = { error: new Error('No upstream reply configured') };
  let original: LegacyHttpTransport | undefined;
  let fetchSpy: jest.SpyInstance | undefined;

  beforeEach(() => {
    calls.length = 0;
    reply = { error: new Error('No upstream reply configured') };
    if (runtime === 'node') {
      original = getLegacyHttpTransport();
      const base = original;
      setLegacyHttpTransport({
        kind: base.kind,
        get defaults() {
          return base.defaults;
        },
        request: async <T>(
          url: string,
          _method: string,
          options: { params?: Record<string, unknown> } = {},
          target?: string,
        ) => {
          calls.push(toCall(target === 'u' ? MUSICU_URL : url, options.params ?? {}));
          if ('error' in reply) throw reply.error;
          return { data: reply.body as T, status: 200, statusText: 'OK', headers: {}, config: {} };
        },
      } as LegacyHttpTransport);
    } else {
      fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        calls.push(
          toCall(`${url.origin}${url.pathname}`, Object.fromEntries(url.searchParams.entries())),
        );
        if ('error' in reply) throw reply.error;
        return Response.json(reply.body);
      });
    }
  });

  afterEach(() => {
    if (original) setLegacyHttpTransport(original);
    original = undefined;
    fetchSpy?.mockRestore();
    fetchSpy = undefined;
  });

  return {
    calls,
    respond: (body: unknown) => {
      reply = { body };
    },
    fail: (error: unknown) => {
      reply = { error };
    },
  };
};

const server = app.callback();

export const callRoute = async (
  runtime: CatalogRuntimeName,
  path: string,
): Promise<RouteResult> => {
  if (runtime === 'node') {
    const response = await request(server).get(path);
    return { status: response.status, body: response.body };
  }
  const response = await handleRequest(new Request(`https://worker.invalid${path}`), {});
  return { status: response.status, body: await response.json() };
};

export const CATALOG_RUNTIMES: CatalogRuntimeName[] = ['node', 'serverless'];
export { MUSICU_URL };
