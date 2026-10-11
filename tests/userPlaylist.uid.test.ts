import type { AxiosResponse } from 'axios';
import { createAndroidDevice } from '../src/services/auth/androidDevice';
import type { AuthHttpClient } from '../src/services/auth/httpClient';
import {
  type AuthSession,
  createQrLoginService,
  type SessionResolver,
} from '../src/services/auth/qrLogin';
import { RequestRejectedError } from '../src/util/requestError';

// /user/playlist 的 uid 只支持登录账号本身。以前传别人的 uid 时，自建歌单读的是别人的、
// 收藏歌单读的却是登录者的，两个账号的歌单混在一起。现在别人的 uid 直接回 400，不打上游。

const TOKEN = 'fixture-session-token';

const response = <T>(data: T): AxiosResponse<T> => ({
  data,
  status: 200,
  statusText: 'OK',
  headers: {} as AxiosResponse<T>['headers'],
  config: { headers: {} } as AxiosResponse<T>['config'],
});

const createHarness = (credential: Record<string, unknown>) => {
  const calls: Array<{ method: string; param: Record<string, any> }> = [];
  const post = jest.fn(async <T>(_url: string, payload?: unknown) => {
    const request = (payload as { req_0: { method: string; param: any } }).req_0;
    calls.push({ method: request.method, param: request.param });
    if (request.method === 'GetPlaylistByUin')
      return response({
        code: 0,
        req_0: { code: 0, data: { v_playlist: [{ tid: 1 }] } },
      }) as AxiosResponse<T>;
    if (request.method === 'CgiGetPlaylistFavInfo')
      return response({
        code: 0,
        req_0: { code: 0, data: { v_list: [], hasmore: 0 } },
      }) as AxiosResponse<T>;
    throw new Error(`Unexpected method: ${request.method}`);
  });
  const http = { getCookieHeader: () => '', request: jest.fn(), post } as unknown as AuthHttpClient;
  const session: AuthSession = {
    token: TOKEN,
    credential: {
      musickey: 'fixture-musickey',
      loginType: 2,
      encryptUin: 'fixture-encrypt-uin',
      ...credential,
    } as unknown as AuthSession['credential'],
    device: createAndroidDevice(),
    expiresAt: Date.now() + 3_600_000,
  };
  const sessionResolver: SessionResolver = {
    mode: 'stored',
    issue: async () => TOKEN,
    resolve: async (token) => (token === TOKEN ? session : null),
    revoke: async () => undefined,
  };
  const service = createQrLoginService({ http, sessionResolver });
  const createdUin = () => calls.find((call) => call.method === 'GetPlaylistByUin')?.param.uin;
  return { service, calls, createdUin };
};

describe('/user/playlist only reads the logged-in account', () => {
  it.each([
    ['no uid', undefined],
    ['the account id', '42'],
  ])('reads the logged-in account for %s', async (_label, uid) => {
    const { service, createdUin } = createHarness({ musicid: '42', str_musicid: '42' });

    await expect(service.getUserPlaylists(TOKEN, uid)).resolves.toMatchObject({ bFinish: true });
    expect(createdUin()).toBe('42');
  });

  it('accepts the placeholder id a WeChat credential carries and reads the real account', async () => {
    const { service, createdUin } = createHarness({ musicid: 0, str_musicid: '456' });

    await service.getUserPlaylists(TOKEN, '0');

    expect(createdUin()).toBe('456');
  });

  it("rejects another account's uid before any upstream call", async () => {
    const { service, calls } = createHarness({ musicid: '42', str_musicid: '42' });

    const failure = await service.getUserPlaylists(TOKEN, '99').catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(RequestRejectedError);
    expect(failure).toMatchObject({
      httpStatus: 400,
      message: 'uid must be the logged-in account',
    });
    expect(calls).toEqual([]);
  });

  it('still answers no session before looking at the uid', async () => {
    const { service, calls } = createHarness({ musicid: '42' });

    await expect(service.getUserPlaylists('unknown-token', '99')).resolves.toBeNull();
    expect(calls).toEqual([]);
  });
});
