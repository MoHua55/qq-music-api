import './helpers/sessionRoutes';
import musicPlayOperationController from '../src/controllers/musicPlayOperation';
import { getMusicPlay } from '../src/routes/operations/getMusicPlay';
import { CATALOG_RUNTIMES } from './helpers/catalogRoutes';
import { createParityRunner } from './helpers/operationParity';
import { useSessionUpstream } from './helpers/sessionRoutes';

const parity = createParityRunner(
  { name: 'getMusicPlay', node: '/getMusicPlay/:songmid?', serverless: '/getMusicPlay/:songmid?' },
  { operation: getMusicPlay, operationNode: musicPlayOperationController },
);
describe.each(CATALOG_RUNTIMES)('ape 文件守门（%s）', (runtime) => {
  const upstream = useSessionUpstream(runtime);
  beforeEach(() =>
    jest
      .spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValue('00000000-0000-4000-8000-000000000001'),
  );
  const play = async (mids: string, query = 'quality=ape', mode: 'valid' | 'missing' = 'valid') =>
    parity(runtime, `/getMusicPlay/${mids}?${query}`, upstream.calls, await upstream.options(mode));
  const urls = (body: unknown) => (body as any).data.playUrl;
  const blocked = (reason: string, hint: string) => ({
    url: '',
    error: '暂无播放链接',
    restriction: {
      key: 'url_unavailable',
      evidence: 'observed-response',
      failureReason: reason,
      hint: { key: hint, message: expect.any(String) },
    },
  });
  const modes: ('valid' | 'missing')[] = runtime === 'node' ? ['valid', 'missing'] : ['valid'];
  describe.each(modes)('会话 %s', (mode) => {
    it.each([0, -1])('size_ape %s 确认没文件，不要链接', async (size) => {
      upstream.state.songDetails = { 'fixture-song': { file: { size_ape: size } } };
      const legs = await play('fixture-song', 'quality=ape', mode);
      expect(urls(legs.operation.body)['fixture-song']).toEqual(
        blocked('quality-file-unavailable', 'playback.quality-file-unavailable'),
      );
      expect(
        legs.operation.calls
          .flatMap((c) => c.rpc)
          .some((r) => ['UrlGetVkey', 'CgiGetVkey'].includes(r.method)),
      ).toBe(false);
      expect(legs.host).toEqual(legs.operation);
    });
    it.each([undefined, 'invalid', null])('缺少可靠详情 %s 与没文件用不同分类', async (size) => {
      upstream.state.songDetails = {
        'fixture-song': size === undefined ? undefined : { file: { size_ape: size } },
      };
      const legs = await play('fixture-song', 'quality=ape', mode);
      expect(urls(legs.operation.body)['fixture-song']).toEqual(
        blocked('quality-detail-unavailable', 'playback.quality-detail-unavailable'),
      );
      expect(
        legs.operation.calls
          .flatMap((c) => c.rpc)
          .some((r) => ['UrlGetVkey', 'CgiGetVkey'].includes(r.method)),
      ).toBe(false);
      expect(legs.host).toEqual(legs.operation);
    });
    it('有文件的请求正常，混合结果保留被挡的歌', async () => {
      upstream.state.songDetails = {
        'fixture-a': { file: { size_ape: '12' } },
        'fixture-b': { file: { size_ape: 0 } },
      };
      upstream.state.data = {
        sip: ['https://stream.invalid/'],
        midurlinfo: [{ songmid: 'fixture-a', purl: 'fixture.ape' }],
      };
      const legs = await play('fixture-a,fixture-b', 'quality=ape', mode);
      expect(urls(legs.operation.body)['fixture-a']).toMatchObject({ error: false });
      expect(urls(legs.operation.body)['fixture-b']).toEqual(
        blocked('quality-file-unavailable', 'playback.quality-file-unavailable'),
      );
      const vkey = legs.operation.calls
        .flatMap((c) => c.rpc)
        .find((r) => ['UrlGetVkey', 'CgiGetVkey'].includes(r.method));
      expect(vkey?.param.songmid).toEqual(['fixture-a']);
      expect(legs.host).toEqual(legs.operation);
    });
    it('最多查十首、重复歌曲共用详情、超限视为查不到', async () => {
      const mids = Array.from({ length: 12 }, (_, index) => `fixture-${index}`);
      upstream.state.songDetails = Object.fromEntries(
        mids.map((mid) => [mid, { file: { size_ape: 0 } }]),
      );
      const legs = await play([...mids, mids[0]].join(','), 'quality=ape', mode);
      expect(
        legs.operation.calls
          .flatMap((c) => c.rpc)
          .filter((r) => r.method === 'get_song_detail_yqq'),
      ).toHaveLength(10);
      expect(urls(legs.operation.body)['fixture-10']).toEqual(
        blocked('quality-detail-unavailable', 'playback.quality-detail-unavailable'),
      );
      expect(legs.host).toEqual(legs.operation);
    });
    it('preview=1 优先试听，不检查 ape', async () => {
      upstream.state.songDetails = {
        'fixture-song': { file: { size_try: 1, media_mid: 'MediaFixtureA1', size_ape: 0 } },
      };
      upstream.state.data = {
        sip: ['https://stream.invalid/'],
        midurlinfo: [{ songmid: 'fixture-song', purl: 'fixture.mp3' }],
      };
      const legs = await play('fixture-song', 'quality=ape&preview=1', mode);
      expect(urls(legs.operation.body)['fixture-song']).toMatchObject({
        error: false,
        preview: true,
      });
      expect(
        legs.operation.calls
          .flatMap((c) => c.rpc)
          .filter((r) => r.method === 'get_song_detail_yqq'),
      ).toHaveLength(1);
    });
  });
  it.each(['320', 'flac'])('音质 %s 不因 ape 没文件被挡', async (quality) => {
    upstream.state.songDetails = { 'fixture-song': { file: { size_ape: 0 } } };
    upstream.state.data = {
      sip: ['https://stream.invalid/'],
      midurlinfo: [{ songmid: 'fixture-song', purl: 'fixture.mp3' }],
    };
    const legs = await play('fixture-song', `quality=${quality}`);
    expect(urls(legs.operation.body)['fixture-song']).toMatchObject({ error: false });
    expect(
      legs.operation.calls.flatMap((c) => c.rpc).filter((r) => r.method === 'get_song_detail_yqq'),
    ).toHaveLength(0);
  });
});
