import { QqApiError } from '../protocol/errors';
import { checkAbort, sleep } from './http';

export interface TokenBucket {
  acquire(signal: AbortSignal): Promise<void>;
}

export interface TokenBucketOptions {
  ratePerSecond?: number;
  burst?: number;
  now?: () => number;
}

/** One token per outgoing HTTP attempt, including a batch and each retry. */
export const createTokenBucket = (options: TokenBucketOptions = {}): TokenBucket => {
  const rate = options.ratePerSecond ?? 10;
  const burst = options.burst ?? 50;
  if (!Number.isFinite(rate) || rate <= 0 || !Number.isSafeInteger(burst) || burst < 1)
    throw new QqApiError('input');
  const now = options.now ?? (() => performance.now());
  let tokens = burst;
  let previous = now();
  return {
    async acquire(signal) {
      for (;;) {
        checkAbort(signal);
        const current = now();
        tokens = Math.min(burst, tokens + (Math.max(0, current - previous) * rate) / 1000);
        // A clock moving backwards cannot manufacture additional tokens.
        previous = Math.max(previous, current);
        if (tokens >= 1) {
          tokens -= 1;
          return;
        }
        await sleep(Math.max(1, Math.ceil(((1 - tokens) * 1000) / rate)), signal);
      }
    },
  };
};

// Global to this process / isolate, never a cross-account request or Cookie cache.
export const defaultTokenBucket = createTokenBucket();
