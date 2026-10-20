import { normalizeQqFailure, QqApiError } from '../../protocol/errors';
import { isDictionary } from '../../util/values';
import type { AuthSession } from '../auth/qrLogin';
import { failureResult, okResult } from '../recommend/newRouteResult';
import { createSessionMusicuClient } from '../recommend/sessionMusicu';

export const userMusicGeneResult = async (session: AuthSession | null) => {
  try {
    if (!session) throw new QqApiError('auth-missing');
    const profile = await createSessionMusicuClient(session, { maxRetries: 0 }).execute({
      module: 'music.recommend.UserProfileSettingSvr',
      method: 'GetProfileReport',
      param: {},
      readOnly: true,
    });
    if (!isDictionary(profile)) throw new QqApiError('invalid-response');
    if (profile.code !== undefined) {
      if (typeof profile.code !== 'number' || !Number.isSafeInteger(profile.code))
        throw new QqApiError('invalid-response');
      if (profile.code !== 0)
        throw normalizeQqFailure({ source: 'business', upstreamCode: profile.code });
    }
    // 只读当前会话本人，不转发目标账号，也不改变 IsVisitAccount 等上游字段的类型。
    return okResult({ profile });
  } catch (error) {
    return failureResult('get-user-music-gene', error);
  }
};
