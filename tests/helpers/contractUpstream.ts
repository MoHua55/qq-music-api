import type { AxiosRequestConfig, AxiosResponse } from 'axios';
import type { QqQrRelay, QrEvent } from '../../src/services/auth/qrLogin';

export const CONTRACT_NOW = 1800000000000;
export const CONTRACT_SECRET = 'contract-deployment-secret';
export const CONTRACT_CREDENTIAL = {
  musicid: '10000',
  str_musicid: '10000',
  musickey: 'fixture-private-music-key',
  encryptUin: 'fixture-private-encrypted-uin',
  loginType: 2,
};
export const CONTRACT_SONGS = [
  { mid: 'fixture-song-a', title: 'Fixture song A' },
  { mid: 'fixture-song-b', title: 'Fixture song B' },
  { mid: 'fixture-song-c', title: 'Fixture song C' },
];
export const CONTRACT_PROFILE = {
  musicid: '10000',
  str_musicid: '10000',
  info: { nick: 'Fixture user' },
};
export const CONTRACT_PLAYLISTS = [{ tid: 70001, dirId: 10, dissname: 'Fixture playlist' }];
export const CONTRACT_ALBUMS = [{ album_mid: 'fixture-album', album_name: 'Fixture album' }];
export const CONTRACT_QR_IMAGE = 'data:image/png;base64,iVBORw0KGgoBAgME';

interface RpcCall {
  module: string;
  method: string;
  param: Record<string, any>;
  comm: Record<string, any>;
}

/** One synthetic upstream for both HTTP hosts. An unknown request always fails closed. */
export const createContractUpstream = () => {
  const calls: RpcCall[] = [];
  const requests: URL[] = [];
  const opened: Array<{ id: string; ttl: number }> = [];
  const closed: string[] = [];
  let events: QrEvent[] = [];
  let onEvent: ((event: QrEvent) => void) | undefined;
  const state = {
    credentialCode: 0,
    catalogCode: 0,
    bootstrapStatus: 200,
    wechatCode: 408,
    recommendCode: 0,
    recommendEmpty: false,
  };

  const rpcData = ({ method, param }: RpcCall): unknown => {
    switch (method) {
      case 'GetSession':
        return { session: { uid: 'fixture-session-uid', sid: 'fixture-session-sid' } };
      case 'CreateQRCode':
        return { qrcodeID: 'fixture-qr-id', qrcode: CONTRACT_QR_IMAGE, expiresIn: 180 };
      case 'Login':
        return {
          ...CONTRACT_CREDENTIAL,
          musickeyCreateTime: CONTRACT_NOW / 1000,
          keyExpiresIn: 259200,
        };
      case 'GetLoginUserInfo':
        return { info: { nick: 'Fixture user' }, musickey: CONTRACT_CREDENTIAL.musickey };
      case 'GetPlaylistByUin':
        return { v_playlist: CONTRACT_PLAYLISTS, bFinish: true };
      case 'CgiGetPlaylistFavInfo':
        return { v_list: [], hasmore: 0 };
      case 'CgiGetDiss':
        return {
          songlist: CONTRACT_SONGS.slice(param.song_begin, param.song_begin + param.song_num),
          total_song_num: CONTRACT_SONGS.length,
          hasmore: param.song_begin + param.song_num < CONTRACT_SONGS.length ? 1 : 0,
        };
      case 'UrlGetVkey':
        return {
          sip: ['https://stream.invalid/'],
          midurlinfo: param.songmid.map((songmid: string) => ({ songmid, purl: 'fixture.mp3' })),
        };
      case 'get_song_detail_yqq':
        return { track_info: CONTRACT_SONGS[0] };
      case 'GetAlbumList':
        return { list: CONTRACT_ALBUMS };
      case 'get_singer_detail_info':
        return { songlist: CONTRACT_SONGS };
      case 'get_radio_track':
        return { tracks: state.recommendEmpty ? [] : CONTRACT_SONGS.slice(0, 2) };
      case 'GetRecommendFeed':
        return {
          List: state.recommendEmpty ? [] : [{ Playlist: { basic: { tid: 70002, title: 'R' } } }],
          HasMore: false,
        };
      default:
        throw new Error(`Unstubbed contract RPC: ${method}`);
    }
  };

  const fetchFixture = async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    requests.push(url);
    if (url.href.startsWith('https://api.tencentmusic.com/tme/trpc/proxy')) {
      if (state.bootstrapStatus !== 200)
        return new Response('fixture-private-upstream-body', { status: state.bootstrapStatus });
      return Response.json({
        data: JSON.stringify({
          code: 0,
          data: { q16: 'fixture-qimei-16', q36: 'fixture-qimei-36' },
        }),
      });
    }
    if (url.pathname === '/cgi-bin/musicu.fcg' && url.hostname === 'u.y.qq.com') {
      const payload = JSON.parse(url.searchParams.get('data') ?? (await request.text()));
      const response: Record<string, unknown> = { code: 0 };
      for (const [key, descriptor] of Object.entries(payload)) {
        if (key === 'comm' || typeof descriptor !== 'object' || !descriptor) continue;
        const rpc = descriptor as Omit<RpcCall, 'comm'>;
        if (!rpc.method) continue;
        const call = { ...rpc, comm: payload.comm ?? {} };
        calls.push(call);
        const isCatalog = ['songinfo', 'singer'].includes(key);
        const code = isCatalog
          ? state.catalogCode
          : ['GetLoginUserInfo', 'GetPlaylistByUin', 'CgiGetDiss', 'UrlGetVkey'].includes(
                rpc.method,
              )
            ? state.credentialCode
            : ['get_radio_track', 'GetRecommendFeed'].includes(rpc.method)
              ? state.recommendCode
              : 0;
        response[key] = { code, data: code ? {} : rpcData(call) };
      }
      return Response.json(response);
    }
    if (url.pathname === '/v8/fcg-bin/fcg_v8_album_info_cp.fcg')
      return Response.json({ code: state.catalogCode, data: { list: CONTRACT_SONGS } });
    if (url.pathname === '/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg')
      return Response.json({
        code: state.catalogCode,
        cdlist: [{ dissname: 'Fixture playlist', songlist: CONTRACT_SONGS, total_song_num: 3 }],
      });
    if (url.pathname === '/fav/fcgi-bin/fcg_get_profile_order_asset.fcg') {
      const offset = Number(url.searchParams.get('sin'));
      const end = Number(url.searchParams.get('ein'));
      return Response.json({
        code: state.credentialCode,
        data: { albumlist: CONTRACT_ALBUMS.slice(offset, end + 1), totalalbum: 1, has_more: 0 },
      });
    }
    if (['open.weixin.qq.com', 'lp.open.weixin.qq.com'].includes(url.hostname)) {
      if (url.pathname === '/connect/qrconnect')
        return new Response(
          '<img class="qrcode" src="/connect/qrcode/fixture-wx-id"><a href="https://open.weixin.qq.com/connect/confirm?uuid=fixture-wx-id">open</a>',
        );
      if (url.pathname === '/connect/qrcode/fixture-wx-id')
        return new Response(Buffer.from('89504e470d0a1a0a01020304', 'hex'));
      if (url.pathname === '/connect/l/qrconnect')
        return new Response(
          `window.wx_errcode=${state.wechatCode};window.wx_code='fixture-wx-code';`,
        );
    }
    throw new Error(`Unstubbed contract request: ${url.origin}${url.pathname}`);
  };

  const axiosFixture = async (config: AxiosRequestConfig): Promise<AxiosResponse> => {
    const url = new URL(String(config.url));
    for (const [key, value] of Object.entries(config.params ?? {})) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }
    const response = await fetchFixture(url, {
      method: String(config.method ?? 'GET').toUpperCase(),
      body: config.data === undefined ? undefined : String(config.data),
    });
    if (response.status >= 400)
      throw Object.assign(new Error('Fixture HTTP failure'), {
        response: { status: response.status },
      });
    const data =
      config.responseType === 'arraybuffer'
        ? await response.arrayBuffer()
        : config.responseType === 'text'
          ? await response.text()
          : await response.json();
    return {
      data,
      status: response.status,
      statusText: 'OK',
      headers: {},
      config,
    } as AxiosResponse;
  };

  const relay: QqQrRelay = {
    open: async (id, _image, ttl) => {
      opened.push({ id, ttl });
    },
    image: async () => CONTRACT_QR_IMAGE,
    poll: async () => events,
    close: async (id) => {
      closed.push(id);
    },
  };

  return {
    state,
    calls,
    requests,
    opened,
    closed,
    relay,
    fetch: fetchFixture,
    axios: axiosFixture,
    listen: (id: string, callback: (event: QrEvent) => void, ttl: number) => {
      onEvent = callback;
      opened.push({ id, ttl });
      return {
        ready: Promise.resolve(),
        done: new Promise<void>(() => {}),
        close: () => {
          closed.push(id);
        },
      };
    },
    observe: async (...next: QrEvent[]) => {
      events = next;
      for (const event of next) onEvent?.(event);
      // Node exchanges credentials in the push callback; wait for its fixture HTTP microtasks.
      await new Promise<void>((resolve) => setImmediate(resolve));
    },
  };
};
