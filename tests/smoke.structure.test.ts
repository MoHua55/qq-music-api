import { spawnSync } from 'node:child_process';
import path from 'node:path';

// 上游冒烟工具本身会打真实上游，这里只测不联网的部分：结构怎么记、差异怎么比、没确认就拒绝执行。
const { shapeOf, diffShapes } = require('../scripts/smoke/structure');
const { CASES } = require('../scripts/smoke/cases');

describe('上游冒烟工具', () => {
  it('只记结构，不留任何值', () => {
    const shape = shapeOf({
      code: 200,
      songs: [{ mid: 'fixture-song-a', id: 90001, singer: [{ name: 'fixture-singer' }] }],
      empty: [],
      byId: { '90001': 1, '90002': 2 },
      note: null,
    });

    expect(shape).toEqual({
      type: 'object',
      keys: {
        byId: { type: 'map' },
        code: 'number',
        empty: { type: 'array', empty: true },
        note: 'null',
        songs: {
          type: 'array',
          empty: false,
          item: {
            type: 'object',
            keys: {
              id: 'number',
              mid: 'string',
              singer: {
                type: 'array',
                empty: false,
                item: { type: 'object', keys: { name: 'string' } },
              },
            },
          },
        },
      },
    });
    expect(JSON.stringify(shape)).not.toMatch(/fixture|90001/);
  });

  it('拿请求里的编号当键时，快照里换成名字', () => {
    const shape = shapeOf({ playUrl: { 'fixture-song-a': { url: '' } } }, 0, {
      'fixture-song-a': 'songmid',
    });

    expect(shape).toEqual({
      type: 'object',
      keys: {
        playUrl: {
          type: 'object',
          keys: { '<songmid>': { type: 'object', keys: { url: 'string' } } },
        },
      },
    });
  });

  it('少了键、类型变了、有内容的数组变空算变化；新键只列出来', () => {
    const before = shapeOf({ songs: [{ mid: 'a', id: 1 }], total: 3, list: [1] });
    const after = shapeOf({ songs: [{ id: '1', extra: true }], list: [], more: false });

    expect(diffShapes(before, after)).toEqual({
      changes: [
        'body.list：原来有内容，现在是空数组',
        'body.songs[].id：number → string',
        'body.songs[].mid：不见了',
        'body.total：不见了',
      ],
      additions: ['body.songs[].extra：新出现', 'body.more：新出现'],
    });
    expect(diffShapes(before, before)).toEqual({ changes: [], additions: [] });
  });

  it('每条路由只出现一次，接力用到的值都有来源', () => {
    const keys = CASES.map(
      (item: { method?: string; path: string }) => `${item.method ?? 'GET'} ${item.path}`,
    );
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toHaveLength(40);
    const provided = new Set([
      'songmid',
      'songid',
      'singermid',
      'albummid',
      'catid',
      'tid',
      'topid',
      'vid',
    ]);
    for (const item of CASES as { needs?: string[] }[])
      for (const name of item.needs ?? []) expect(provided.has(name)).toBe(true);
  });

  it('没加 --yes-call-upstream 就拒绝执行，不载入服务', () => {
    const result = spawnSync(
      process.execPath,
      [path.join(__dirname, '../scripts/smoke/upstream.js')],
      { encoding: 'utf8' },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('--yes-call-upstream');
  });
});
