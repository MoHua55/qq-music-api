import request from 'supertest';
import app from '../src/app';
import { handleRequest } from '../src/serverless';
import { logger } from '../src/util/logger';

// 热搜和搜索建议：公开内容，匿名读。Node 与 serverless 跑同一份案例，只替换对外的 fetch。
// 结构按 2026-10 实测整理（`HotkeyService.GetHotkeyForQQMusicMobile` → `vec_hotkey[]`，
// `SmartBoxCgi.GetSmartBoxResult` → `items[]`，搜索词是 `type 0`），关键字与文字都是假数据。

interface Rpc {
  module: string;
  method: string;
  param: Record<string, unknown>;
}
interface Recorded {
  comm: Record<string, unknown>;
  cookie: string | null;
  rpcs: Rpc[];
}
interface Reply {
  httpStatus?: number;
  globalCode?: number;
  code?: number;
  data?: unknown;
}
interface HttpResult {
  status: number;
  body: Record<string, any>;
}

const hotkey = (query: unknown, overrides: Record<string, unknown> = {}) => ({
  query,
  title: `Fixture title ${String(query)}`,
  description: `Fixture description ${String(query)}`,
  type: 0,
  jump_url: 'https://fixture.invalid/jump',
  ...overrides,
});
const HOTKEYS = { vec_hotkey: [hotkey('fixture hot a'), hotkey('fixture hot b')] };

const suggestion = (hint: unknown, overrides: Record<string, unknown> = {}) => ({
  hint,
  hint_hilight: `<em>${String(hint)}</em>`,
  docid: `fixture-doc-${String(hint)}`,
  type: 0,
  res_type: 'search',
  pic_url: '',
  json: '',
  jump_url: '',
  ...overrides,
});
const SUGGESTIONS = {
  items: [
    suggestion('fixture words a'),
    suggestion('fixture words b'),
    suggestion('fixture assistant', { type: 7, res_type: 'fixture-assistant' }),
  ],
  total_num: 3,
  search_id: 'fixture-search-id',
  vec_direct_items: [],
};

describe.each(['node', 'serverless'] as const)('search suggestion routes: %s', (runtime) => {
  let recorded: Recorded[];
  let replies: Record<string, Reply>;

  const upstream = async (input: string | URL | Request, init?: RequestInit) => {
    const fetched = new Request(input, init);
    const url = new URL(fetched.url);
    if (url.hostname !== 'u.y.qq.com' || url.pathname !== '/cgi-bin/musicu.fcg')
      throw new Error(`Unstubbed request: ${url.origin}${url.pathname}`);
    const payload = JSON.parse(await fetched.text());
    const rpcs: Rpc[] = Object.keys(payload)
      .filter((key) => key.startsWith('req_'))
      .sort()
      .map((key) => payload[key] as Rpc);
    recorded.push({ comm: payload.comm, cookie: fetched.headers.get('cookie'), rpcs });
    const reply = replies[rpcs[0]?.method] ?? {};
    if (reply.httpStatus && reply.httpStatus >= 400)
      return new Response('fixture-private-error-page', { status: reply.httpStatus });
    return Response.json({
      code: reply.globalCode ?? 0,
      req_0: { code: reply.code ?? 0, data: reply.data ?? {} },
    });
  };

  const call = async (path: string, headers: Record<string, string> = {}): Promise<HttpResult> => {
    if (runtime === 'node') {
      const result = await request(app.callback()).get(path).set(headers);
      return { status: result.status, body: result.body };
    }
    const result = await handleRequest(
      new Request(`https://search.invalid${path}`, { headers }),
      {},
    );
    return { status: result.status, body: (await result.json()) as HttpResult['body'] };
  };

  beforeEach(() => {
    for (const level of ['debug', 'warn', 'error'] as const)
      jest.spyOn(logger, level).mockImplementation(() => undefined);
    jest.spyOn(global, 'fetch').mockImplementation(upstream);
    app.silent = true;
    recorded = [];
    replies = {
      GetHotkeyForQQMusicMobile: { data: HOTKEYS },
      GetSmartBoxResult: { data: SUGGESTIONS },
    };
  });

  afterEach(() => jest.restoreAllMocks());

  describe('/search/hot', () => {
    it('reads the hot keywords anonymously, even with a session token', async () => {
      const result = await call('/search/hot', { 'X-QQ-Session': 'b'.repeat(64) });

      expect(result.status).toBe(200);
      expect(result.body).toEqual({
        code: 200,
        hotkeys: [
          {
            keyword: 'fixture hot a',
            title: 'Fixture title fixture hot a',
            description: 'Fixture description fixture hot a',
          },
          {
            keyword: 'fixture hot b',
            title: 'Fixture title fixture hot b',
            description: 'Fixture description fixture hot b',
          },
        ],
      });
      expect(recorded).toHaveLength(1);
      expect(recorded[0].comm).toEqual({ ct: 24, cv: 0 });
      expect(recorded[0].cookie).toBeNull();
      expect(recorded[0].rpcs).toEqual([
        {
          module: 'music.musicsearch.HotkeyService',
          method: 'GetHotkeyForQQMusicMobile',
          param: {},
        },
      ]);
    });

    it('leaves out empty optional texts and skips entries without a keyword', async () => {
      replies.GetHotkeyForQQMusicMobile = {
        data: {
          vec_hotkey: [
            hotkey('fixture hot c', { title: '', description: 7 }),
            hotkey(''),
            hotkey(42),
            null,
            hotkey('  fixture hot d  '),
          ],
        },
      };

      const result = await call('/search/hot');

      expect(result.status).toBe(200);
      expect(result.body.hotkeys).toEqual([
        { keyword: 'fixture hot c' },
        {
          keyword: 'fixture hot d',
          title: 'Fixture title   fixture hot d  ',
          description: 'Fixture description   fixture hot d  ',
        },
      ]);
    });

    it.each([
      ['no keywords', { vec_hotkey: [] }, 422, 'resource.not-found'],
      ['a missing list', {}, 422, 'resource.not-found'],
      ['a non-list', { vec_hotkey: {} }, 502, 'upstream.invalid-response'],
      ['no readable keyword', { vec_hotkey: [hotkey('')] }, 502, 'upstream.invalid-response'],
    ])('answers for %s', async (_label, data, status, errorKey) => {
      replies.GetHotkeyForQQMusicMobile = { data };

      const result = await call('/search/hot');

      expect(result.status).toBe(status);
      expect(result.body.errorKey).toBe(errorKey);
    });

    it('an unknown business code becomes 502 and keeps the number', async () => {
      replies.GetHotkeyForQQMusicMobile = { code: 1101 };

      const result = await call('/search/hot');

      expect(result.status).toBe(502);
      expect(result.body).toMatchObject({ errorKey: 'upstream.unknown', upstreamCode: 1101 });
    });

    it('answers 502 without the error page when the upstream HTTP request fails', async () => {
      replies.GetHotkeyForQQMusicMobile = { httpStatus: 503 };

      const result = await call('/search/hot');

      expect(result.status).toBe(502);
      expect(JSON.stringify(result.body)).not.toContain('fixture-private-error-page');
    });
  });

  describe('/search/suggest', () => {
    it('reads the keyword suggestions anonymously and keeps only search words', async () => {
      const result = await call('/search/suggest?keyword=%20fixture%20words%20', {
        'X-QQ-Session': 'b'.repeat(64),
      });

      expect(result.status).toBe(200);
      expect(result.body).toEqual({
        code: 200,
        keyword: 'fixture words',
        suggestions: ['fixture words a', 'fixture words b'],
      });
      expect(recorded).toHaveLength(1);
      expect(recorded[0].comm).toEqual({ ct: 24, cv: 0 });
      expect(recorded[0].cookie).toBeNull();
      expect(recorded[0].rpcs).toHaveLength(1);
      expect(recorded[0].rpcs[0]).toMatchObject({
        module: 'music.smartboxCgi.SmartBoxCgi',
        method: 'GetSmartBoxResult',
        param: { query: 'fixture words', num_per_page: 0, page_idx: 0 },
      });
      expect(recorded[0].rpcs[0].param.search_id).toMatch(/^[1-9]\d{17}$/);
    });

    it('trims, de-duplicates and skips unusable suggestions', async () => {
      replies.GetSmartBoxResult = {
        data: {
          ...SUGGESTIONS,
          items: [
            suggestion(' fixture words a '),
            suggestion('fixture words a'),
            suggestion(''),
            suggestion(9),
            null,
            suggestion('fixture words c'),
          ],
        },
      };

      const result = await call('/search/suggest?keyword=fixture');

      expect(result.status).toBe(200);
      expect(result.body.suggestions).toEqual(['fixture words a', 'fixture words c']);
    });

    it.each([
      '/search/suggest',
      '/search/suggest?keyword=',
      '/search/suggest?keyword=%20%20',
      `/search/suggest?keyword=${'a'.repeat(61)}`,
    ])('answers 400 without asking the upstream for %s', async (path) => {
      const result = await call(path);

      expect(result.status).toBe(400);
      expect(recorded).toHaveLength(0);
    });

    it.each([
      ['no items', { ...SUGGESTIONS, items: [] }, 422, 'resource.not-found'],
      ['a missing list', { total_num: 0 }, 422, 'resource.not-found'],
      [
        'only non-word items',
        { ...SUGGESTIONS, items: [suggestion('fixture assistant', { type: 7 })] },
        422,
        'resource.not-found',
      ],
      ['a non-list', { ...SUGGESTIONS, items: 'fixture' }, 502, 'upstream.invalid-response'],
      [
        'no readable suggestion',
        { ...SUGGESTIONS, items: [suggestion('')] },
        502,
        'upstream.invalid-response',
      ],
    ])('answers for %s', async (_label, data, status, errorKey) => {
      replies.GetSmartBoxResult = { data };

      const result = await call('/search/suggest?keyword=fixture');

      expect(result.status).toBe(status);
      expect(result.body.errorKey).toBe(errorKey);
    });

    it('an unknown business code becomes 502 and keeps the number', async () => {
      replies.GetSmartBoxResult = { code: 2001 };

      const result = await call('/search/suggest?keyword=fixture');

      expect(result.status).toBe(502);
      expect(result.body).toMatchObject({ errorKey: 'upstream.unknown', upstreamCode: 2001 });
    });

    it('answers 502 without the error page when the upstream HTTP request fails', async () => {
      replies.GetSmartBoxResult = { httpStatus: 503 };

      const result = await call('/search/suggest?keyword=fixture');

      expect(result.status).toBe(502);
      expect(JSON.stringify(result.body)).not.toContain('fixture-private-error-page');
    });
  });
});
