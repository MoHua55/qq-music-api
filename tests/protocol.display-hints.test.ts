import { LOGIN_HINT_MESSAGES, loginFailureHintOf } from '../src/protocol/loginHints';
import { PLAYBACK_HINT_MESSAGES, playbackHintOf } from '../src/protocol/playbackHints';

// 给使用者看的原因只是提示：从单曲详情的候选讯号（或登录失败的码）挑一句英文预设文案，
// 不改 restriction.key、不改证据等级。顺序：地区 > 付费音乐包 > 会员 > 兜底「可能已下架」。

const track = (overrides: { pay?: object; action?: object; ov?: unknown } = {}) => ({
  mid: 'fixture-song',
  pay: { pay_play: 0, pay_month: 0, ...overrides.pay },
  action: { switch: 1, msgid: 0, alert: 0, ...overrides.action },
  ...(overrides.ov === undefined ? {} : { ov: overrides.ov }),
});

describe('playback display hints', () => {
  it.each([
    ['msgid 23', track({ action: { msgid: 23 } }), 'playback.maybe-region-restricted'],
    ['msgid 18', track({ action: { msgid: 18 } }), 'playback.maybe-region-restricted'],
    ['msgid 32', track({ action: { msgid: 32 } }), 'playback.maybe-region-restricted'],
    ['ov 1', track({ ov: 1 }), 'playback.maybe-region-restricted'],
    [
      'region beats music pack',
      track({ ov: 1, action: { alert: 11 } }),
      'playback.maybe-region-restricted',
    ],
    ['alert 11', track({ action: { alert: 11 } }), 'playback.maybe-music-pack'],
    [
      'music pack beats membership',
      track({ action: { alert: 11 }, pay: { pay_play: 1 } }),
      'playback.maybe-music-pack',
    ],
    ['pay_play 1', track({ pay: { pay_play: 1 } }), 'playback.maybe-membership'],
    ['msgid 13', track({ action: { msgid: 13 } }), 'playback.maybe-membership'],
    ['msgid 8', track({ action: { msgid: 8 } }), 'playback.maybe-membership'],
    ['msgid 14 only means download', track({ action: { msgid: 14 } }), 'playback.maybe-taken-down'],
    ['no signal', track(), 'playback.maybe-taken-down'],
    ['string numbers', track({ action: { msgid: '23' } }), 'playback.maybe-region-restricted'],
    ['no track at all', undefined, 'playback.maybe-taken-down'],
    ['garbage', 'not-a-track', 'playback.maybe-taken-down'],
    ['null blocks', { pay: null, action: null }, 'playback.maybe-taken-down'],
  ])('%s → %s', (_label, input, key) => {
    expect(playbackHintOf(input)).toEqual({
      key,
      message: (PLAYBACK_HINT_MESSAGES as Record<string, string>)[key],
    });
  });

  it('keeps every message in plain English without upstream text', () => {
    for (const message of Object.values(PLAYBACK_HINT_MESSAGES)) {
      expect(message).toMatch(/^[\x20-\x7e]+$/);
      expect(message.length).toBeGreaterThan(10);
    }
  });
});

describe('login display hints', () => {
  it.each([
    [
      'device limit on top',
      { upstreamCode: 20279, upstreamErrorKey: 'auth.device-limit' },
      'login.device-limit',
    ],
    [
      'device limit hidden behind the fallback',
      { upstreamCode: 1000, primaryFailure: { upstreamCode: 20279 }, fallbackAttempted: true },
      'login.device-limit',
    ],
    [
      'mobile QQ exchange 50006 then fallback',
      { upstreamCode: 1000, primaryFailure: { upstreamCode: 50006 }, fallbackAttempted: true },
      'login.wrong-scan-app',
    ],
    ['50006 without a fallback stays unknown', { upstreamCode: 50006 }, undefined],
    ['104604 on top', { upstreamCode: 104604 }, 'login.rate-limited'],
    [
      '104604 hidden behind the fallback',
      { upstreamCode: 1000, primaryFailure: { upstreamCode: 104604 }, fallbackAttempted: true },
      'login.rate-limited',
    ],
    ['upstream HTTP 429', { upstreamHttpStatus: 429 }, 'login.rate-limited'],
    ['restricted', { upstreamErrorKey: 'auth.account-restricted' }, 'login.account-restricted'],
    ['banned', { upstreamErrorKey: 'auth.account-banned' }, 'login.account-banned'],
    ['binding', { upstreamErrorKey: 'auth.account-binding' }, 'login.account-binding'],
    ['rejected', { upstreamErrorKey: 'auth.login-rejected' }, 'login.rejected'],
    ['canceled on the phone', { failureReason: 'user-canceled' }, undefined],
    ['natural expiry', { failureReason: 'qr-timeout' }, undefined],
    ['unknown code', { upstreamCode: 1000 }, undefined],
    ['nothing', {}, undefined],
  ])('%s → %s', (_label, details, key) => {
    expect(loginFailureHintOf(details as never)).toEqual(
      key === undefined
        ? undefined
        : { key, message: (LOGIN_HINT_MESSAGES as Record<string, string>)[key as string] },
    );
  });

  it('keeps every message in plain English', () => {
    for (const message of Object.values(LOGIN_HINT_MESSAGES))
      expect(message).toMatch(/^[\x20-\x7e]+$/);
  });
});
