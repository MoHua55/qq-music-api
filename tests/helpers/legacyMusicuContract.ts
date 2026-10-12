import { MUSICU_ENDPOINT, networkError, useLegacyRouteUpstream } from './legacyRouteUpstream';

interface MusicuContract {
  route: string;
  path?: string;
  payload: unknown;
  reply: unknown;
  bodyStatus?: number;
  missing?: unknown;
}

export const legacyMusicuContract = (contract: MusicuContract) => {
  describe(`GET ${contract.route}`, () => {
    const upstream = useLegacyRouteUpstream();
    const path = contract.path ?? contract.route;
    const expectedBody = (response: unknown) => ({
      ...(contract.bodyStatus === undefined ? {} : { status: contract.bodyStatus }),
      response,
    });

    it('preserves upstream data and sends the complete musicu operation payload', async () => {
      upstream.respond(contract.reply);
      const response = await upstream.get(path);
      expect(response.status).toBe(200);
      expect(response.body).toEqual(expectedBody(contract.reply));
      expect(upstream.calls).toHaveLength(1);
      expect(upstream.calls[0]).toMatchObject({
        endpoint: MUSICU_ENDPOINT,
        method: 'get',
        params: { format: 'json' },
      });
      expect(upstream.calls[0].payload).toEqual(contract.payload);
    });

    it('keeps a gateway error in the HTTP 200 response', async () => {
      const reply = { code: 500003 };
      upstream.respond(reply);
      const response = await upstream.get(path);
      expect(response.status).toBe(200);
      expect(response.body).toEqual(expectedBody(reply));
      expect(response.headers['retry-after']).toBeUndefined();
      expect(upstream.calls).toHaveLength(1);
    });

    const operationKeys = Object.keys(contract.payload as Record<string, unknown>).filter(
      (key) => key !== 'comm',
    );
    it.each(
      operationKeys,
    )('keeps the %s business error with a successful gateway', async (operation) => {
      const reply = { code: 0, [operation]: { code: 987654, data: {} } };
      upstream.respond(reply);
      const response = await upstream.get(path);
      expect(response.status).toBe(200);
      expect(response.body).toEqual(expectedBody(reply));
      expect(response.headers['retry-after']).toBeUndefined();
      expect(upstream.calls).toHaveLength(1);
    });

    it('returns the safe controller 500 response without retrying', async () => {
      upstream.fail(networkError());
      const response = await upstream.get(path);
      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Upstream request failed (ECONNRESET)' });
      expect(upstream.calls).toHaveLength(1);
    });

    if (contract.missing !== undefined) {
      it('rejects an empty required filter before contacting upstream', async () => {
        const response = await upstream.get(`${contract.route}?area_id=&version_id=`);
        expect(response.status).toBe(400);
        expect(response.body).toEqual(contract.missing);
        expect(upstream.calls).toHaveLength(0);
      });
    }
  });
};
