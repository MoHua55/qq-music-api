import request from 'supertest';
import app from '../src/app';
import { handleRequest } from '../src/serverless';
import { logger } from '../src/util/logger';

// MV：清单（带筛选）、详情、播放链接、歌曲相关 MV，都是公开内容，匿名读。Node 与 serverless 跑同一份案例，
// 只替换对外的 fetch。结构按 2026-10 实测整理（`MvInfoProServer.GetAllocTag`／`GetAllocMvInfo`／
// `GetSongRelatedMv`、`VideoDataServer.get_video_info_batch`、`MvUrlProxy.GetMvUrls`），名称与 id 都是假数据。

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

const VID = 'fixturevid1';

const singer = (index: number) => ({
  id: 500 + index,
  mid: `fixtureSinger${index}`,
  name: `Fixture singer ${index}`,
  picurl: '',
});
const flatSinger = (index: number) => ({
  mid: `fixtureSinger${index}`,
  name: `Fixture singer ${index}`,
});

const listMv = (index: number, overrides: Record<string, unknown> = {}) => ({
  comment_cnt: 3,
  duration: 200 + index,
  mvid: 900 + index,
  picurl: `https://fixture.invalid/mv-${index}.jpg`,
  playcnt: 3000 + index,
  pubdate: 1700000000 + index,
  singers: [singer(index)],
  subtitle: '',
  title: `Fixture MV ${index}`,
  uploader: { enc_uin: 'fixture-uploader', headurl: '', nick: 'Fixture uploader' },
  vid: `fixturevid${index}`,
  ...overrides,
});
const flatMv = (index: number) => ({
  vid: `fixturevid${index}`,
  title: `Fixture MV ${index}`,
  id: 900 + index,
  cover: `https://fixture.invalid/mv-${index}.jpg`,
  playCount: 3000 + index,
  duration: 200 + index,
  publishTime: 1700000000 + index,
  singers: [flatSinger(index)],
});

const TAGS = {
  area: [
    { id: 15, name: 'Fixture all areas' },
    { id: 16, name: 'Fixture mainland' },
  ],
  version: [{ id: 7, name: 'Fixture all versions' }],
};
const LIST = { list: [listMv(1), listMv(2)], total: 50 };

const DETAIL = {
  [VID]: {
    vid: VID,
    sid: 1,
    gmid: 'fixture-gmid',
    cover_pic: 'https://fixture.invalid/detail.jpg',
    singers: [{ ...singer(1), pic_mid: '', grade: 0 }],
    isfav: 0,
    duration: 245,
    desc: 'Fixture desc',
    msg: '',
    type: 0,
    playcnt: 9000,
    video_switch: 1,
    pubdate: 1700000100,
    name: 'Fixture MV detail',
  },
};

const file = (
  filetype: number,
  code: number,
  urls: string[],
  overrides: Record<string, unknown> = {},
) => ({
  url: urls,
  freeflow_url: urls,
  comm_url: [],
  cn: '',
  vkey: '',
  expire: 0,
  code,
  filetype,
  m3u8: '',
  newFileType: 0,
  format: 0,
  fileSize: filetype * 1000,
  ...overrides,
});
const URLS = {
  [VID]: {
    mp4: [
      file(0, 2000, []),
      file(10, 0, ['https://fixture.invalid/360-a.mp4', 'https://fixture.invalid/360-b.mp4']),
      file(20, 0, ['https://fixture.invalid/480.mp4']),
      file(40, 1000, []),
    ],
    hls: [file(10, 2050, [])],
    duration: 245,
  },
};

const RELATED = { hasmore: 1, list: [listMv(3)] };

describe.each(['node', 'serverless'] as const)('mv routes: %s', (runtime) => {
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
    const failing = rpcs.map((rpc) => replies[rpc.method] ?? {}).find((r) => r.httpStatus);
    if (failing?.httpStatus)
      return new Response('fixture-private-error-page', { status: failing.httpStatus });
    const body: Record<string, unknown> = { code: 0 };
    rpcs.forEach((rpc, index) => {
      const reply = replies[rpc.method] ?? {};
      body[`req_${index}`] = { code: reply.code ?? 0, data: reply.data ?? {} };
    });
    return Response.json(body);
  };

  const call = async (path: string, headers: Record<string, string> = {}): Promise<HttpResult> => {
    if (runtime === 'node') {
      const result = await request(app.callback()).get(path).set(headers);
      return { status: result.status, body: result.body };
    }
    const result = await handleRequest(new Request(`https://mv.invalid${path}`, { headers }), {});
    return { status: result.status, body: (await result.json()) as HttpResult['body'] };
  };

  beforeEach(() => {
    for (const level of ['debug', 'warn', 'error'] as const)
      jest.spyOn(logger, level).mockImplementation(() => undefined);
    jest.spyOn(global, 'fetch').mockImplementation(upstream);
    app.silent = true;
    recorded = [];
    replies = {
      GetAllocTag: { data: TAGS },
      GetAllocMvInfo: { data: LIST },
      get_video_info_batch: { data: DETAIL },
      GetMvUrls: { data: URLS },
      GetSongRelatedMv: { data: RELATED },
    };
  });

  afterEach(() => jest.restoreAllMocks());

  const expectAnonymous = (rpcCount = 1) => {
    expect(recorded).toHaveLength(1);
    expect(recorded[0].comm).toEqual({ ct: 24, cv: 0 });
    expect(recorded[0].cookie).toBeNull();
    expect(recorded[0].rpcs).toHaveLength(rpcCount);
  };

  describe('/mv/list', () => {
    it('reads the filters and one page of MVs in one anonymous request', async () => {
      const result = await call('/mv/list', { 'X-QQ-Session': 'b'.repeat(64) });

      expect(result.status).toBe(200);
      expect(result.body).toEqual({
        code: 200,
        mvs: [flatMv(1), flatMv(2)],
        tags: TAGS,
        total: 50,
        more: true,
      });
      expectAnonymous(2);
      expect(recorded[0].rpcs).toEqual([
        { module: 'MvService.MvInfoProServer', method: 'GetAllocTag', param: {} },
        {
          module: 'MvService.MvInfoProServer',
          method: 'GetAllocMvInfo',
          param: { area: 15, version: 7, order: 0, start: 0, size: 20 },
        },
      ]);
    });

    it('passes the filters and paging, keeping limit at 40', async () => {
      const result = await call('/mv/list?area=16&version=8&offset=48&limit=99');

      expect(recorded[0].rpcs[1].param).toEqual({
        area: 16,
        version: 8,
        order: 0,
        start: 48,
        size: 40,
      });
      expect(result.body.more).toBe(false);
    });

    it('still answers when the filter list cannot be read', async () => {
      replies.GetAllocTag = { code: 1101 };

      const result = await call('/mv/list');

      expect(result.status).toBe(200);
      expect(result.body.tags).toEqual({ area: [], version: [] });
    });

    it('leaves out empty optional fields and skips MVs without a vid', async () => {
      replies.GetAllocMvInfo = {
        data: {
          list: [
            listMv(4, { vid: '' }),
            null,
            listMv(5, { picurl: '', playcnt: 'x', singers: [{ name: 'No mid' }] }),
          ],
          total: 'x',
        },
      };

      const result = await call('/mv/list');

      expect(result.body.mvs).toEqual([
        {
          vid: 'fixturevid5',
          title: 'Fixture MV 5',
          id: 905,
          duration: 205,
          publishTime: 1700000005,
          singers: [],
        },
      ]);
      expect(result.body.total).toBeUndefined();
      expect(result.body.more).toBe(false);
    });

    it.each([
      'area=abc',
      'area=0',
      'version=-1',
      'version=12345',
    ])('answers 400 without asking the upstream for %s', async (query) => {
      const result = await call(`/mv/list?${query}`);

      expect(result.status).toBe(400);
      expect(recorded).toHaveLength(0);
    });

    it.each([
      ['no MVs', { list: [], total: 0 }, 422, 'resource.not-found'],
      ['a non-list', { list: 'x' }, 502, 'upstream.invalid-response'],
      ['no readable MV', { list: [listMv(6, { vid: 6 })] }, 502, 'upstream.invalid-response'],
    ])('answers for %s', async (_label, data, status, errorKey) => {
      replies.GetAllocMvInfo = { data };

      const result = await call('/mv/list');

      expect(result.status).toBe(status);
      expect(result.body.errorKey).toBe(errorKey);
    });

    it('an unknown business code on the list becomes 502 and keeps the number', async () => {
      replies.GetAllocMvInfo = { code: 1101 };

      const result = await call('/mv/list');

      expect(result.status).toBe(502);
      expect(result.body).toMatchObject({ errorKey: 'upstream.unknown', upstreamCode: 1101 });
    });
  });

  describe('/mv/detail', () => {
    it('reads one MV and flattens it', async () => {
      const result = await call(`/mv/detail?vid=${VID}`);

      expect(result.status).toBe(200);
      expect(result.body).toEqual({
        code: 200,
        mv: {
          vid: VID,
          title: 'Fixture MV detail',
          desc: 'Fixture desc',
          cover: 'https://fixture.invalid/detail.jpg',
          playCount: 9000,
          duration: 245,
          publishTime: 1700000100,
          singers: [flatSinger(1)],
        },
      });
      expectAnonymous();
      expect(recorded[0].rpcs[0]).toEqual({
        module: 'video.VideoDataServer',
        method: 'get_video_info_batch',
        param: {
          vidlist: [VID],
          required: [
            'vid',
            'name',
            'desc',
            'cover_pic',
            'duration',
            'playcnt',
            'pubdate',
            'singers',
          ],
        },
      });
    });

    it.each([
      ['no entry for the vid', {}, 422, 'resource.not-found'],
      ['an entry without a vid', { [VID]: { name: 'Fixture' } }, 502, 'upstream.invalid-response'],
    ])('answers for %s', async (_label, data, status, errorKey) => {
      replies.get_video_info_batch = { data };

      const result = await call(`/mv/detail?vid=${VID}`);

      expect(result.status).toBe(status);
      expect(result.body.errorKey).toBe(errorKey);
    });
  });

  describe('/mv/url', () => {
    it('gives only the MP4 files that came with links, best quality last', async () => {
      const result = await call(`/mv/url?vid=${VID}`);

      expect(result.status).toBe(200);
      expect(result.body).toEqual({
        code: 200,
        vid: VID,
        files: [
          {
            quality: 10,
            size: 10000,
            urls: ['https://fixture.invalid/360-a.mp4', 'https://fixture.invalid/360-b.mp4'],
          },
          { quality: 20, size: 20000, urls: ['https://fixture.invalid/480.mp4'] },
        ],
      });
      expectAnonymous();
      expect(recorded[0].rpcs[0]).toMatchObject({
        module: 'music.stream.MvUrlProxy',
        method: 'GetMvUrls',
        param: { vids: [VID], request_type: 10003 },
      });
      expect(recorded[0].rpcs[0].param.guid).toMatch(/^[0-9a-f]{32}$/);
    });

    it('merges both link lists and drops links that are not http', async () => {
      replies.GetMvUrls = {
        data: {
          [VID]: {
            mp4: [
              file(30, 0, [], {
                url: ['https://fixture.invalid/720.mp4', 'ftp://fixture.invalid/x', 3],
                freeflow_url: [
                  'https://fixture.invalid/720.mp4',
                  'http://fixture.invalid/720-b.mp4',
                ],
                fileSize: 'x',
              }),
            ],
          },
        },
      };

      const result = await call(`/mv/url?vid=${VID}`);

      expect(result.body.files).toEqual([
        {
          quality: 30,
          urls: ['https://fixture.invalid/720.mp4', 'http://fixture.invalid/720-b.mp4'],
        },
      ]);
    });

    it.each([
      ['no entry for the vid', {}, 422, 'resource.not-found'],
      [
        'no file with links',
        { [VID]: { mp4: [file(40, 1000, [])], hls: [] } },
        422,
        'resource.not-found',
      ],
      ['a non-list', { [VID]: { mp4: 'x' } }, 502, 'upstream.invalid-response'],
    ])('answers for %s', async (_label, data, status, errorKey) => {
      replies.GetMvUrls = { data };

      const result = await call(`/mv/url?vid=${VID}`);

      expect(result.status).toBe(status);
      expect(result.body.errorKey).toBe(errorKey);
    });
  });

  describe('/song/mvs', () => {
    it('reads the MVs related to one song', async () => {
      const result = await call('/song/mvs?id=4242');

      expect(result.status).toBe(200);
      expect(result.body).toEqual({ code: 200, mvs: [flatMv(3)], more: true });
      expectAnonymous();
      expect(recorded[0].rpcs[0]).toEqual({
        module: 'MvService.MvInfoProServer',
        method: 'GetSongRelatedMv',
        param: { songid: '4242', songtype: 1, lastmvid: 0 },
      });
    });

    it.each([
      ['no MVs', { hasmore: 0, list: [] }, 422, 'resource.not-found'],
      ['a non-list', { list: {} }, 502, 'upstream.invalid-response'],
      ['no readable MV', { list: [listMv(7, { vid: '' })] }, 502, 'upstream.invalid-response'],
    ])('answers for %s', async (_label, data, status, errorKey) => {
      replies.GetSongRelatedMv = { data };

      const result = await call('/song/mvs?id=4242');

      expect(result.status).toBe(status);
      expect(result.body.errorKey).toBe(errorKey);
    });

    it.each([
      '',
      '?id=',
      '?id=abc',
      '?id=0',
    ])('answers 400 without asking the upstream for %s', async (query) => {
      const result = await call(`/song/mvs${query}`);

      expect(result.status).toBe(400);
      expect(recorded).toHaveLength(0);
    });
  });

  describe.each(['detail', 'url'])('/mv/%s shared rules', (name) => {
    it.each([
      '',
      '?vid=',
      '?vid=bad-vid!',
      `?vid=${'a'.repeat(33)}`,
    ])('answers 400 without asking the upstream for %s', async (query) => {
      const result = await call(`/mv/${name}${query}`);

      expect(result.status).toBe(400);
      expect(recorded).toHaveLength(0);
    });
  });

  describe.each([
    ['/mv/list'],
    [`/mv/detail?vid=${VID}`],
    [`/mv/url?vid=${VID}`],
    ['/song/mvs?id=4242'],
  ])('%s upstream failures', (path) => {
    it('an unknown business code becomes 502 and keeps the number', async () => {
      for (const reply of Object.values(replies)) {
        reply.code = 1101;
        reply.data = {};
      }

      const result = await call(path);

      expect(result.status).toBe(502);
      expect(result.body).toMatchObject({ errorKey: 'upstream.unknown', upstreamCode: 1101 });
    });

    it('answers 502 without the error page when the upstream HTTP request fails', async () => {
      for (const reply of Object.values(replies)) reply.httpStatus = 503;

      const result = await call(path);

      expect(result.status).toBe(502);
      expect(JSON.stringify(result.body)).not.toContain('fixture-private-error-page');
    });
  });
});
