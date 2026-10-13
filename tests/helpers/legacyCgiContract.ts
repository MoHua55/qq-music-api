import {
  CGI_ENDPOINT,
  NETWORK_ERROR_BODY,
  networkError,
  useLegacyRouteUpstream,
} from './legacyRouteUpstream';

interface CgiContract {
  route: string;
  path?: string;
  endpoint: string;
  params: Record<string, unknown>;
  reply: unknown;
  missing?: { status: number; body: unknown };
}

/** Each route supplies its own protocol parameters and synthetic response shape. */
export const legacyCgiContract = (contract: CgiContract) => {
  describe(`GET ${contract.route}`, () => {
    const upstream = useLegacyRouteUpstream();
    const path = contract.path ?? contract.route;

    it('returns the upstream data and sends the route-specific CGI request', async () => {
      upstream.respond(contract.reply);
      const response = await upstream.get(path);
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ response: contract.reply });
      expect(upstream.calls).toHaveLength(1);
      expect(upstream.calls[0]).toEqual({
        endpoint: `${CGI_ENDPOINT}${contract.endpoint}`,
        method: 'get',
        params: expect.objectContaining(contract.params),
      });
    });

    it('preserves an unknown business failure inside the HTTP 200 body', async () => {
      const reply = { code: 987654, message: 'synthetic rejection', data: {} };
      upstream.respond(reply);
      const response = await upstream.get(path);
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ response: reply });
      expect(response.headers['retry-after']).toBeUndefined();
      expect(upstream.calls).toHaveLength(1);
    });

    it('returns the safe transport failure without retrying', async () => {
      upstream.fail(networkError());
      const response = await upstream.get(path);
      expect(response.status).toBe(500);
      expect(response.body).toEqual(NETWORK_ERROR_BODY);
      expect(upstream.calls).toHaveLength(1);
    });

    if (contract.missing) {
      const missing = contract.missing;
      it('handles a missing required input before contacting upstream', async () => {
        const response = await upstream.get(contract.route);
        expect(response.status).toBe(missing.status);
        expect(response.body).toEqual(missing.body);
        expect(upstream.calls).toHaveLength(0);
      });
    }
  });
};
