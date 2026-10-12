// src/protocol/evidence.ts
//
// 一条错误码或分类规则「凭什么这样说」。零依赖，两个运行时共用。

/**
 * - `verified-controlled`：受控实验确认过（同一首歌、同一音质，只改一个条件）。
 * - `observed-response`：真实响应里见过这个数字，但还不知道原因。
 * - `protocol-reference`：公开的协议资料写了含义，本项目还没有实测。
 * - `third-party-report`：只有别人的回报。
 * - `unknown`：没有足够证据。
 */
export type EvidenceLevel =
  | 'verified-controlled'
  | 'observed-response'
  | 'protocol-reference'
  | 'third-party-report'
  | 'unknown';

export const EVIDENCE_LEVELS: readonly EvidenceLevel[] = [
  'verified-controlled',
  'observed-response',
  'protocol-reference',
  'third-party-report',
  'unknown',
];
