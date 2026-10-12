import { EVIDENCE_LEVELS, type EvidenceLevel } from '../src/protocol/evidence';
import { playbackEntryCodesOf } from '../src/protocol/playbackDiagnostics';
import {
  classifyPlaybackRestriction,
  observePlaybackAuthorization,
  PLAYBACK_RESTRICTION_KEYS,
  PLAYBACK_RESTRICTION_RULES,
  type PlaybackRestrictionRule,
  playbackQualityOf,
  playbackUnavailableLogOf,
} from '../src/protocol/playbackRestriction';
import { PLAYBACK_OBSERVATIONS, VIP_OBSERVATIONS } from './fixtures/protocol/negativeResponses';

describe('playbackEntryCodesOf', () => {
  it('只收白名单字段里的安全整数，纯数字字符串换成整数', () => {
    expect(
      playbackEntryCodesOf({
        result: 104003,
        errtype: '-3',
        code: '0',
        subcode: 7,
        purl: '',
        vkey: 'fixture-private-vkey',
        tips: '提示文字',
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

describe('playbackQualityOf', () => {
  it.each([
    ['flac', 'flac'],
    ['320', '320'],
    [128, '128'],
    ['m4a', 'm4a'],
    ['ape', 'ape'],
    ['128', '128'],
    [null, '128'],
    ['', '128'],
    [true, '128'],
    ['hires', '128'],
    [undefined, '128'],
  ])('%p → %p', (input, expected) => {
    expect(playbackQualityOf(input)).toBe(expected);
  });
});

const AUTHENTICATED_FLAC = { quality: 'flac', authenticated: true } as const;

const ruleOf = (
  evidence: EvidenceLevel,
  matches: PlaybackRestrictionRule['matches'] = () => true,
): PlaybackRestrictionRule => ({
  id: `fixture-${evidence}`,
  key: 'membership_required',
  evidence,
  source: '测试用的假规则',
  matches,
});

describe('classifyPlaybackRestriction', () => {
  it('没有规则时只说拿不到链接，带上单曲条目的数字', () => {
    expect(
      classifyPlaybackRestriction({
        ...AUTHENTICATED_FLAC,
        codes: { result: 104003, errtype: -3 },
      }),
    ).toEqual({
      key: 'url_unavailable',
      evidence: 'observed-response',
      codes: { result: 104003, errtype: -3 },
    });
  });

  it('没有可用数字时省略 codes', () => {
    const restriction = classifyPlaybackRestriction({ ...AUTHENTICATED_FLAC, codes: {} });
    expect(restriction).toEqual({ key: 'url_unavailable', evidence: 'observed-response' });
    expect(restriction).not.toHaveProperty('codes');
  });

  it('正式规则表是空的：拿到受控实验证据之前，什么数字都只会是 url_unavailable', () => {
    expect(PLAYBACK_RESTRICTION_RULES).toEqual([]);
    for (const codes of [{ result: 104003 }, { result: 0 }, { code: 1000 }, { subcode: 4000 }]) {
      expect(classifyPlaybackRestriction({ ...AUTHENTICATED_FLAC, codes }).key).toBe(
        'url_unavailable',
      );
    }
  });

  it.each(
    EVIDENCE_LEVELS.filter((level) => level !== 'verified-controlled'),
  )('出处是 %s 的规则即使命中也不生效', (evidence) => {
    expect(
      classifyPlaybackRestriction({ ...AUTHENTICATED_FLAC, codes: { result: 1 } }, [
        ruleOf(evidence),
      ]),
    ).toEqual({ key: 'url_unavailable', evidence: 'observed-response', codes: { result: 1 } });
  });

  it('受控实验确认过的规则才会给出具体原因', () => {
    expect(
      classifyPlaybackRestriction({ ...AUTHENTICATED_FLAC, codes: { result: 1 } }, [
        ruleOf('verified-controlled', ({ codes }) => codes.result === 1),
      ]),
    ).toEqual({
      key: 'membership_required',
      evidence: 'verified-controlled',
      codes: { result: 1 },
    });
  });

  it('只针对某个音质的规则不会套到别的音质', () => {
    const flacOnly = ruleOf('verified-controlled', ({ quality }) => quality === 'flac');
    expect(
      classifyPlaybackRestriction({ quality: '128', authenticated: true, codes: {} }, [flacOnly])
        .key,
    ).toBe('url_unavailable');
    expect(classifyPlaybackRestriction({ ...AUTHENTICATED_FLAC, codes: {} }, [flacOnly]).key).toBe(
      'membership_required',
    );
  });

  it('规则本身出错时当成没命中', () => {
    const broken = ruleOf('verified-controlled', () => {
      throw new Error('fixture rule');
    });
    expect(classifyPlaybackRestriction({ ...AUTHENTICATED_FLAC, codes: {} }, [broken]).key).toBe(
      'url_unavailable',
    );
  });

  it('对外的 key 与 Folia 认得的分类一一对应，没有自创的值', () => {
    expect(PLAYBACK_RESTRICTION_KEYS).toEqual([
      'url_unavailable',
      'membership_required',
      'purchase_required',
      'entitlement_required',
      'preview_only',
      'region_restricted',
      'taken_down',
    ]);
  });
});

describe('observePlaybackAuthorization', () => {
  it('拿到链接时没有 restriction', () => {
    const observation = observePlaybackAuthorization(
      { purl: 'fixture.flac', result: 0 },
      true,
      AUTHENTICATED_FLAC,
    );
    expect(observation).toEqual({
      quality: 'flac',
      authenticated: true,
      granted: true,
      entryCodes: { result: 0 },
    });
    expect(observation).not.toHaveProperty('restriction');
  });

  it('拿不到链接时带上 url_unavailable', () => {
    expect(
      observePlaybackAuthorization({ purl: '', result: 104003 }, false, {
        quality: '128',
        authenticated: false,
      }),
    ).toEqual({
      quality: '128',
      authenticated: false,
      granted: false,
      entryCodes: { result: 104003 },
      restriction: {
        key: 'url_unavailable',
        evidence: 'observed-response',
        codes: { result: 104003 },
      },
    });
  });
});

describe('playbackUnavailableLogOf', () => {
  it('只记阶段、位置、音质和单曲数字', () => {
    const observation = observePlaybackAuthorization(
      { songmid: 'fixture-song-b', purl: '', result: 104003, vkey: 'fixture-vkey' },
      false,
      AUTHENTICATED_FLAC,
    );
    const log = playbackUnavailableLogOf(observation, {
      phase: 'get-music-play',
      index: 1,
    });
    expect(log).toEqual({
      phase: 'get-music-play',
      index: 1,
      quality: 'flac',
      entryCodes: { result: 104003 },
    });
    expect(JSON.stringify(log)).not.toMatch(/fixture-song-b|fixture-vkey/);
  });
});

describe('synthetic playback observations', () => {
  it.each(PLAYBACK_OBSERVATIONS)('classifies each entry independently for $name', (fixture) => {
    for (const entry of fixture.response.req_0.data.midurlinfo) {
      const observation = observePlaybackAuthorization(entry, entry.purl.length > 0, {
        quality: 'm4a',
        authenticated: true,
      });
      expect(observation.entryCodes).toEqual({ result: entry.result, subcode: 0 });
      if (entry.purl) expect(observation).not.toHaveProperty('restriction');
      else
        expect(observation.restriction).toEqual({
          key: 'url_unavailable',
          evidence: 'observed-response',
          codes: { result: entry.result, subcode: 0 },
        });
    }
  });

  it.each(VIP_OBSERVATIONS)('does not infer entitlement from $name flags', (fixture) => {
    const membership = fixture.response.req_0.data.infoMap['10000'];
    const rejected = observePlaybackAuthorization(
      { result: 104003, purl: '', membership, pay: { pay_play: 0 } },
      false,
      AUTHENTICATED_FLAC,
    );
    const granted = observePlaybackAuthorization(
      { result: 0, purl: 'fixture.flac', membership, pay: { pay_play: 1 } },
      true,
      AUTHENTICATED_FLAC,
    );
    expect(rejected.restriction).toEqual({
      key: 'url_unavailable',
      evidence: 'observed-response',
      codes: { result: 104003 },
    });
    expect(granted).not.toHaveProperty('restriction');
    expect(rejected.entryCodes).toEqual({ result: 104003 });
    expect(granted.entryCodes).toEqual({ result: 0 });
  });
});
