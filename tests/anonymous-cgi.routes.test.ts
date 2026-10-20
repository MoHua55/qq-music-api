import { readAnonymousCgi } from '../src/services/catalog/anonymous';

describe('匿名 CGI 传输边界', () => {
  const read = () => readAnonymousCgi('/fixture', {}, 'search.suggest');
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('总预算耗尽标为 timeout，不误报调用者取消', async () => {
    jest.useFakeTimers();
    jest.spyOn(global, 'fetch').mockImplementation(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('fixture-private', 'AbortError')),
          );
        }),
    );
    const pending = expect(read()).rejects.toMatchObject({
      kind: 'network',
      errorKey: 'network.timeout',
    });
    await jest.advanceTimersByTimeAsync(25000);
    await pending;
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('读取正文失败也只交出网络错误', async () => {
    const response = new Response('{}');
    jest.spyOn(response, 'arrayBuffer').mockRejectedValue(new TypeError('fixture-private'));
    jest.spyOn(global, 'fetch').mockResolvedValue(response);
    await expect(read()).rejects.toMatchObject({ kind: 'network' });
  });

  it('UTF-8 以外的旧中文 JSON 使用明确的字元集解码', async () => {
    const prefix = new TextEncoder().encode('{"code":0,"data":{"text":"');
    const suffix = new TextEncoder().encode('"}}');
    const bytes = new Uint8Array([...prefix, 0xd6, 0xd0, 0xce, 0xc4, ...suffix]);
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(bytes));
    expect(await read()).toEqual({ code: 0, data: { text: '中文' } });
  });

  it.each([301, 302, 307, 308])('不跟随 HTTP %i，也不读取转址正文', async (status) => {
    const response = new Response('fixture-private', {
      status,
      headers: { Location: 'https://fixture.invalid/redirect' },
    });
    const text = jest.spyOn(response, 'arrayBuffer');
    jest.spyOn(global, 'fetch').mockResolvedValue(response);
    await expect(read()).rejects.toMatchObject({
      kind: 'upstream-http',
      upstreamHttpStatus: status,
    });
    expect(text).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    null,
    [],
    {},
    { code: '0' },
    { code: 0.5 },
    { code: 0, subcode: '0' },
  ])('拒绝错误回包结构 %j', async (body) => {
    jest.spyOn(global, 'fetch').mockResolvedValue(Response.json(body));
    await expect(read()).rejects.toMatchObject({ kind: 'invalid-response' });
  });

  it('HTTP 错误优先于正文，Retry-After 只接受数字', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response('{"code":1000}', {
        status: 429,
        headers: { 'Retry-After': 'Wed, 01 Jan 2025 00:00:00 GMT' },
      }),
    );
    await expect(read()).rejects.toMatchObject({ kind: 'rate-limited', upstreamHttpStatus: 429 });
  });
});
