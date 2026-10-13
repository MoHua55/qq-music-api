import fs from 'node:fs';
import path from 'node:path';
import * as loginHelpers from '../src/controllers/login';

// 完成搬迁后不能再带回旧路由；具体回包和参数继续由各 operation 的宿主契约守护。
it.each([
  'getAlbumInfo',
  'getSongInfo',
  'getSingerAlbum',
  'getSingerHotsong',
  'getSongListDetail',
  'getMusicPlay',
  'getUserPlaylist',
  'getUserAlbums',
  'getUserLikedSongs',
  'getOwnedPlaylistSongs',
])('退役旧 controller %s', (name) => {
  expect(fs.existsSync(path.join(__dirname, '../src/controllers', name + '.ts'))).toBe(false);
});

it('serverless 只保留共用路由，移除旧路由文件', () => {
  expect(fs.existsSync(path.join(__dirname, '../src/serverless/legacyRoutes.ts'))).toBe(false);
});

it('Node 登录文件只保留真实使用的认证提取和 Cookie 常量', () => {
  expect(Object.keys(loginHelpers).sort()).toEqual([
    'AUTH_COOKIE_NAME',
    'AUTH_HEADER_NAME',
    'getAuthToken',
  ]);
});
