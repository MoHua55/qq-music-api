import { createSealedSessionResolver } from '../src/serverless/sealedResolver';
import { openToken, SEALED_AUTH_PURPOSE, sealToken } from '../src/serverless/sealedSession';
import type { AuthSession, QqCredential } from '../src/services/auth/qrLogin';

// sealed 会话轮替：凭证在 token 里，续期只能交出新 token。
// 实测（2026-10）QQ、微信续期后旧 musickey 至少 10 分钟内照常可用，所以旧 token 不用作废，
// 客户端没存到新 token 也只是下次再续。下面的账号、key 都是假数据。

const SECRET = 'fixture-rotation-secret';
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const START = 1_800_000_000_000;

let now = START;
const resolver = () =>
  createSealedSessionResolver({ secrets: { current: SECRET }, now: () => now });

type Refresh = (session: AuthSession) => Promise<QqCredential>;
interface Rotation {
  token: string;
  expiresAt: number;
  rotated: boolean;
}
/** 轮替是 sealed 后端的可选能力；每次新建 resolver，确认冷却与并发记录不跟着实例走。 */
const rotate = (token: string, refresh: Refresh): Promise<Rotation | null> | undefined =>
  (
    resolver() as unknown as {
      rotate?: (token: string, refresh: Refresh) => Promise<Rotation | null>;
    }
  ).rotate?.(token, refresh);
const refreshMock = (implementation?: Refresh) =>
  jest.fn<Promise<QqCredential>, [AuthSession]>(implementation);
const payloadOf = (token: string) =>
  openToken(token, SEALED_AUTH_PURPOSE, { current: SECRET }) as Promise<Record<string, unknown>>;

const REFRESH_MATERIAL = {
  refresh_key: 'fixture-refresh-key',
  refresh_token: 'fixture-refresh-token',
  openid: 'fixture-openid',
  unionid: 'fixture-unionid',
  access_token: 'fixture-access-token',
};
const credential = (extra: Record<string, unknown> = REFRESH_MATERIAL): QqCredential =>
  ({
    musicid: '10000',
    str_musicid: '10000',
    musickey: 'fixture-old-key',
    loginType: 2,
    encryptUin: 'fixture-encrypted-uin',
    unrelated: 'dropped',
    ...extra,
  }) as QqCredential;
const issue = (expiresAt: number, extra?: Record<string, unknown>) =>
  resolver().issue({
    credential: credential(extra),
    device: {} as AuthSession['device'],
    expiresAt,
  });
/** 上游续期的回包：新 key 三天有效，默认不带新的续期材料。 */
const refreshed = (extra: Record<string, unknown> = {}): QqCredential =>
  ({
    musicid: '10000',
    str_musicid: '10000',
    musickey: 'fixture-new-key',
    loginType: 2,
    musickeyCreateTime: Math.floor(now / 1000),
    keyExpiresIn: 3 * 24 * 60 * 60,
    ...extra,
  }) as QqCredential;

beforeEach(() => {
  now = START;
});

describe('sealed token v2', () => {
  it('记下首次登录时间，续期材料单独放，白名单外的字段照旧丢掉', async () => {
    const payload = await payloadOf(await issue(START + 3 * DAY));
    expect(payload).toMatchObject({ v: 2, iat: START, born: START, exp: START + 3 * DAY });
    expect(payload.rf).toEqual(REFRESH_MATERIAL);
    expect(payload.cred).not.toHaveProperty('refresh_key');
    expect(payload.cred).not.toHaveProperty('unrelated');
  });

  it('一般读取拿到的凭证里没有续期材料', async () => {
    const session = await resolver().resolve(await issue(START + 3 * DAY));
    expect(session?.credential).toMatchObject({ musickey: 'fixture-old-key' });
    expect(session?.credential).not.toHaveProperty('refresh_key');
  });

  it('没有续期材料时不放 rf', async () => {
    const payload = await payloadOf(await issue(START + 3 * DAY, {}));
    expect(payload).not.toHaveProperty('rf');
  });
});

describe('sealed 轮替', () => {
  it('v1 token 照常能用，但不续期', async () => {
    const v1 = await sealToken(
      { v: 1, iat: START, exp: START + HOUR, cred: credential() },
      SEALED_AUTH_PURPOSE,
      SECRET,
    );
    const refresh = refreshMock();
    expect(await resolver().resolve(v1)).not.toBeNull();
    await expect(rotate(v1, refresh)).resolves.toEqual({
      token: v1,
      expiresAt: START + HOUR,
      rotated: false,
    });
    expect(refresh).not.toHaveBeenCalled();
  });

  it('离到期还超过 6 小时：不打上游', async () => {
    const token = await issue(START + 7 * HOUR);
    const refresh = refreshMock();
    await expect(rotate(token, refresh)).resolves.toEqual({
      token,
      expiresAt: START + 7 * HOUR,
      rotated: false,
    });
    expect(refresh).not.toHaveBeenCalled();
  });

  it('进入最后 6 小时：续期一次换新 token，首次登录时间不变，旧 token 照旧可用', async () => {
    const token = await issue(START + HOUR);
    now = START + 10 * 60 * 1000;
    const refresh = refreshMock(async () => refreshed());

    const rotation = await rotate(token, refresh);

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refresh.mock.calls[0][0].credential).toMatchObject({
      musickey: 'fixture-old-key',
      ...REFRESH_MATERIAL,
    });
    expect(rotation).toMatchObject({ rotated: true, expiresAt: now + 3 * DAY });
    expect(rotation?.token).not.toBe(token);
    const payload = await payloadOf(rotation?.token ?? '');
    expect(payload).toMatchObject({ v: 2, born: START, iat: now, exp: now + 3 * DAY });
    expect(payload.cred).toMatchObject({ musickey: 'fixture-new-key' });
    // 上游没给新的续期材料时沿用旧的（实测 refresh_key、access_token 通常不换）。
    expect(payload.rf).toEqual(REFRESH_MATERIAL);
    expect(await resolver().resolve(token)).not.toBeNull();
    expect((await resolver().resolve(rotation?.token))?.credential.musickey).toBe(
      'fixture-new-key',
    );
  });

  it('上游给了新的续期材料就换成新的', async () => {
    const token = await issue(START + HOUR);
    const rotation = await rotate(token, async () =>
      refreshed({ refresh_key: 'fixture-new-refresh-key' }),
    );
    const payload = await payloadOf(rotation?.token ?? '');
    expect(payload.rf).toEqual({ ...REFRESH_MATERIAL, refresh_key: 'fixture-new-refresh-key' });
  });

  it('没有续期材料就不续', async () => {
    const token = await issue(START + HOUR, {});
    const refresh = refreshMock();
    await expect(rotate(token, refresh)).resolves.toMatchObject({
      token,
      rotated: false,
    });
    expect(refresh).not.toHaveBeenCalled();
  });

  it('总寿命 30 天：新的到期时间不超过上限', async () => {
    const cap = START + 30 * DAY;
    const first = await issue(START + 3 * DAY);
    // 用一连串续期把会话推到接近上限，首次登录时间一直是 START。
    now = cap - 22 * HOUR;
    const nearCap = await sealToken(
      { ...(await payloadOf(first)), iat: now, exp: cap - 20 * HOUR },
      SEALED_AUTH_PURPOSE,
      SECRET,
    );
    const rotation = await rotate(nearCap, async () => refreshed());
    expect(rotation).toMatchObject({ rotated: true, expiresAt: cap });
  });

  it('总寿命 30 天：到期时间已经到上限就不再续', async () => {
    const cap = START + 30 * DAY;
    const first = await issue(START + 3 * DAY);
    now = cap - 2 * HOUR;
    const atCap = await sealToken(
      { ...(await payloadOf(first)), iat: now, exp: cap },
      SEALED_AUTH_PURPOSE,
      SECRET,
    );
    const refresh = refreshMock(async () => refreshed());
    await expect(rotate(atCap, refresh)).resolves.toEqual({
      token: atCap,
      expiresAt: cap,
      rotated: false,
    });
    expect(refresh).not.toHaveBeenCalled();
  });

  it('续期失败：同一个实例 5 分钟内不再试，过了再试一次', async () => {
    const token = await issue(START + HOUR);
    const refresh = refreshMock(async () => {
      throw new Error('fixture-private-failure');
    });

    await expect(rotate(token, refresh)).resolves.toMatchObject({
      token,
      rotated: false,
    });
    now += 4 * 60 * 1000;
    await rotate(token, refresh);
    expect(refresh).toHaveBeenCalledTimes(1);
    now += 60 * 1000 + 1;
    await rotate(token, refresh);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('同一个 token 同时来两次只续一次', async () => {
    const token = await issue(START + HOUR);
    let release: (value: QqCredential) => void = () => undefined;
    const refresh = refreshMock(
      () =>
        new Promise<QqCredential>((resolve) => {
          release = resolve;
        }),
    );
    const pending = Promise.all([rotate(token, refresh), rotate(token, refresh)]);
    // 等第一次真的打到上游（打开 token 要走几轮异步加密）再放行。
    while (refresh.mock.calls.length === 0) await new Promise((resolve) => setImmediate(resolve));
    release(refreshed());
    const [first, second] = await pending;
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(first?.rotated).toBe(true);
    expect(second).toEqual(first);
  });

  it('打不开或已过期的 token 回 null', async () => {
    const refresh = refreshMock();
    await expect(rotate('fixture-not-a-token', refresh)).resolves.toBeNull();
    const expired = await issue(START - 1);
    await expect(rotate(expired, refresh)).resolves.toBeNull();
    expect(refresh).not.toHaveBeenCalled();
  });
});
