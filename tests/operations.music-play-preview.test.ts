import './helpers/sessionRoutes';
import musicPlayOperationController from '../src/controllers/musicPlayOperation';
import { getMusicPlay } from '../src/routes/operations/getMusicPlay';
import { CATALOG_RUNTIMES } from './helpers/catalogRoutes';
import { createParityRunner } from './helpers/operationParity';
import { useSessionUpstream } from './helpers/sessionRoutes';

// 试听：前端带 preview=1 时改要试听文件（RS02 前缀、只有一段 14 字元），拿到链接的歌标上 preview: true。
// 不带 preview 时请求和回应都和以前一样；拿不到试听链接照旧是 url_unavailable，不捏造试听。
const parity = createParityRunner(
  { name: 'getMusicPlay', node: '/getMusicPlay/:songmid?', serverless: '/getMusicPlay/:songmid?' },
  {
    operation: getMusicPlay,
    operationNode: musicPlayOperationController,
  },
);
const uuid = '00000000-0000-4000-8000-000000000001';

const ENTRIES = [
  { songmid: 'fixture-a', purl: 'RS02fixture-media.mp3?vkey=fixture' },
  { songmid: 'fixture-b', purl: '', result: 104003 },
];

type PlayBody = { data: { playUrl: Record<string, Record<string, unknown>> } };
const playUrlOf = (body: unknown) => (body as PlayBody).data.playUrl;

const filenamesOf = (calls: Array<{ rpc: Array<{ param: Record<string, unknown> }> }>) =>
  calls[0].rpc[0].param.filename;

describe.each(CATALOG_RUNTIMES)('/getMusicPlay 试听（%s）', (runtime) => {
  const upstream = useSessionUpstream(runtime);
  beforeEach(() => jest.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(uuid));

  it.each([
    ['?preview=1&mediaId=fixture-media', ['RS02fixture-media.mp3', 'RS02fixture-media.mp3']],
    ['?preview=1', ['RS02fixture-a.mp3', 'RS02fixture-b.mp3']],
    ['?preview=true&quality=flac', ['RS02fixture-a.mp3', 'RS02fixture-b.mp3']],
  ])('带会话 %s 改要试听文件，拿到链接的歌标上 preview', async (query, filenames) => {
    upstream.state.data = { sip: ['https://stream.invalid/'], midurlinfo: ENTRIES };
    const legs = await parity(
      runtime,
      `/getMusicPlay/fixture-a,fixture-b${query}`,
      upstream.calls,
      await upstream.options(),
    );
    expect(legs.operation.status).toBe(200);
    expect(filenamesOf(legs.operation.calls)).toEqual(filenames);
    const playUrl = playUrlOf(legs.operation.body);
    expect(playUrl['fixture-a']).toEqual({
      url: 'https://stream.invalid/RS02fixture-media.mp3?vkey=fixture',
      error: false,
      preview: true,
    });
    expect(playUrl['fixture-b']).toMatchObject({
      url: '',
      error: '暂无播放链接',
      restriction: { key: 'url_unavailable' },
    });
    expect(playUrl['fixture-b']).not.toHaveProperty('preview');
    expect(legs.host).toEqual(legs.operation);
  });

  it.each([
    '',
    '?preview=0',
    '?preview=',
    '?preview=yes',
  ])('带会话 %s 不是试听请求，文件名和回应都照旧', async (query) => {
    upstream.state.data = {
      sip: ['https://stream.invalid/'],
      midurlinfo: [{ songmid: 'fixture-a', purl: 'fixture.mp3' }],
    };
    const legs = await parity(
      runtime,
      `/getMusicPlay/fixture-a${query}`,
      upstream.calls,
      await upstream.options(),
    );
    expect(filenamesOf(legs.operation.calls)).toEqual(['M500fixture-afixture-a.mp3']);
    expect(legs.operation.body).toEqual({
      data: {
        playUrl: { 'fixture-a': { url: 'https://stream.invalid/fixture.mp3', error: false } },
      },
    });
  });

  if (runtime === 'node')
    it('匿名带 preview=1 同样改要试听文件', async () => {
      upstream.state.anonymousPlay = {
        code: 0,
        req_0: { code: 0, data: { sip: ['https://stream.invalid/'], midurlinfo: ENTRIES } },
      };
      const legs = await parity(
        runtime,
        '/getMusicPlay/fixture-a,fixture-b?preview=1&mediaId=fixture-media',
        upstream.calls,
        await upstream.options('missing'),
      );
      expect(filenamesOf(legs.operation.calls)).toEqual([
        'RS02fixture-media.mp3',
        'RS02fixture-media.mp3',
      ]);
      expect(playUrlOf(legs.operation.body)['fixture-a']).toEqual({
        url: 'https://stream.invalid/RS02fixture-media.mp3?vkey=fixture',
        error: false,
        preview: true,
      });
      expect(playUrlOf(legs.operation.body)['fixture-b']).not.toHaveProperty('preview');
      expect(legs.host).toEqual(legs.operation);
    });
});
