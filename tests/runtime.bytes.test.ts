import { Buffer as RuntimeBuffer, webBuffer } from '../src/services/auth/bytes';

// Web 宿主没有 Node Buffer；位元组编码、切片与 MQTT 长度必须保持同一结果。
it('Node 继续使用自己的 Buffer', () => {
  expect(RuntimeBuffer).toBe(Buffer);
});

it.each([
  ['Fixture 你好', 'utf8'],
  ['\ufeffFixture', 'utf8'],
  ['0011aaff', 'hex'],
  ['0011zaff', 'hex'],
  ['89504e470d0a1a0a01020304', 'hex'],
  ['AAECA//+', 'base64'],
  ['AAEC A__-', 'base64url'],
  ['', 'utf8'],
] as const)('Web 与 Node 编码一致 %s/%s', (value, encoding) => {
  const actual = webBuffer.from(value, encoding),
    expected = Buffer.from(value, encoding);
  expect([...actual]).toEqual([...expected]);
  for (const format of ['hex', 'base64', 'base64url', 'utf8'] as const)
    expect(actual.toString(format)).toBe(expected.toString(format));
});

it('ArrayBuffer 的范围保留视图，TypedArray 则复制', () => {
  const input = new Uint8Array([0, 1, 2, 3, 4]);
  const view = webBuffer.from(input.buffer, 1, 2);
  const copied = webBuffer.from(input);
  input[1] = 9;
  expect([...view]).toEqual([9, 2]);
  expect([...copied]).toEqual([0, 1, 2, 3, 4]);
  const slice = view.slice(0, 1);
  slice[0] = 8;
  expect(view[0]).toBe(8);
});

it.each([0, 1, 255, 256, 65535])('MQTT 大端长度 %i 与 Node 相同', (value) => {
  const actual = webBuffer.allocUnsafe(4),
    expected = Buffer.alloc(4);
  expect(actual.writeUInt16BE(value, 1)).toBe(expected.writeUInt16BE(value, 1));
  expect([...actual]).toEqual([...expected]);
  expect(actual.readUInt16BE(1)).toBe(value);
  expect(() => actual.readUInt16BE(3)).toThrow(RangeError);
  expect(() => actual.writeUInt16BE(65536, 0)).toThrow(RangeError);
});

it('拼接与补零保留原字节，输出 JSON 不暴露其他属性', () => {
  const actual = webBuffer.concat([webBuffer.from([1, 2]), webBuffer.from([3])], 5);
  expect([...actual]).toEqual([1, 2, 3, 0, 0]);
  expect(actual.toJSON()).toEqual({ type: 'Buffer', data: [1, 2, 3, 0, 0] });
  expect(webBuffer.isBuffer(actual)).toBe(true);
  expect(webBuffer.isBuffer(new Uint8Array(2))).toBe(false);
});

it('长度、共享视图和截断边界与 Node 一致', () => {
  expect(webBuffer.byteLength('你好')).toBe(Buffer.byteLength('你好'));
  expect(webBuffer.concat([webBuffer.from([1, 2, 3])], 2).toString('hex')).toBe('0102');
  expect(webBuffer.concat([]).length).toBe(0);
  expect(() => webBuffer.alloc(-1)).toThrow(RangeError);
  expect(() => webBuffer.alloc(1.5)).toThrow(RangeError);
  const shared = new SharedArrayBuffer(4);
  const view = webBuffer.from(shared, 1, 2);
  new Uint8Array(shared)[1] = 7;
  expect([...view]).toEqual([7, 0]);
  for (const encoded of ['a', 'AA', 'AAE', 'AAECAw==', 'AAECAw junk'])
    expect([...webBuffer.from(encoded, 'base64')]).toEqual([...Buffer.from(encoded, 'base64')]);
});
