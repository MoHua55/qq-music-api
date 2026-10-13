import {
  PLAYBACK_ENTRY_CODE_FIELDS,
  playbackEntryCodesOf,
  playbackUnavailableLogOf,
} from '../src/protocol/playbackDiagnostics';

describe('playbackEntryCodesOf', () => {
  it('白名单只有单曲条目的四个数字字段', () => {
    expect(PLAYBACK_ENTRY_CODE_FIELDS).toEqual(['result', 'errtype', 'code', 'subcode']);
  });

  it('只收白名单字段里的安全整数，纯数字字符串换成整数', () => {
    expect(
      playbackEntryCodesOf({
        result: 104003,
        errtype: '-3',
        code: '0',
        subcode: 7,
        purl: '',
        vkey: 'fixture-private-vkey',
        pneed: 1,
      }),
    ).toEqual({ result: 104003, errtype: -3, code: 0, subcode: 7 });
  });

  it.each([
    ['小数', 1.5],
    ['超出安全范围', 2 ** 60],
    ['科学计数法字符串', '1e3'],
    ['带空格的字符串', ' 3'],
    ['过长的数字字符串', '1234567890123456'],
    ['空字符串', ''],
    ['布尔', true],
    ['对象', { n: 1 }],
    ['null', null],
  ])('丢掉%s', (_label, value) => {
    expect(playbackEntryCodesOf({ result: value })).toEqual({});
  });

  it('读不了的条目当成没有字段', () => {
    const throwing = Object.defineProperty({}, 'result', {
      get() {
        throw new Error('fixture getter');
      },
    });
    expect(playbackEntryCodesOf(throwing)).toEqual({});
    expect(playbackEntryCodesOf(null)).toEqual({});
    expect(playbackEntryCodesOf('result=1')).toEqual({});
  });
});

describe('playbackUnavailableLogOf', () => {
  it('只带阶段、位置、音质和安全错码，不带歌曲 id', () => {
    const log = playbackUnavailableLogOf({
      phase: 'get-music-play',
      index: 2,
      quality: '320',
      entry: {
        songmid: 'fixture-song-mid',
        purl: '',
        result: 104003,
        subcode: '1',
        errtype: '',
        filename: 'fixture-private-file',
        vkey: 'fixture-private-vkey',
      },
    });

    expect(log).toEqual({
      phase: 'get-music-play',
      index: 2,
      quality: '320',
      entryCodes: { result: 104003, subcode: 1 },
    });
    expect(JSON.stringify(log)).not.toMatch(/fixture-song-mid|fixture-private/);
  });

  it('条目里没有可用数字时 entryCodes 是空的，形状不变', () => {
    expect(
      playbackUnavailableLogOf({ phase: 'get-music-play', index: 0, quality: '128', entry: {} }),
    ).toEqual({ phase: 'get-music-play', index: 0, quality: '128', entryCodes: {} });
  });
});
