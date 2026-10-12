import { loggableSongmid, playbackFailureCodesOf } from '../src/protocol/playbackDiagnostics';

describe('playbackFailureCodesOf', () => {
  it('只收白名单字段里的安全整数，纯数字字符串换成整数', () => {
    expect(
      playbackFailureCodesOf({
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
    ['布尔', true],
    ['对象', { n: 1 }],
    ['null', null],
  ])('丢掉%s', (_label, value) => {
    expect(playbackFailureCodesOf({ result: value })).toEqual({});
  });

  it('读不了的条目当成没有字段', () => {
    const throwing = Object.defineProperty({}, 'result', {
      get() {
        throw new Error('fixture getter');
      },
    });
    expect(playbackFailureCodesOf(throwing)).toEqual({});
    expect(playbackFailureCodesOf(null)).toEqual({});
    expect(playbackFailureCodesOf('result=1')).toEqual({});
  });
});

describe('loggableSongmid', () => {
  it('收常见的 songmid 写法', () => {
    expect(loggableSongmid('003rJSwm3TechU')).toBe('003rJSwm3TechU');
    expect(loggableSongmid('fixture-song_a')).toBe('fixture-song_a');
  });

  it.each(['', 'has space', '<script>', 'a'.repeat(65), 'mid\nnext'])('不收 %p', (value) => {
    expect(loggableSongmid(value)).toBeUndefined();
  });
});
