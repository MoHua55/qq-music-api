const mockSongListDetail = jest.fn();
const mockGetAuthenticatedSongListDetail = jest.fn();

// 路由改用共用 handler 后，替身跟着实际入口走，原来的参数与认证断言保留。
jest.mock('../src/services/songLists/songListDetail', () => ({
  __esModule: true,
  default: mockSongListDetail,
}));
jest.mock('../src/services/auth/qrLogin.node', () => ({
  __esModule: true,
  default: {
    getAuthenticatedSongListDetail: (token: string, disstid: string) =>
      mockGetAuthenticatedSongListDetail({ token, disstid }),
  },
}));

import request from 'supertest';
import app from '../src/app';

const server = app.callback();

/** controller 交给 service 的那一组参数。 */
const propsOfLastCall = () => mockSongListDetail.mock.calls.at(-1)?.[0];

describe('GET /getSongListDetail', () => {
  beforeEach(() => {
    mockSongListDetail.mockReset();
    mockGetAuthenticatedSongListDetail.mockReset();
    mockSongListDetail.mockResolvedValue({ status: 200, body: { response: { code: 0 } } });
  });

  it('reads disstid from the documented path parameter', async () => {
    await request(server).get('/getSongListDetail/9757480713').expect(200);

    expect(mockSongListDetail).toHaveBeenCalledWith(
      expect.objectContaining({
        params: { disstid: '9757480713' },
      }),
    );
  });

  it('keeps the legacy query parameter compatible', async () => {
    await request(server).get('/getSongListDetail?disstid=7').expect(200);

    expect(mockSongListDetail).toHaveBeenCalledWith(
      expect.objectContaining({
        params: { disstid: '7' },
      }),
    );
  });

  describe('登录会话（只在匿名 CGI 回 code 10 时才会用到）', () => {
    it('没有会话时不提供重读能力', async () => {
      await request(server).get('/getSongListDetail/211192').expect(200);

      expect(propsOfLastCall()).toEqual({
        method: 'get',
        params: { disstid: '211192' },
        option: {},
      });
    });

    it.each([
      ['X-QQ-Session 头', (req: request.Test) => req.set('X-QQ-Session', 'header-token')],
      [
        '?cookie= 参数',
        (req: request.Test) => req.query({ cookie: 'qqmusic_session=header-token' }),
      ],
      ['Cookie 头', (req: request.Test) => req.set('Cookie', 'qqmusic_session=header-token')],
    ])('从 %s 取会话，重读时把 token 与 disstid 交给带凭据的读取', async (_label, withToken) => {
      mockGetAuthenticatedSongListDetail.mockResolvedValue({ dirinfo: { title: 'x' } });

      await withToken(request(server).get('/getSongListDetail/211192')).expect(200);
      const props = propsOfLastCall();

      // 匿名 CGI 的参数不变，会话不会被带进去
      expect(props.params).toEqual({ disstid: '211192' });
      await expect(props.readWithCredential('211192')).resolves.toEqual({
        dirinfo: { title: 'x' },
      });
      expect(mockGetAuthenticatedSongListDetail).toHaveBeenCalledWith({
        token: 'header-token',
        disstid: '211192',
      });
    });

    it('头、参数、Cookie 同时出现时与其他路由一样按 头 > 参数 > Cookie 取', async () => {
      await request(server)
        .get('/getSongListDetail/211192')
        .query({ cookie: 'qqmusic_session=query-token' })
        .set('Cookie', 'qqmusic_session=cookie-token')
        .set('X-QQ-Session', 'header-token')
        .expect(200);
      await propsOfLastCall().readWithCredential('211192');

      await request(server)
        .get('/getSongListDetail/211192')
        .query({ cookie: 'qqmusic_session=query-token' })
        .set('Cookie', 'qqmusic_session=cookie-token')
        .expect(200);
      await propsOfLastCall().readWithCredential('211192');

      expect(mockGetAuthenticatedSongListDetail.mock.calls.map(([args]) => args.token)).toEqual([
        'header-token',
        'query-token',
      ]);
    });
  });
});
