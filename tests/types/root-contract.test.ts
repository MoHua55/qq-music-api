import type * as App from '../../src/app';
import type { AuthSession } from '../../src/services/auth/qrTypes';
import type * as Root from '../../types/root';
import { assertType, type IsEqual } from './assert-type';

// 包根的类型是手写的 `types/root.d.ts`，它就是对外的契约；Electron 靠这三个导出接上。
// 这里拿源码的类型（也就是从 src 生成声明时会得到的类型）和手写的逐项比，`npm run build` 会编译这个文件，
// 两边对不上就编译失败。整个 src 能不能生成声明，由 `npm run build` 的 `--declaration` 守着。

type RealRepository = Parameters<typeof App.configureAuthSessionRepository>[0];

// 导出的名字一样：只有 default、server、configureAuthSessionRepository。
assertType<IsEqual<keyof typeof App, keyof typeof Root>>();

// 默认导出的 Koa 实例与 server 句柄。
assertType<IsEqual<typeof App.default, typeof Root.default>>();
assertType<IsEqual<typeof App.server, typeof Root.server>>();

// 宿主照手写类型实现的仓库，真的函数要收得下；源码里的仓库也符合手写的样子。
assertType<Root.AuthSessionRepository extends RealRepository ? true : false>();
assertType<RealRepository extends Root.AuthSessionRepository ? true : false>();
assertType<IsEqual<ReturnType<typeof App.configureAuthSessionRepository>, void>>();
assertType<IsEqual<RealRepository['kind'], Root.AuthSessionRepository['kind']>>();
assertType<
  IsEqual<ReturnType<RealRepository['load']>, ReturnType<Root.AuthSessionRepository['load']>>
>();

// 交给宿主保存的会话记录：字段名一样，token 与过期时间的类型一样。
assertType<IsEqual<keyof AuthSession, keyof Root.AuthSessionRecord>>();
assertType<IsEqual<AuthSession['token'], Root.AuthSessionRecord['token']>>();
assertType<IsEqual<AuthSession['expiresAt'], Root.AuthSessionRecord['expiresAt']>>();

describe('包根的手写类型', () => {
  it('和源码的类型一致（编译时检查）', () => {
    expect(true).toBe(true);
  });
});
