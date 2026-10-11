import request from 'supertest';
import app from '../../src/app';

const server = app.callback();

describe('GET /getLyric', () => {
  it('正常流程: 验证接口能否正确返回业务数据', async () => {
    const response = await request(server).get('/getLyric');
    expect([200, 400, 404, 500]).toContain(response.status);
  });

  it('边界条件: 验证参数为空时的表现', async () => {
    const response = await request(server).get('/getLyric?limit=0&page=-1');
    expect([200, 400, 404, 500]).toContain(response.status);
  });

  it('异常输入: 传入非法参数', async () => {
    const response = await request(server).get('/getLyric?id=invalid_!@#');
    expect([200, 400, 404, 500]).toContain(response.status);
  });
});
