// 冒烟的路由清单，按顺序跑，每条只请求一次。
// 需要歌曲、歌手、专辑、MV、歌单、榜单编号的路由，用前面回包里的第一项接力：
// 这些值只留在内存里，不打印、不写文件。起点是首页示例里已经公开的关键字。

const KEYWORD = '周杰伦';

const first = (value) => (Array.isArray(value) && value.length ? value[0] : undefined);
const get = (value, ...keys) =>
  keys.reduce(
    (current, key) => (current && typeof current === 'object' ? current[key] : undefined),
    value,
  );
const text = (value) => (typeof value === 'string' && value ? value : undefined);
const id = (value) =>
  (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) ||
  (typeof value === 'string' && /^\d+$/.test(value))
    ? String(value)
    : undefined;

/**
 * 每条：path、method（默认 GET）、needs（要先拿到的值）、query / body（用拿到的值组参数）、
 * take（从回包里取后面要用的值）。缺 needs 的值就跳过这条，并说明缺什么。
 */
const CASES = [
  { path: '/search/hot' },
  {
    path: '/search',
    query: () => ({ keyword: KEYWORD }),
    take: (body) => {
      const song = first(body.items);
      return {
        songmid: text(get(song, 'mid')),
        songid: id(get(song, 'id')),
        singermid: text(get(first(get(song, 'singer')), 'mid')),
        albummid: text(get(song, 'album', 'mid')),
      };
    },
  },
  { path: '/search/suggest', query: () => ({ keyword: KEYWORD }) },
  { path: '/search/match', query: () => ({ keyword: KEYWORD }) },
  { path: '/recommend/categories' },
  { path: '/recommend/categories/all' },
  {
    path: '/recommend/category-playlists',
    query: () => ({ id: 10000000 }),
    take: (body) => ({ tid: id(get(first(body.playlists), 'tid')) }),
  },
  {
    path: '/recommend/category-playlists/sorted',
    query: () => ({ id: 10000000, offset: 0, limit: 20, sortId: 5 }),
  },
  { path: '/recommend/playlists' },
  { path: '/recommend/new-songs' },
  { path: '/recommend/new-albums' },
  { path: '/recommend/radar' },
  {
    path: '/recommend/toplists',
    take: (body) => ({ topid: id(get(first(get(first(body.groups), 'toplists')), 'id')) }),
  },
  { path: '/recommend/toplist', needs: ['topid'], query: (v) => ({ id: v.topid }) },
  { path: '/radio/categories' },
  { path: '/singer/list' },
  { path: '/singer/detail', needs: ['singermid'], query: (v) => ({ mid: v.singermid }) },
  { path: '/singer/homepage', needs: ['singermid'], query: (v) => ({ mid: v.singermid }) },
  { path: '/singer/similar', needs: ['singermid'], query: (v) => ({ mid: v.singermid }) },
  { path: '/singer/songs', needs: ['singermid'], query: (v) => ({ mid: v.singermid }) },
  { path: '/singer/mvs', needs: ['singermid'], query: (v) => ({ mid: v.singermid }) },
  { path: '/getSingerAlbum', needs: ['singermid'], query: (v) => ({ singermid: v.singermid }) },
  { path: '/getSingerHotsong', needs: ['singermid'], query: (v) => ({ singermid: v.singermid }) },
  {
    path: '/getSongInfo',
    needs: ['songmid', 'songid'],
    query: (v) => ({ songmid: v.songmid, songid: v.songid }),
  },
  { path: '/getLyric', needs: ['songmid'], query: (v) => ({ songmid: v.songmid }) },
  { path: '/getAlbumInfo', needs: ['albummid'], query: (v) => ({ albummid: v.albummid }) },
  { path: '/getSongListDetail', needs: ['tid'], query: (v) => ({ disstid: v.tid }) },
  { path: '/song/labels', needs: ['songid'], query: (v) => ({ id: v.songid }) },
  { path: '/song/mvs', needs: ['songid'], query: (v) => ({ id: v.songid }) },
  { path: '/comment/hot', needs: ['songid'], query: (v) => ({ id: v.songid }) },
  { path: '/comment/new', needs: ['songid'], query: (v) => ({ id: v.songid }) },
  { path: '/comment/count', needs: ['songid'], query: (v) => ({ id: v.songid }) },
  { path: '/comment/list', needs: ['songid'], query: (v) => ({ id: v.songid, biztype: 1 }) },
  { path: '/mv/list', take: (body) => ({ vid: text(get(first(body.mvs), 'vid')) }) },
  { path: '/mv/detail', needs: ['vid'], query: (v) => ({ vid: v.vid }) },
  { path: '/mv/url', needs: ['vid'], query: (v) => ({ vid: v.vid }) },
  {
    path: '/song/batch',
    method: 'POST',
    needs: ['songmid', 'songid'],
    body: (v) => ({ songs: [{ mid: v.songmid, id: Number(v.songid) }] }),
  },
  // 不带会话取播放链接；结果受出口地区影响，只比结构，不比有没有链接
  { path: '/getMusicPlay', needs: ['songmid'], query: (v) => ({ songmid: v.songmid }) },
];

module.exports = { CASES, KEYWORD };
