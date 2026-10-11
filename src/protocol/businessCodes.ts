export type UpstreamOperation =
  | 'generic'
  | 'login'
  | 'phone-login'
  | 'playlist-read'
  | 'playlist-write'
  | 'album-read'
  | 'recommendation-read';

export type CodeEvidence =
  | 'existing-behavior'
  | 'observed-response'
  | 'protocol-reference'
  | 'third-party-report';

export type BusinessErrorKind =
  | 'credential-invalid'
  | 'rate-limited'
  | 'device-limit'
  | 'account-restricted'
  | 'account-banned'
  | 'account-binding'
  | 'login-rejected'
  | 'not-found'
  | 'upstream-business'
  | 'upstream-gateway';

export interface BusinessCodeInfo {
  readonly code: number;
  readonly kind: BusinessErrorKind;
  readonly errorKey: string;
  readonly evidence: CodeEvidence;
  readonly disposition: 'error' | 'idempotent-candidate';
}

interface CodeRule extends BusinessCodeInfo {
  readonly operations: readonly UpstreamOperation[] | 'any';
  readonly source: 'business' | 'gateway';
}

const rule = (
  code: number,
  kind: BusinessErrorKind,
  errorKey: string,
  evidence: CodeEvidence,
  operations: CodeRule['operations'],
  disposition: BusinessCodeInfo['disposition'] = 'error',
  source: CodeRule['source'] = 'business',
): CodeRule => ({ code, kind, errorKey, evidence, operations, disposition, source });

// Evidence describes the protocol observation or mapping, never a confirmed account diagnosis.
// Only the established credential rejections map to 401. Other login numbers stay login-scoped.
const rules: readonly CodeRule[] = [
  ...[1000, 104400, 104401].map((code) =>
    rule(code, 'credential-invalid', 'auth.credential-invalid', 'existing-behavior', 'any'),
  ),
  rule(2001, 'rate-limited', 'upstream.rate-limited', 'protocol-reference', 'any'),
  rule(104604, 'rate-limited', 'auth.rate-limited', 'protocol-reference', ['login']),
  rule(20279, 'device-limit', 'auth.device-limit', 'protocol-reference', ['login']),
  ...[20277, 20278].map((code) =>
    rule(code, 'account-restricted', 'auth.account-restricted', 'protocol-reference', ['login']),
  ),
  rule(20450, 'account-banned', 'auth.account-banned', 'protocol-reference', ['login']),
  ...[20272, 20274].map((code) =>
    rule(code, 'account-binding', 'auth.account-binding', 'protocol-reference', ['login']),
  ),
  rule(20261, 'login-rejected', 'auth.login-rejected', 'protocol-reference', ['login']),
  rule(20271, 'login-rejected', 'auth.verification-rejected', 'protocol-reference', [
    'phone-login',
  ]),
  rule(50006, 'upstream-business', 'upstream.unknown', 'observed-response', ['login']),
  rule(10, 'upstream-business', 'playlist.anonymous-unreadable', 'observed-response', [
    'playlist-read',
  ]),
  rule(10004, 'not-found', 'playlist.not-found', 'observed-response', ['playlist-read']),
  // This number has been observed without login, but has not been validated as a credential code.
  rule(80120, 'upstream-business', 'playlist.authentication-unverified', 'observed-response', [
    'playlist-read',
  ]),
  // A future write descriptor must explicitly allow this result after protocol validation.
  rule(
    80092,
    'upstream-business',
    'playlist.already-applied',
    'protocol-reference',
    ['playlist-write'],
    'idempotent-candidate',
  ),
  rule(80105, 'upstream-business', 'playlist.write-rejected', 'third-party-report', [
    'playlist-write',
  ]),
  rule(22006, 'upstream-business', 'recommendation.rejected', 'observed-response', [
    'recommendation-read',
  ]),
  ...[80000, 40000].map((code) =>
    rule(code, 'upstream-business', 'album.endpoint-unavailable', 'observed-response', [
      'album-read',
    ]),
  ),
  rule(
    500003,
    'upstream-gateway',
    'upstream.gateway-rejected',
    'third-party-report',
    'any',
    'error',
    'gateway',
  ),
];

/** Unknown numbers, success codes and meanings from another operation have no inferred meaning. */
export const lookupBusinessCode = (
  code: number,
  operation: UpstreamOperation = 'generic',
  source: CodeRule['source'] = 'business',
): BusinessCodeInfo | undefined => {
  if (!Number.isSafeInteger(code) || code === 0) return undefined;
  const found = rules.find(
    (entry) =>
      entry.code === code &&
      entry.source === source &&
      (entry.operations === 'any' || entry.operations.includes(operation)),
  );
  if (!found) return undefined;
  // Do not expose mutable references to the classification table.
  return {
    code: found.code,
    kind: found.kind,
    errorKey: found.errorKey,
    evidence: found.evidence,
    disposition: found.disposition,
  };
};

export const isBusinessErrorKey = (value: unknown, kind: string): value is string =>
  typeof value === 'string' &&
  rules.some((entry) => entry.errorKey === value && entry.kind === kind);
