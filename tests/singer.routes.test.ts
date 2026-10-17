import request from 'supertest';
import app from '../src/app';
import { handleRequest } from '../src/serverless';
import { logger } from '../src/util/logger';

// 歌手的新路由：清单、资料、主页、相似歌手、歌曲、MV，都是公开内容，匿名读。Node 与 serverless 跑同一份案例，
// 只替换对外的 fetch。结构按 2026-10 实测整理（`SingerList.GetSingerListIndex`、`SingerInfoInter.GetSingerDetail`、
// `UnifiedHomepageSrv.GetHomepageHeader`（成功时回 10000）、`SimilarSingerSvr.GetSimilarSingerList`、
// `song_list_server.GetSingerSongList`、`MvInfoProServer.GetSingerMvList`），名称与 id 都是假数据。

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

const MID = 'fixtureSingerA1';

const listSinger = (index: number, overrides: Record<string, unknown> = {}) => ({
  area_id: 200,
  singer_id: 100 + index,
  country_id: 1,
  singer_name: `Fixture singer ${index}`,
  country: 'Fixture country',
  other_name: `Fixture alias ${index}`,
  singer_mid: `fixtureSinger${index}`,
  spell: 'f',
  trend: 0,
  singer_pmid: `fixture-pmid-${index}`,
  concernNum: 3,
  singer_pic: `https://fixture.invalid/singer-${index}.jpg`,
  ...overrides,
});
const flatListSinger = (index: number) => ({
  id: 100 + index,
  mid: `fixtureSinger${index}`,
  name: `Fixture singer ${index}`,
  pic: `https://fixture.invalid/singer-${index}.jpg`,
  country: 'Fixture country',
  otherName: `Fixture alias ${index}`,
});
const TAGS = {
  area: [
    { id: -100, name: 'Fixture all' },
    { id: 200, name: 'Fixture mainland' },
  ],
  genre: [{ id: -100, name: 'Fixture all' }],
  index: [{ id: 1, name: 'A' }],
  sex: [{ id: 0, name: 'Fixture male' }],
};
const LIST = {
  area: -100,
  sex: -100,
  genre: -100,
  index: -100,
  singerlist: [listSinger(1), listSinger(2), listSinger(3)],
  tags: TAGS,
  total: 200,
};

const DETAIL = {
  singer_list: [
    {
      basic_info: {
        singer_mid: MID,
        name: 'Fixture singer A',
        type: 0,
        has_photo: 0,
        singer_id: 501,
        singer_pmid: 'fixture-pmid',
        wikiurl: '',
      },
      ex_info: {
        area: 0,
        desc: 'Fixture desc',
        tag: '',
        identity: 0,
        instrument: '',
        genre: 0,
        foreign_name: 'Fixture foreign name',
        birthday: '2000-01-01',
        enter: '',
        blogFlag: 0,
      },
      wiki: 'Fixture wiki',
      group_list: [],
      pic: { big_black: '', big_white: '', pic: 'https://fixture.invalid/detail.jpg' },
      photos: [],
      group_info: [],
    },
  ],
};

const counter = (Num: unknown) => ({ HasEntry: 1, Num, Add: 0, jumpURL: '' });
const HOMEPAGE = {
  Info: {
    BaseInfo: { Name: 'Fixture singer A' },
    FansNum: counter(1200),
    FollowNum: counter('7'),
  },
  Status: 0,
};

const similarSinger = (index: number, overrides: Record<string, unknown> = {}) => ({
  singerId: 600 + index,
  singerMid: `fixtureSimilar${index}`,
  singerName: `Fixture similar ${index}`,
  singerPic: `https://fixture.invalid/similar-${index}.jpg`,
  pic_mid: '',
  trace: '',
  abt: '',
  tf: '',
  ...overrides,
});
const SIMILAR = {
  singerlist: [similarSinger(1), similarSinger(2)],
  code: 0,
  errMsg: '',
};

const track = (id: number) => ({
  id,
  mid: `fixture-song-${id}`,
  name: `Fixture song ${id}`,
  file: { media_mid: `fixture-media-${id}` },
});
const SONGS = {
  singerMid: MID,
  totalNum: 45,
  songList: [{ songInfo: track(701) }, { songInfo: track(702) }],
};

const mv = (index: number, overrides: Record<string, unknown> = {}) => ({
  duration: 200 + index,
  icon_type: 0,
  mvid: 900 + index,
  picformat: 0,
  picurl: `https://fixture.invalid/mv-${index}.jpg`,
  playcnt: 3000 + index,
  pubdate: 1700000000 + index,
  title: `Fixture MV ${index}`,
  type: 0,
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
});
const MVS = { list: [mv(1), mv(2)], total: 25 };

describe.each(['node', 'serverless'] as const)('singer routes: %s', (runtime) => {
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
      new Request(`https://singer.invalid${path}`, { headers }),
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
      GetSingerListIndex: { data: LIST },
      GetSingerDetail: { data: DETAIL },
      GetHomepageHeader: { code: 10000, data: HOMEPAGE },
      GetSimilarSingerList: { data: SIMILAR },
      GetSingerSongList: { data: SONGS },
      GetSingerMvList: { data: MVS },
    };
  });

  afterEach(() => jest.restoreAllMocks());

  const expectAnonymous = () => {
    expect(recorded).toHaveLength(1);
    expect(recorded[0].comm).toEqual({ ct: 24, cv: 0 });
    expect(recorded[0].cookie).toBeNull();
    expect(recorded[0].rpcs).toHaveLength(1);
  };

  describe('/singer/list', () => {
    it('reads the first page with all filters by default, anonymously', async () => {
      const result = await call('/singer/list', { 'X-QQ-Session': 'b'.repeat(64) });

      expect(result.status).toBe(200);
      expect(result.body).toEqual({
        code: 200,
        singers: [flatListSinger(1), flatListSinger(2), flatListSinger(3)],
        tags: {
          area: [
            { id: -100, name: 'Fixture all' },
            { id: 200, name: 'Fixture mainland' },
          ],
          sex: [{ id: 0, name: 'Fixture male' }],
          genre: [{ id: -100, name: 'Fixture all' }],
          index: [{ id: 1, name: 'A' }],
        },
        total: 200,
        more: true,
      });
      expectAnonymous();
      expect(recorded[0].rpcs[0]).toEqual({
        module: 'music.musichallSinger.SingerList',
        method: 'GetSingerListIndex',
        param: { area: -100, sex: -100, genre: -100, index: -100, sin: 0, cur_page: 1 },
      });
    });

    it('passes the filters and maps offset onto the 80-singer upstream pages', async () => {
      const result = await call('/singer/list?area=200&sex=1&genre=3&index=2&offset=161&limit=1');

      expect(recorded[0].rpcs[0].param).toEqual({
        area: 200,
        sex: 1,
        genre: 3,
        index: 2,
        sin: 160,
        cur_page: 3,
      });
      expect(result.body.singers).toEqual([flatListSinger(2)]);
      expect(result.body.more).toBe(true);
    });

    it('keeps limit at 80 and reports no more on the last page', async () => {
      replies.GetSingerListIndex = { data: { ...LIST, total: 3 } };

      const result = await call('/singer/list?limit=500');

      expect(result.body.singers).toHaveLength(3);
      expect(result.body.more).toBe(false);
    });

    it('skips singers without a mid and gives empty tag lists when tags are missing', async () => {
      replies.GetSingerListIndex = {
        data: {
          ...LIST,
          singerlist: [listSinger(4, { singer_mid: '' }), null, listSinger(5, { singer_pic: '' })],
          tags: undefined,
          total: 'many',
        },
      };

      const result = await call('/singer/list');

      expect(result.status).toBe(200);
      expect(result.body).toEqual({
        code: 200,
        singers: [
          {
            id: 105,
            mid: 'fixtureSinger5',
            name: 'Fixture singer 5',
            country: 'Fixture country',
            otherName: 'Fixture alias 5',
          },
        ],
        tags: { area: [], sex: [], genre: [], index: [] },
        more: false,
      });
    });

    it.each([
      'area=abc',
      'sex=1.5',
      'genre=99999',
      'index=-',
    ])('answers 400 without asking the upstream for %s', async (query) => {
      const result = await call(`/singer/list?${query}`);

      expect(result.status).toBe(400);
      expect(recorded).toHaveLength(0);
    });

    it.each([
      ['no singers', { ...LIST, singerlist: [] }, '', 422, 'resource.not-found'],
      ['an offset past this page', LIST, '?offset=50', 422, 'resource.not-found'],
      ['a non-list', { ...LIST, singerlist: {} }, '', 502, 'upstream.invalid-response'],
      [
        'no readable singer',
        { ...LIST, singerlist: [listSinger(6, { singer_mid: 7 })] },
        '',
        502,
        'upstream.invalid-response',
      ],
    ])('answers for %s', async (_label, data, query, status, errorKey) => {
      replies.GetSingerListIndex = { data };

      const result = await call(`/singer/list${query}`);

      expect(result.status).toBe(status);
      expect(result.body.errorKey).toBe(errorKey);
    });
  });

  describe('/singer/detail', () => {
    it('reads one singer and flattens the profile', async () => {
      const result = await call(`/singer/detail?mid=${MID}`);

      expect(result.status).toBe(200);
      expect(result.body).toEqual({
        code: 200,
        singer: {
          mid: MID,
          name: 'Fixture singer A',
          id: 501,
          pic: 'https://fixture.invalid/detail.jpg',
          desc: 'Fixture desc',
          wiki: 'Fixture wiki',
          foreignName: 'Fixture foreign name',
          birthday: '2000-01-01',
        },
      });
      expectAnonymous();
      expect(recorded[0].rpcs[0]).toEqual({
        module: 'music.musichallSinger.SingerInfoInter',
        method: 'GetSingerDetail',
        param: { singer_mids: [MID], pic: 1, group_singer: 1, wiki_singer: 1, ex_singer: 1 },
      });
    });

    it('leaves out empty optional fields', async () => {
      replies.GetSingerDetail = {
        data: {
          singer_list: [
            {
              basic_info: { singer_mid: MID, name: 'Fixture singer A' },
              ex_info: { desc: '', foreign_name: 3 },
              wiki: '',
              pic: { pic: '', big_black: 'https://fixture.invalid/black.jpg' },
            },
          ],
        },
      };

      const result = await call(`/singer/detail?mid=${MID}`);

      expect(result.body.singer).toEqual({
        mid: MID,
        name: 'Fixture singer A',
        pic: 'https://fixture.invalid/black.jpg',
      });
    });

    it.each([
      ['no singer', { singer_list: [] }, 422, 'resource.not-found'],
      ['a missing list', {}, 422, 'resource.not-found'],
      ['a non-list', { singer_list: 'x' }, 502, 'upstream.invalid-response'],
      [
        'a singer without a mid',
        { singer_list: [{ basic_info: { name: 'Fixture' } }] },
        502,
        'upstream.invalid-response',
      ],
    ])('answers for %s', async (_label, data, status, errorKey) => {
      replies.GetSingerDetail = { data };

      const result = await call(`/singer/detail?mid=${MID}`);

      expect(result.status).toBe(status);
      expect(result.body.errorKey).toBe(errorKey);
    });
  });

  describe('/singer/homepage', () => {
    it('reads the fan and follow counts and treats code 10000 as success', async () => {
      const result = await call(`/singer/homepage?mid=${MID}`);

      expect(result.status).toBe(200);
      expect(result.body).toEqual({ code: 200, mid: MID, fansNum: 1200, followNum: 7 });
      expectAnonymous();
      expect(recorded[0].rpcs[0]).toEqual({
        module: 'music.UnifiedHomepage.UnifiedHomepageSrv',
        method: 'GetHomepageHeader',
        param: { SingerMid: MID },
      });
    });

    it('also accepts code 0 and leaves out a count that is not a whole number', async () => {
      replies.GetHomepageHeader = {
        data: { Info: { FansNum: counter(5), FollowNum: counter(-1), VisitorNum: counter('1e3') } },
      };

      const result = await call(`/singer/homepage?mid=${MID}`);

      expect(result.body).toEqual({ code: 200, mid: MID, fansNum: 5 });
    });

    it.each([
      ['no profile', {}],
      ['no counts', { Info: { BaseInfo: {} } }],
      ['counts that are not numbers', { Info: { FansNum: counter('many'), FollowNum: 3 } }],
    ])('answers 502 for %s', async (_label, data) => {
      replies.GetHomepageHeader = { code: 10000, data };

      const result = await call(`/singer/homepage?mid=${MID}`);

      expect(result.status).toBe(502);
      expect(result.body.errorKey).toBe('upstream.invalid-response');
    });
  });

  describe('/singer/similar', () => {
    it('reads similar singers', async () => {
      const result = await call(`/singer/similar?mid=${MID}`);

      expect(result.status).toBe(200);
      expect(result.body).toEqual({
        code: 200,
        singers: [1, 2].map((index) => ({
          id: 600 + index,
          mid: `fixtureSimilar${index}`,
          name: `Fixture similar ${index}`,
          pic: `https://fixture.invalid/similar-${index}.jpg`,
        })),
      });
      expectAnonymous();
      expect(recorded[0].rpcs[0]).toEqual({
        module: 'music.SimilarSingerSvr',
        method: 'GetSimilarSingerList',
        param: { singerMid: MID, number: 10 },
      });
    });

    it.each([
      ['a null list', { ...SIMILAR, singerlist: null }, 422, 'resource.not-found'],
      ['an empty list', { ...SIMILAR, singerlist: [] }, 422, 'resource.not-found'],
      ['a non-list', { ...SIMILAR, singerlist: 1 }, 502, 'upstream.invalid-response'],
      [
        'no readable singer',
        { ...SIMILAR, singerlist: [similarSinger(3, { singerMid: '' })] },
        502,
        'upstream.invalid-response',
      ],
    ])('answers for %s', async (_label, data, status, errorKey) => {
      replies.GetSimilarSingerList = { data };

      const result = await call(`/singer/similar?mid=${MID}`);

      expect(result.status).toBe(status);
      expect(result.body.errorKey).toBe(errorKey);
    });
  });

  describe('/singer/songs', () => {
    it('reads one page of songs in the upstream format', async () => {
      const result = await call(`/singer/songs?mid=${MID}`);

      expect(result.status).toBe(200);
      expect(result.body).toEqual({
        code: 200,
        songs: [track(701), track(702)],
        total: 45,
        more: true,
      });
      expectAnonymous();
      expect(recorded[0].rpcs[0]).toEqual({
        module: 'musichall.song_list_server',
        method: 'GetSingerSongList',
        param: { singerMid: MID, order: 1, number: 30, begin: 0 },
      });
    });

    it('cuts the page to limit because the upstream does not honour number', async () => {
      const result = await call(`/singer/songs?mid=${MID}&offset=44&limit=1`);

      expect(recorded[0].rpcs[0].param).toEqual({
        singerMid: MID,
        order: 1,
        number: 1,
        begin: 44,
      });
      expect(result.body.songs).toEqual([track(701)]);
      expect(result.body.more).toBe(false);
    });

    it('keeps limit at 30 and skips entries without a song', async () => {
      replies.GetSingerSongList = {
        data: {
          ...SONGS,
          songList: [
            { songInfo: null },
            { songInfo: { id: 1, mid: '' } },
            { songInfo: track(703) },
          ],
        },
      };

      const result = await call(`/singer/songs?mid=${MID}&limit=100`);

      expect(recorded[0].rpcs[0].param.number).toBe(30);
      expect(result.body.songs).toEqual([track(703)]);
    });

    it.each([
      ['no songs', { ...SONGS, songList: [] }, 422, 'resource.not-found'],
      ['a non-list', { ...SONGS, songList: {} }, 502, 'upstream.invalid-response'],
      [
        'no readable song',
        { ...SONGS, songList: [{ songInfo: null }] },
        502,
        'upstream.invalid-response',
      ],
    ])('answers for %s', async (_label, data, status, errorKey) => {
      replies.GetSingerSongList = { data };

      const result = await call(`/singer/songs?mid=${MID}`);

      expect(result.status).toBe(status);
      expect(result.body.errorKey).toBe(errorKey);
    });
  });

  describe('/singer/mvs', () => {
    it('reads one page of MVs and flattens them', async () => {
      const result = await call(`/singer/mvs?mid=${MID}&offset=20&limit=5`);

      expect(result.status).toBe(200);
      expect(result.body).toEqual({
        code: 200,
        mvs: [flatMv(1), flatMv(2)],
        total: 25,
        more: true,
      });
      expectAnonymous();
      expect(recorded[0].rpcs[0]).toEqual({
        module: 'MvService.MvInfoProServer',
        method: 'GetSingerMvList',
        param: { singermid: MID, order: 1, count: 5, start: 20 },
      });
    });

    it('uses 20 per page by default, at most 40, and skips MVs without a vid', async () => {
      replies.GetSingerMvList = {
        data: { list: [mv(3, { vid: '' }), mv(4, { picurl: '', playcnt: 'x' })], total: 2 },
      };

      const result = await call(`/singer/mvs?mid=${MID}&limit=99`);

      expect(recorded[0].rpcs[0].param).toMatchObject({ count: 40, start: 0 });
      expect(result.body.mvs).toEqual([
        {
          vid: 'fixturevid4',
          title: 'Fixture MV 4',
          id: 904,
          duration: 204,
          publishTime: 1700000004,
        },
      ]);
      expect(result.body.more).toBe(false);
    });

    it.each([
      ['no MVs', { list: [], total: 0 }, 422, 'resource.not-found'],
      ['a non-list', { list: 'x' }, 502, 'upstream.invalid-response'],
      ['no readable MV', { list: [mv(5, { vid: 5 })] }, 502, 'upstream.invalid-response'],
    ])('answers for %s', async (_label, data, status, errorKey) => {
      replies.GetSingerMvList = { data };

      const result = await call(`/singer/mvs?mid=${MID}`);

      expect(result.status).toBe(status);
      expect(result.body.errorKey).toBe(errorKey);
    });
  });

  describe.each([
    'detail',
    'homepage',
    'similar',
    'songs',
    'mvs',
  ])('/singer/%s shared rules', (name) => {
    it.each([
      '',
      '?mid=',
      '?mid=bad-mid!',
      `?mid=${'a'.repeat(33)}`,
    ])('answers 400 without asking the upstream for %s', async (query) => {
      const result = await call(`/singer/${name}${query}`);

      expect(result.status).toBe(400);
      expect(recorded).toHaveLength(0);
    });

    it('an unknown business code becomes 502 and keeps the number', async () => {
      for (const reply of Object.values(replies)) {
        reply.code = 1101;
        reply.data = {};
      }

      const result = await call(`/singer/${name}?mid=${MID}`);

      expect(result.status).toBe(502);
      expect(result.body).toMatchObject({ errorKey: 'upstream.unknown', upstreamCode: 1101 });
    });

    it('answers 502 without the error page when the upstream HTTP request fails', async () => {
      for (const reply of Object.values(replies)) reply.httpStatus = 503;

      const result = await call(`/singer/${name}?mid=${MID}`);

      expect(result.status).toBe(502);
      expect(JSON.stringify(result.body)).not.toContain('fixture-private-error-page');
    });
  });
});
