import { QqApiError } from '../../protocol/errors';
import type { MusicuDescriptor } from '../../protocol/musicu';
import { credentialMusicId } from '../auth/androidDevice';
import type { AuthSession } from '../auth/qrLogin';
import { isDictionary } from '../auth/values';
import { failureResult, type NewRouteResult, okResult } from '../recommend/newRouteResult';
import { createSessionMusicuClient, type SessionMusicuOptions } from '../recommend/sessionMusicu';

// 已观察的会员与权益旗标按原值保留，不返回账号、未知字段或整份上游数据。
const VIP_FIELDS = [
  'iVipFlag',
  'iSuperVip',
  'iNewSuperVip',
  'iNewVip',
  'HugeVip',
  'AdVipFlag',
  'AdActiveFlag',
  'AdSigned',
  'AdGotVipTs',
  'MainAdsFreeEndTs',
  'OverseaFlag',
  'iYellowVip',
  'iMusicLevel',
  'iCurLevel',
  'UnionFreeEndTs',
  'SongTiyanEndts',
] as const;

const descriptor = (session: AuthSession): MusicuDescriptor<Record<string, unknown>> => {
  const uin = credentialMusicId(session.credential);
  return {
    module: 'userInfo.VipQueryServer',
    method: 'SRFVipQuery_V2',
    param: { uin_list: [uin] },
    operation: 'user.vip',
    readOnly: true,
    decode: (data) => {
      const info = isDictionary(data) && isDictionary(data.infoMap) ? data.infoMap[uin] : undefined;
      if (
        !isDictionary(info) ||
        typeof info.iVipFlag !== 'number' ||
        !Number.isSafeInteger(info.iVipFlag)
      )
        throw new QqApiError('invalid-response');
      return Object.fromEntries(
        VIP_FIELDS.flatMap((key) => {
          const value = info[key];
          return typeof value === 'string' ||
            typeof value === 'boolean' ||
            (typeof value === 'number' && Number.isFinite(value))
            ? [[key, value]]
            : [];
        }),
      );
    },
  };
};
export const userVipResult = async (
  session: AuthSession | null,
  options: SessionMusicuOptions = {},
): Promise<NewRouteResult> => {
  try {
    if (!session) throw new QqApiError('auth-missing');
    const upstream = await createSessionMusicuClient(session, options).execute(descriptor(session));
    return okResult({ isVip: upstream.iVipFlag === 1, upstream });
  } catch (error) {
    return failureResult('get-user-vip', error);
  }
};
