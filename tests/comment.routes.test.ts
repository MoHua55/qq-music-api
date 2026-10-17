import request from 'supertest';
import app from '../src/app';
import { handleRequest } from '../src/serverless';
import { logger } from '../src/util/logger';

// 歌曲评论：热评、新评、评论数，都是公开内容，匿名读。Node 与 serverless 跑同一份案例，只替换对外的 fetch。
// 结构按 2026-10 实测整理（`CommentRead.GetHotCommentList`／`GetNewCommentList` → `CommentList.Comments[]`，
// `CommentCountSrv.GetCmCount` 成功时回 10000），昵称、内容与 id 都是假数据。

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

const SONG_ID = '4242';

const comment = (index: number, overrides: Record<string, unknown> = {}) => ({
  Avatar: `https://fixture.invalid/avatar-${index}.jpg`,
  CmId: `fixture-comment-${index}`,
  Nick: `Fixture nick ${index}`,
  PraiseNum: 10 + index,
  PubTime: 1700000000 + index,
  EncryptUin: `fixture-user-${index}`,
  Content: `Fixture content ${index}`,
  ReplyCnt: index,
  Location: 'Fixture place',
  SeqNo: `fixture-seq-${index}`,
  SongId: 4242,
  ...overrides,
});
const flat = (index: number) => ({
  id: `fixture-comment-${index}`,
  content: `Fixture content ${index}`,
  nick: `Fixture nick ${index}`,
  avatar: `https://fixture.invalid/avatar-${index}.jpg`,
  praiseCount: 10 + index,
  time: 1700000000 + index,
  replyCount: index,
  location: 'Fixture place',
});
const page = (comments: unknown, overrides: Record<string, unknown> = {}) => ({
  AllowComment: 1,
  TotalCmNum: 99,
  CommentList: {
    Comments: comments,
    HasMore: 1,
    Total: 40,
    NextOffset: 15,
    ListType: 0,
    CommentIds: [],
    ...overrides,
  },
  CommentList2: { Comments: [comment(90)] },
});

describe.each(['node', 'serverless'] as const)('comment routes: %s', (runtime) => {
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
      new Request(`https://comment.invalid${path}`, { headers }),
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
      GetHotCommentList: { data: page([comment(1), comment(2)]) },
      GetNewCommentList: { data: page([comment(3), comment(4)]) },
      GetCmCount: {
        code: 10000,
        data: { response: { biz_type: 1, biz_id: SONG_ID, count: 1234 }, cmTabType: 0 },
      },
    };
  });

  afterEach(() => jest.restoreAllMocks());

  const expectAnonymous = () => {
    expect(recorded).toHaveLength(1);
    expect(recorded[0].comm).toEqual({ ct: 24, cv: 0 });
    expect(recorded[0].cookie).toBeNull();
    expect(recorded[0].rpcs).toHaveLength(1);
  };

  describe('/comment/hot', () => {
    it('reads the first page of hot comments anonymously, even with a session token', async () => {
      const result = await call(`/comment/hot?id=${SONG_ID}`, { 'X-QQ-Session': 'b'.repeat(64) });

      expect(result.status).toBe(200);
      expect(result.body).toEqual({
        code: 200,
        comments: [flat(1), flat(2)],
        total: 40,
        more: true,
      });
      expectAnonymous();
      expect(recorded[0].rpcs[0]).toEqual({
        module: 'music.globalComment.CommentRead',
        method: 'GetHotCommentList',
        param: {
          BizType: 1,
          BizId: SONG_ID,
          LastCommentSeqNo: '',
          PageSize: 20,
          PageNum: 0,
          HotType: 1,
          WithAirborne: 0,
          PicEnable: 1,
        },
      });
    });

    it('maps offset and limit onto upstream pages', async () => {
      await call(`/comment/hot?id=${SONG_ID}&offset=60&limit=30`);

      expect(recorded[0].rpcs[0].param).toMatchObject({ PageSize: 30, PageNum: 2 });
    });

    it('keeps limit at 50 and reads offsets that are not whole pages from the page they fall in', async () => {
      await call(`/comment/hot?id=${SONG_ID}&offset=70&limit=99`);

      expect(recorded[0].rpcs[0].param).toMatchObject({ PageSize: 50, PageNum: 1 });
    });
  });

  describe('/comment/new', () => {
    it('reads the newest comments without the hot list mixed in', async () => {
      const result = await call(`/comment/new?id=${SONG_ID}`);

      expect(result.status).toBe(200);
      expect(result.body).toEqual({
        code: 200,
        comments: [flat(3), flat(4)],
        total: 40,
        more: true,
      });
      expectAnonymous();
      expect(recorded[0].rpcs[0]).toEqual({
        module: 'music.globalComment.CommentRead',
        method: 'GetNewCommentList',
        param: {
          BizType: 1,
          BizId: SONG_ID,
          LastCommentSeqNo: '',
          PageSize: 20,
          PageNum: 0,
          FromCommentId: '',
          WithHot: 0,
          PicEnable: 1,
        },
      });
    });

    it('leaves out empty optional fields, skips comments without an id and reads HasMore 0 as no more', async () => {
      replies.GetNewCommentList = {
        data: page(
          [
            comment(5, { CmId: '' }),
            null,
            comment(6, { Avatar: '', ReplyCnt: -1, Location: '', PraiseNum: 'x' }),
          ],
          { HasMore: 0, Total: 'x' },
        ),
      };

      const result = await call(`/comment/new?id=${SONG_ID}`);

      expect(result.status).toBe(200);
      expect(result.body).toEqual({
        code: 200,
        comments: [
          {
            id: 'fixture-comment-6',
            content: 'Fixture content 6',
            nick: 'Fixture nick 6',
            time: 1700000006,
          },
        ],
        more: false,
      });
    });
  });

  describe.each(['hot', 'new'])('/comment/%s shared answers', (kind) => {
    const method = kind === 'hot' ? 'GetHotCommentList' : 'GetNewCommentList';

    it.each([
      ['no comments', page([]), 422, 'resource.not-found'],
      ['no comment list', { AllowComment: 1 }, 422, 'resource.not-found'],
      ['a non-list', page({}), 502, 'upstream.invalid-response'],
      ['no readable comment', page([comment(7, { CmId: 7 })]), 502, 'upstream.invalid-response'],
    ])('answers for %s', async (_label, data, status, errorKey) => {
      replies[method] = { data };

      const result = await call(`/comment/${kind}?id=${SONG_ID}`);

      expect(result.status).toBe(status);
      expect(result.body.errorKey).toBe(errorKey);
    });
  });

  describe('/comment/count', () => {
    it('reads the count and treats code 10000 as success', async () => {
      const result = await call(`/comment/count?id=${SONG_ID}`);

      expect(result.status).toBe(200);
      expect(result.body).toEqual({ code: 200, id: 4242, count: 1234 });
      expectAnonymous();
      expect(recorded[0].rpcs[0]).toEqual({
        module: 'music.globalComment.CommentCountSrv',
        method: 'GetCmCount',
        param: { biz_id: SONG_ID, biz_type: 1 },
      });
    });

    it('also accepts code 0', async () => {
      replies.GetCmCount = { data: { response: { count: 0 } } };

      const result = await call(`/comment/count?id=${SONG_ID}`);

      expect(result.body).toEqual({ code: 200, id: 4242, count: 0 });
    });

    it.each([
      ['no response', {}],
      ['a count that is not a whole number', { response: { count: '12' } }],
    ])('answers 502 for %s', async (_label, data) => {
      replies.GetCmCount = { code: 10000, data };

      const result = await call(`/comment/count?id=${SONG_ID}`);

      expect(result.status).toBe(502);
      expect(result.body.errorKey).toBe('upstream.invalid-response');
    });
  });

  describe.each(['hot', 'new', 'count'])('/comment/%s shared rules', (kind) => {
    it.each([
      '',
      '?id=',
      '?id=abc',
      '?id=0',
      '?id=-3',
      `?id=${'9'.repeat(16)}`,
    ])('answers 400 without asking the upstream for %s', async (query) => {
      const result = await call(`/comment/${kind}${query}`);

      expect(result.status).toBe(400);
      expect(recorded).toHaveLength(0);
    });

    it('an unknown business code becomes 502 and keeps the number', async () => {
      for (const reply of Object.values(replies)) {
        reply.code = 1101;
        reply.data = {};
      }

      const result = await call(`/comment/${kind}?id=${SONG_ID}`);

      expect(result.status).toBe(502);
      expect(result.body).toMatchObject({ errorKey: 'upstream.unknown', upstreamCode: 1101 });
    });

    it('answers 502 without the error page when the upstream HTTP request fails', async () => {
      for (const reply of Object.values(replies)) reply.httpStatus = 503;

      const result = await call(`/comment/${kind}?id=${SONG_ID}`);

      expect(result.status).toBe(502);
      expect(JSON.stringify(result.body)).not.toContain('fixture-private-error-page');
    });
  });
});
