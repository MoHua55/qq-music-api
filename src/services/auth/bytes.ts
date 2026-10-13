import type { Buffer as NodeBuffer } from 'node:buffer';

// src/services/auth/bytes.ts
// 只实现协议用到的字节操作。Node 保留原 Buffer，Web 宿主用 TypedArray 和标准编码 API。
export type Buffer<T extends ArrayBufferLike = ArrayBufferLike> = NodeBuffer<T>;

class WebBytes extends Uint8Array {
  public slice(start?: number, end?: number): WebBytes {
    return this.subarray(start, end) as WebBytes;
  }

  public readUInt16BE(offset = 0): number {
    this.checkOffset(offset);
    return new DataView(this.buffer, this.byteOffset, this.byteLength).getUint16(offset);
  }

  public writeUInt16BE(value: number, offset = 0): number {
    this.checkOffset(offset);
    if (value < 0 || value > 65535 || !Number.isFinite(value))
      throw new RangeError('Invalid unsigned length');
    new DataView(this.buffer, this.byteOffset, this.byteLength).setUint16(offset, value);
    return offset + 2;
  }

  private checkOffset(offset: number): void {
    if (!Number.isInteger(offset) || offset < 0 || offset + 2 > this.length)
      throw new RangeError('Invalid byte offset');
  }

  public toString(encoding = 'utf8', start = 0, end = this.length): string {
    const bytes = this.subarray(Math.max(0, start), Math.max(0, end));
    if (encoding === 'hex')
      return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    if (encoding === 'base64' || encoding === 'base64url') {
      let binary = '';
      for (const byte of bytes) binary += String.fromCharCode(byte);
      const encoded = btoa(binary);
      return encoding === 'base64url'
        ? encoded.replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
        : encoded;
    }
    return new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);
  }

  public toJSON(): { type: 'Buffer'; data: number[] } {
    return { type: 'Buffer', data: [...this] };
  }
}

const from = (
  value: string | ArrayBufferLike | ArrayLike<number>,
  encodingOrOffset?: string | number,
  length?: number,
): WebBytes => {
  if (typeof value === 'string') {
    if (encodingOrOffset === 'hex') {
      const bytes: number[] = [];
      for (let offset = 0; offset + 1 < value.length; offset += 2) {
        const pair = value.slice(offset, offset + 2);
        if (!/^[0-9a-f]{2}$/i.test(pair)) break;
        bytes.push(Number.parseInt(pair, 16));
      }
      return new WebBytes(bytes);
    }
    if (encodingOrOffset === 'base64' || encodingOrOffset === 'base64url') {
      let clean = value
        .replaceAll('-', '+')
        .replaceAll('_', '/')
        .replace(/[^A-Za-z0-9+/=]/g, '')
        .split('=')[0];
      if (clean.length % 4 === 1) clean = clean.slice(0, -1);
      const decoded = atob(clean + '='.repeat((4 - (clean.length % 4)) % 4));
      return new WebBytes(Array.from(decoded, (char) => char.charCodeAt(0)));
    }
    return new WebBytes(new TextEncoder().encode(value));
  }
  if (
    value instanceof ArrayBuffer ||
    (typeof SharedArrayBuffer !== 'undefined' && value instanceof SharedArrayBuffer)
  ) {
    const offset = typeof encodingOrOffset === 'number' ? encodingOrOffset : 0;
    return new WebBytes(value as ArrayBuffer, offset, length ?? value.byteLength - offset);
  }
  return new WebBytes(value as ArrayLike<number>);
};

const alloc = (size: number): WebBytes => {
  if (!Number.isSafeInteger(size) || size < 0) throw new RangeError('Invalid byte length');
  return new WebBytes(size);
};

export const webBuffer = {
  from,
  alloc,
  allocUnsafe: alloc,
  isBuffer: (value: unknown): value is WebBytes => value instanceof WebBytes,
  byteLength: (value: string, encoding?: string): number => from(value, encoding).length,
  concat: (
    list: readonly Uint8Array[],
    totalLength = list.reduce((sum, bytes) => sum + bytes.length, 0),
  ): WebBytes => {
    const result = alloc(totalLength);
    let offset = 0;
    for (const bytes of list) {
      const count = Math.min(bytes.length, result.length - offset);
      result.set(bytes.subarray(0, count), offset);
      offset += count;
      if (offset === result.length) break;
    }
    return result;
  },
};

export const Buffer: typeof NodeBuffer =
  (globalThis as unknown as { Buffer?: typeof NodeBuffer }).Buffer ??
  (webBuffer as unknown as typeof NodeBuffer);
