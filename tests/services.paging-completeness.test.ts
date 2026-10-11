import type { AxiosResponse } from 'axios';
import { createAndroidDevice } from '../src/services/auth/androidDevice';
import type { AuthHttpClient } from '../src/services/auth/httpClient';
import {
  type AuthSession,
  createQrLoginService,
  type SessionResolver,
} from '../src/services/auth/qrLogin';
import { toSongListDetailResponse } from '../src/services/songLists/officialPlaylist';

// 分页读取的安全上限要保留，但读到上限、空页、重复页时，不能再把结果说成“已经读完”。
// 上游回应全是合成数据。

const TOKEN = 'fixture-session-token';

const envelope = (data: unknown) => ({ code: 0, req_0: { code: 0, data } });

const response = <T>(data: T): AxiosResponse<T> => ({
  data,
  status: 200,
  statusText: 'OK',
  headers: {} as AxiosResponse<T>['headers'],
  config: { headers: {} } as AxiosResponse<T>['config'],
});

type Page = Record<string, unknown>;

interface Upstream {
  favorites?: (param: { offset: number; size: number }) => Page;
  diss?: (param: { song_begin: number; song_num: number; disstid: number }) => Page;
  encryptUin?: string | undefined;
}

const createHarness = (upstream: Upstream) => {
  const calls: Array<{ method: string; param: Record<string, any> }> = [];
  const post = jest.fn(async <T>(_url: string, payload?: unknown) => {
    const request = (payload as { req_0: { method: string; param: any } }).req_0;
    calls.push({ method: request.method, param: request.param });
    if (request.method === 'GetPlaylistByUin')
      return response(
        envelope({ v_playlist: [{ tid: 1, dirId: 201, dirName: '我喜欢' }] }),
      ) as AxiosResponse<T>;
    if (request.method === 'CgiGetPlaylistFavInfo' && upstream.favorites)
      return response(envelope(upstream.favorites(request.param))) as AxiosResponse<T>;
    if (request.method === 'uniform_get_Dissinfo' && upstream.diss)
      return response(envelope(upstream.diss(request.param))) as AxiosResponse<T>;
    throw new Error(`Unexpected method: ${request.method}`);
  });
  const http = { getCookieHeader: () => '', request: jest.fn(), post } as unknown as AuthHttpClient;
  const session: AuthSession = {
    token: TOKEN,
    credential: {
      musicid: '42',
      musickey: 'fixture-musickey',
      loginType: 1,
      ...('encryptUin' in upstream
        ? { encryptUin: upstream.encryptUin }
        : { encryptUin: 'fixture-encrypt-uin' }),
    },
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
  const callsOf = (method: string) => calls.filter((call) => call.method === method);
  return { service, callsOf };
};

const favoriteItems = (from: number, count: number) =>
  Array.from({ length: count }, (_, i) => ({
    tid: 100000 + from + i,
    name: `收藏歌单 ${from + i}`,
  }));

/** 每页最多 `size` 条、实际共 `actual` 条的收藏歌单；`hasmore` 可以另给，模拟上游自相矛盾。 */
const pagedFavorites =
  (actual: number, options: { hasmore?: (offset: number) => unknown } = {}) =>
  ({ offset, size }: { offset: number; size: number }) => {
    const count = Math.max(0, Math.min(size, actual - offset));
    return {
      v_list: favoriteItems(offset, count),
      total: actual,
      hasmore: options.hasmore ? options.hasmore(offset) : +(offset + size < actual),
    };
  };

describe('/user/playlist 收藏歌单的完整性', () => {
  const read = async (upstream: Upstream) => {
    const harness = createHarness(upstream);
    const data = await harness.service.getUserPlaylists(TOKEN);
    const offsets = harness.callsOf('CgiGetPlaylistFavInfo').map((call) => call.param.offset);
    return { data, offsets, playlists: (data?.v_playlist as unknown[]) ?? [] };
  };

  it('上游说读完了就是完整的', async () => {
    const { data, offsets, playlists } = await read({ favorites: pagedFavorites(130) });

    expect(offsets).toEqual([0, 100]);
    expect(playlists).toHaveLength(1 + 130);
    expect(data).toMatchObject({ total: 131, bFinish: true });
  });

  it('上游说还有更多也是用布尔值时同样认得', async () => {
    const { data, offsets } = await read({
      favorites: pagedFavorites(130, { hasmore: (offset) => offset === 0 }),
    });

    expect(offsets).toEqual([0, 100]);
    expect(data).toMatchObject({ bFinish: true });
  });

  it('一个收藏都没有时是完整的', async () => {
    const { data, offsets, playlists } = await read({ favorites: pagedFavorites(0) });

    expect(offsets).toEqual([0]);
    expect(playlists).toHaveLength(1);
    expect(data).toMatchObject({ total: 1, bFinish: true });
  });

  it('读到 1000 条的安全上限、上游还说有更多时，不算读完', async () => {
    const { data, offsets, playlists } = await read({ favorites: pagedFavorites(1500) });

    // 上限不变：仍然最多读 10 页、1000 条
    expect(offsets).toEqual([0, 100, 200, 300, 400, 500, 600, 700, 800, 900]);
    expect(playlists).toHaveLength(1 + 1000);
    expect(data).toMatchObject({ total: 1001, bFinish: false });
  });

  it('上游一直说还有更多、每页只给几条时，同样停在上限并标成没读完', async () => {
    const { data, offsets } = await read({
      favorites: ({ offset }) => ({ v_list: favoriteItems(offset, 50), hasmore: 1 }),
    });

    expect(offsets).toHaveLength(20);
    expect(offsets.at(-1)).toBe(950);
    expect(data).toMatchObject({ total: 1001, bFinish: false });
  });

  it('上游说还有、但这一页是空的：停下，不算读完', async () => {
    const { data, offsets, playlists } = await read({
      favorites: pagedFavorites(100, { hasmore: () => 1 }),
    });

    expect(offsets).toEqual([0, 100]);
    expect(playlists).toHaveLength(1 + 100);
    expect(data).toMatchObject({ bFinish: false });
  });

  it('上游不理 offset、一直回同一页：第二页没有新条目就停，不算读完', async () => {
    const { data, offsets, playlists } = await read({
      favorites: () => ({ v_list: favoriteItems(0, 100), hasmore: 1 }),
    });

    expect(offsets).toEqual([0, 100]);
    expect(playlists).toHaveLength(1 + 100);
    expect(data).toMatchObject({ total: 101, bFinish: false });
  });

  it('凭证里没有 encryptUin 时不读收藏，回应形状与以前相同', async () => {
    const { data, offsets } = await read({ encryptUin: undefined, favorites: pagedFavorites(10) });

    expect(offsets).toEqual([]);
    expect(data).toMatchObject({ total: 1, bFinish: true });
  });
});

/** 每页 `size` 首、实际共 `actual` 首的官方歌单；`hasmore` 与 `total_song_num` 可以另给。 */
const pagedDiss =
  (
    actual: number,
    size: number,
    options: { hasmore?: (begin: number) => unknown; reportedTotal?: number | null } = {},
  ) =>
  ({ song_begin, disstid }: { song_begin: number; disstid: number }) => {
    const count = Math.max(0, Math.min(size, actual - song_begin));
    return {
      dirinfo: { id: disstid, title: '分页歌单' },
      songlist: Array.from({ length: count }, (_, i) => ({ mid: `song-${song_begin + i}` })),
      ...(options.reportedTotal === null
        ? {}
        : { total_song_num: options.reportedTotal ?? actual }),
      hasmore: options.hasmore ? options.hasmore(song_begin) : +(song_begin + size < actual),
    };
  };

describe('带凭据读官方歌单的完整性', () => {
  const read = async (diss: Upstream['diss']) => {
    const harness = createHarness({ diss });
    const data = await harness.service.getAuthenticatedSongListDetail(TOKEN, 7);
    const begins = harness.callsOf('uniform_get_Dissinfo').map((call) => call.param.song_begin);
    return { data, begins, songs: (data?.songlist as unknown[]) ?? [] };
  };

  it('读完整张歌单时 hasmore 为 0', async () => {
    const { data, begins, songs } = await read(pagedDiss(2500, 1000));

    expect(begins).toEqual([0, 1000, 2000]);
    expect(songs).toHaveLength(2500);
    expect(data).toMatchObject({ hasmore: 0 });
  });

  it('已经读满 total_song_num 就停，即使上游还说有更多，也算读完', async () => {
    const { data, begins, songs } = await read(pagedDiss(4, 2, { hasmore: () => 1 }));

    expect(begins).toEqual([0, 2]);
    expect(songs).toHaveLength(4);
    expect(data).toMatchObject({ hasmore: 0 });
  });

  it('读到 10 页的安全上限、上游还说有更多时，标成没读完', async () => {
    const { data, begins, songs } = await read(pagedDiss(1_000_000, 1000, { hasmore: () => 1 }));

    expect(begins).toHaveLength(10);
    expect(songs).toHaveLength(10_000);
    expect(data).toMatchObject({ hasmore: 1, total_song_num: 1_000_000 });
  });

  it('上游说还有、但这一页是空的：停下，标成没读完', async () => {
    const { data, begins, songs } = await read(
      pagedDiss(1000, 1000, { hasmore: () => 1, reportedTotal: 1500 }),
    );

    expect(begins).toEqual([0, 1000]);
    expect(songs).toHaveLength(1000);
    expect(data).toMatchObject({ hasmore: 1 });
  });

  it('上游不理 song_begin、一直回同一页：不把重复的歌接上去，停下并标成没读完', async () => {
    const samePage = () => ({
      dirinfo: { id: 7, title: '分页歌单' },
      songlist: Array.from({ length: 1000 }, (_, i) => ({ mid: `song-${i}` })),
      total_song_num: 5000,
      hasmore: 1,
    });
    const { data, begins, songs } = await read(samePage);

    expect(begins).toEqual([0, 1000]);
    expect(songs).toHaveLength(1000);
    expect(data).toMatchObject({ hasmore: 1 });
  });

  it('认不出身份的歌不拿来判断重复页', async () => {
    const anonymousSongs = ({ song_begin }: { song_begin: number }) => ({
      dirinfo: { id: 7, title: '分页歌单' },
      songlist: Array.from({ length: 1000 }, () => ({ name: '没有 mid 的歌' })),
      total_song_num: 3000,
      hasmore: +(song_begin + 1000 < 3000),
    });
    const { data, begins, songs } = await read(anonymousSongs);

    expect(begins).toEqual([0, 1000, 2000]);
    expect(songs).toHaveLength(3000);
    expect(data).toMatchObject({ hasmore: 0 });
  });

  it('上游没给 total_song_num 时只看 hasmore', async () => {
    const { data, begins, songs } = await read(pagedDiss(1500, 1000, { reportedTotal: null }));

    expect(begins).toEqual([0, 1000]);
    expect(songs).toHaveLength(1500);
    expect(data).toMatchObject({ hasmore: 0 });
  });
});

describe('改写成 /getSongListDetail 的形状后，已有的数量字段仍然如实', () => {
  it('没读完时 cur_song_num 小于 total_song_num', () => {
    const converted = toSongListDetailResponse({
      dirinfo: { id: 7, title: '分页歌单' },
      songlist: Array.from({ length: 10 }, (_, i) => ({ mid: `song-${i}` })),
      total_song_num: 25,
      hasmore: 1,
    });

    expect(converted?.code).toBe(0);
    expect(converted?.cdlist[0]).toMatchObject({
      cur_song_num: 10,
      total_song_num: 25,
      songnum: 25,
    });
  });

  it('读完时两者相等', () => {
    const converted = toSongListDetailResponse({
      dirinfo: { id: 7, title: '分页歌单' },
      songlist: Array.from({ length: 10 }, (_, i) => ({ mid: `song-${i}` })),
      total_song_num: 10,
      hasmore: 0,
    });

    expect(converted?.cdlist[0]).toMatchObject({ cur_song_num: 10, total_song_num: 10 });
  });
});
