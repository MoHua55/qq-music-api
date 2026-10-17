import type { QqCredential } from './qrTypes';

// src/services/auth/ptlogin.ts
// 手机 QQ 扫码的纯 HTTP 做法（QQ 互联网页登录）。占位：实现在下一个提交。

export type PtloginFetch = (url: string, init: RequestInit) => Promise<Response>;

export interface PtloginOptions {
  fetch?: PtloginFetch;
  signal?: AbortSignal;
}

export interface PtloginQr {
  qrsig: string;
  imageUrl: string;
  expiresIn: number;
}

export type PtloginPoll =
  | { status: 'waiting' }
  | { status: 'scanned' }
  | { status: 'expired' }
  | { status: 'confirmed'; checkSigUrl: string };

export type PtloginStep =
  | 'qr-show'
  | 'qr-poll'
  | 'check-sig'
  | 'login-jump'
  | 'authorize'
  | 'qq-login';

export class PtloginError extends Error {
  constructor(
    message: string,
    readonly step: PtloginStep,
    readonly details: { httpStatus?: number; upstreamCode?: number; globalCode?: number } = {},
  ) {
    super(message);
    this.name = 'PtloginError';
  }

  get httpStatus(): number | undefined {
    return this.details.httpStatus;
  }

  get upstreamCode(): number | undefined {
    return this.details.upstreamCode;
  }

  get globalCode(): number | undefined {
    return this.details.globalCode;
  }
}

export const PTLOGIN_QR_TTL_SECONDS = 120;

export const createPtloginQr = async (_options: PtloginOptions = {}): Promise<PtloginQr> => {
  throw new Error('not implemented');
};

export const pollPtloginQr = async (
  _qrsig: string,
  _options: PtloginOptions = {},
): Promise<PtloginPoll> => {
  throw new Error('not implemented');
};

export const exchangePtloginCredential = async (
  _checkSigUrl: string,
  _options: PtloginOptions & { state?: string } = {},
): Promise<QqCredential> => {
  throw new Error('not implemented');
};
