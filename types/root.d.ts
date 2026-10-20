import type Koa from 'koa';
import type { Server } from 'node:http';

/**
 * The package root's public contract, pinned by hand rather than generated.
 *
 * The whole of `src` can emit declarations (`npm run build` checks that), but this file *is* the
 * contract: Electron depends on the root's export shape, and declaring exactly these three exports
 * states the boundary deliberately instead of publishing every internal type a generated emit
 * would happen to reach.
 *
 * 🔴 Keep in step with `src/app.ts`. `tests/app.composition-root.test.ts` pins the runtime shape,
 * and `tests/types/root-contract.test.ts` fails to compile when this file and the source types
 * drift apart.
 */

/** An `AuthSession` as the embedding host sees it. Structural on purpose: hosts only persist it. */
export interface AuthSessionRecord {
  token: string;
  credential: Record<string, unknown>;
  device: Record<string, unknown>;
  expiresAt: number;
}

export interface AuthSessionRepository {
  readonly kind: string;
  load(): unknown;
  save(sessions: readonly AuthSessionRecord[]): void;
}

/**
 * Injects credential persistence. Electron calls this immediately after requiring the package,
 * before the event loop can accept a request.
 */
export declare const configureAuthSessionRepository: (repository: AuthSessionRepository) => void;

/**
 * The HTTP server handle. Requiring the package root starts listening as an import side effect;
 * under a test environment it stays `null`.
 */
export declare const server: Server | null;

declare const app: Koa;
export default app;
