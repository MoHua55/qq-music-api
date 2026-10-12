import axios from 'axios';
import request from 'supertest';

type Reply = { body: unknown } | { error: unknown };
export interface LegacyCall {
  endpoint: string;
  method: string;
  params: Record<string, unknown>;
  payload?: unknown;
}

const calls: LegacyCall[] = [];
let replies: Reply[] = [];
let unconfiguredRequests = 0;
const create = axios.create.bind(axios);

// Keep the real HTTP executor, services and controllers. Only the private axios client's adapter
// is replaced; an unconfigured request fails, and the normal network guard remains installed.
const createSpy = jest.spyOn(axios, 'create').mockImplementation((options) =>
  create({
    ...options,
    adapter: async (config) => {
      const params = structuredClone(config.params ?? {}) as Record<string, unknown>;
      const data = params.data;
      calls.push({
        endpoint: config.url ?? '',
        method: config.method ?? '',
        params,
        ...(data === undefined
          ? {}
          : { payload: typeof data === 'string' ? JSON.parse(data) : data }),
      });
      const reply = replies.shift();
      if (!reply) {
        unconfiguredRequests += 1;
        throw new Error('No synthetic upstream response configured');
      }
      if ('error' in reply) throw reply.error;
      return {
        data: structuredClone(reply.body),
        status: 200,
        statusText: 'OK',
        headers: {},
        config,
      };
    },
  }),
);

const app = require('../../src/app').default as import('koa');
createSpy.mockRestore();
const server = app.callback();

export const useLegacyRouteUpstream = () => {
  beforeEach(() => {
    calls.length = 0;
    replies = [];
    unconfiguredRequests = 0;
  });
  afterEach(() => {
    expect(replies).toHaveLength(0);
    expect(unconfiguredRequests).toBe(0);
  });
  return {
    calls,
    respond: (...bodies: unknown[]) => {
      replies = bodies.map((body) => ({ body }));
    },
    respondWith: (...items: Reply[]) => {
      replies = items;
    },
    fail: (error: unknown) => {
      replies = [{ error }];
    },
    get: (path: string) => request(server).get(path),
    post: (path: string, body: unknown) =>
      request(server)
        .post(path)
        .send(body as object),
  };
};

export const MUSICU_ENDPOINT = 'https://u.y.qq.com/cgi-bin/musicu.fcg';
export const CGI_ENDPOINT = 'https://c.y.qq.com';
export const networkError = () =>
  Object.assign(new Error('synthetic detail'), { code: 'ECONNRESET' });
export const NETWORK_ERROR_BODY = {
  error: { name: 'Error', message: 'Upstream request failed (ECONNRESET)', code: 'ECONNRESET' },
};
