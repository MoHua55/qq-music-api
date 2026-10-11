import type { QrLoginService } from '../src/services/auth/qrLogin';

// /user/playlist 的续读参数与回应：Node 与 serverless 用同一份案例。
// 只替换登录服务，路由解析参数、转发与组装回应都是真实代码。

const mockGetUserPlaylists = jest.fn();
const mockService = { getUserPlaylists: mockGetUserPlaylists } as unknown as QrLoginService;

jest.mock('../src/services/auth/qrLogin.node', () => ({
  __esModule: true,
  default: mockService,
  qrLoginService: mockService,
  configureAuthSessionRepository: () => undefined,
}));
jest.mock('../src/services/auth/qrLogin', () => ({
  ...jest.requireActual('../src/services/auth/qrLogin'),
  createQrLoginService: () => mockService,
}));

import request from 'supertest';
import app from '../src/app';
import { handleRequest } from '../src/serverless';

const server = app.callback();
const TOKEN = 'fixture-session-token';

const call = async (runtime: 'node' | 'serverless', query: string) => {
  const path = `/user/playlist?cookie=qqmusic_session=${TOKEN}${query}`;
  if (runtime === 'node') {
    const response = await request(server).get(path);
    return { status: response.status, body: response.body };
  }
  const response = await handleRequest(new Request(`https://worker.invalid${path}`), {
    QQ_SESSION_SECRET: 'fixture-deployment-secret',
  });
  return { status: response.status, body: await response.json() };
};

const playlists = [
  { tid: 1, dirName: '自建' },
  { tid: 2, name: '收藏' },
];

describe.each(['node', 'serverless'] as const)('GET /user/playlist (%s)', (runtime) => {
  beforeEach(() => {
    mockGetUserPlaylists.mockReset();
  });

  it('keeps the existing response and call when no favoriteOffset is sent', async () => {
    mockGetUserPlaylists.mockResolvedValue({ v_playlist: playlists, total: 2, bFinish: true });

    const result = await call(runtime, '');

    expect(result).toEqual({
      status: 200,
      body: { code: 200, playlist: playlists, total: 2, more: false },
    });
    expect(mockGetUserPlaylists).toHaveBeenCalledWith(TOKEN, undefined, undefined);
  });

  it('reports the real total and where to continue when the list was cut at the limit', async () => {
    mockGetUserPlaylists.mockResolvedValue({
      v_playlist: playlists,
      total: 1501,
      bFinish: false,
      nextFavoriteOffset: 1000,
    });

    const result = await call(runtime, '');

    expect(result.body).toEqual({
      code: 200,
      playlist: playlists,
      total: 1501,
      more: true,
      nextFavoriteOffset: 1000,
    });
  });

  it('forwards favoriteOffset to continue reading favourites', async () => {
    mockGetUserPlaylists.mockResolvedValue({ v_playlist: playlists, total: 1501, bFinish: true });

    const result = await call(runtime, '&favoriteOffset=1000');

    expect(result.status).toBe(200);
    expect(mockGetUserPlaylists).toHaveBeenCalledWith(TOKEN, undefined, { favoriteOffset: 1000 });
  });

  it.each([
    '&favoriteOffset=0',
    '&favoriteOffset=-5',
    '&favoriteOffset=abc',
  ])('treats %s like the first round, as other offset parameters do', async (query) => {
    mockGetUserPlaylists.mockResolvedValue({ v_playlist: playlists, total: 2, bFinish: true });

    await call(runtime, query);

    expect(mockGetUserPlaylists).toHaveBeenCalledWith(TOKEN, undefined, undefined);
  });

  it('still answers 401 without a usable session', async () => {
    mockGetUserPlaylists.mockResolvedValue(null);

    const result = await call(runtime, '&favoriteOffset=1000');

    expect(result).toEqual({ status: 401, body: { code: 401, message: 'Login required' } });
  });
});
