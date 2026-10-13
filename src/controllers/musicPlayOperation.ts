import { _guid, userInfo } from '../config';
import { createGetMusicPlay } from '../routes/operations/getMusicPlay';
import { operationController } from './operation';

// 配置只在 Node 这边读，匿名播放用到时才把原来的 uin 和 guid 交给共用处理。
export default operationController(
  createGetMusicPlay(() => ({
    uin: userInfo.uin || '0',
    guid: _guid ? `${_guid}` : '1429839143',
  })),
);
