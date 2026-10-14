import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { previewMediaIdOf, validMediaIdOf } from '../src/protocol/previewFile';

// 要不要去要试听文件：只有单曲详情里确认 size_try > 0，而且有可信的 media id（前端给的有效 mediaId 优先，
// 否则详情里的 media_mid），才回文件名要用的 media id；其他一律不要，不拿 songmid 猜。

const track = (file: unknown) => ({ mid: 'fixture-song', file });

describe('valid media id', () => {
  it.each([
    ['MediaFixtureA1', 'MediaFixtureA1'],
    ['  MediaFixtureA1  ', 'MediaFixtureA1'],
    ['fixture-media', undefined],
    ['Short1', undefined],
    ['MediaFixtureA12', undefined],
    ['', undefined],
    [undefined, undefined],
    [12345678901234, undefined],
    [['MediaFixtureA1'], undefined],
  ])('%p → %p', (input, expected) => {
    expect(validMediaIdOf(input)).toBe(expected);
  });
});

describe('preview media id', () => {
  it('公开说明把 size_try 当作试听文件存在标记，不当作文件大小', () => {
    const docs = readFileSync(resolve(__dirname, '../docs/README.md'), 'utf8');
    expect(docs).toContain('`file.size_try` 大于 0 代表有试听文件');
    expect(docs).not.toContain('大小是 `file.size_try`');
  });
  it.each([
    [
      'has a preview',
      track({ size_try: 960887, media_mid: 'MediaFixtureA1' }),
      undefined,
      'MediaFixtureA1',
    ],
    [
      'numeric string size',
      track({ size_try: '960887', media_mid: 'MediaFixtureA1' }),
      undefined,
      'MediaFixtureA1',
    ],
    [
      'caller id wins',
      track({ size_try: 1, media_mid: 'MediaFixtureA1' }),
      'CallerMediaId1',
      'CallerMediaId1',
    ],
    [
      'caller id fills a missing media_mid',
      track({ size_try: 1 }),
      'CallerMediaId1',
      'CallerMediaId1',
    ],
    [
      'size_try 0',
      track({ size_try: 0, media_mid: 'MediaFixtureA1' }),
      'CallerMediaId1',
      undefined,
    ],
    [
      'negative size_try',
      track({ size_try: -1, media_mid: 'MediaFixtureA1' }),
      undefined,
      undefined,
    ],
    [
      'size_try not a number',
      track({ size_try: 'many', media_mid: 'MediaFixtureA1' }),
      undefined,
      undefined,
    ],
    ['size_try missing', track({ media_mid: 'MediaFixtureA1' }), undefined, undefined],
    ['no media id at all', track({ size_try: 1, media_mid: '' }), undefined, undefined],
    [
      'malformed media_mid',
      track({ size_try: 1, media_mid: 'fixture-media' }),
      undefined,
      undefined,
    ],
    ['no detail', undefined, 'CallerMediaId1', undefined],
    ['garbage', 'not-a-track', undefined, undefined],
    ['null file', track(null), undefined, undefined],
  ])('%s', (_label, trackInfo, callerMediaId, expected) => {
    expect(previewMediaIdOf(trackInfo, callerMediaId)).toBe(expected);
  });
});
