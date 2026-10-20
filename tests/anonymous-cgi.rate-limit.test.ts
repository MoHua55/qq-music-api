import { defaultTokenBucket } from '../src/protocol/tokenBucket';
import { readAnonymousCgi } from '../src/services/catalog/anonymous';

// 匿名旧 CGI 和 musicu 共用同一个进程内令牌桶：每发一次请求取一个令牌，
// 不能因为走的是另一条 HTTP 路径就绕过限流。
describe('匿名旧 CGI 经过限流', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('每次读取先从共用令牌桶取一个令牌，再发请求', async () => {
    const order: string[] = [];
    jest.spyOn(defaultTokenBucket, 'acquire').mockImplementation(async () => {
      order.push('acquire');
    });
    jest.spyOn(global, 'fetch').mockImplementation(async () => {
      order.push('fetch');
      return Response.json({ code: 0, data: {} });
    });

    await readAnonymousCgi('/splcloud/fcgi-bin/fixture.fcg', { id: 1 }, 'search.match');
    await readAnonymousCgi('/splcloud/fcgi-bin/fixture.fcg', { id: 2 }, 'search.match');

    expect(order).toEqual(['acquire', 'fetch', 'acquire', 'fetch']);
  });

  it('等令牌的时间也算在 25 秒截止时间里，取不到令牌就不发请求', async () => {
    jest.useFakeTimers();
    try {
      jest
        .spyOn(defaultTokenBucket, 'acquire')
        .mockImplementation(() => new Promise<void>(() => {}));
      const fetch = jest.spyOn(global, 'fetch');

      const pending = readAnonymousCgi('/splcloud/fcgi-bin/fixture.fcg', {}, 'search.match');
      const outcome = pending.then(
        () => 'resolved',
        (error: { errorKey?: string }) => error.errorKey,
      );
      await jest.advanceTimersByTimeAsync(25000);

      await expect(outcome).resolves.toBe('network.timeout');
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });
});
