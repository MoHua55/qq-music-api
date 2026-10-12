import { legacyCgiContract } from './helpers/legacyCgiContract';
import { useLegacyRouteUpstream } from './helpers/legacyRouteUpstream';

legacyCgiContract({
  route: '/getComments',
  path: '/getComments?id=90001',
  endpoint: '/base/fcgi-bin/fcg_global_comment_h5.fcg',
  params: {
    topid: '90001',
    cid: 205360772,
    reqtype: 2,
    biztype: 1,
    cmd: 8,
    pagenum: 0,
    pagesize: 25,
    lasthotcommentid: '',
    format: 'json',
    outCharset: 'GB2312',
    domain: 'qq.com',
    ct: 24,
    cv: 10101010,
    needmusiccrit: 0,
  },
  reply: {
    code: 0,
    comment: {
      commentlist: [
        {
          rootcommentid: 'synthetic-root',
          text: 'synthetic comment',
        },
      ],
    },
  },
  missing: {
    status: 400,
    body: {
      data: {
        message: "Don't have id or rootcommentid",
      },
    },
  },
});

describe('GET /getComments paging', () => {
  const upstream = useLegacyRouteUpstream();
  it('rejects a continuation without the previous root comment ID', async () => {
    const response = await upstream.get('/getComments?id=90001&pagenum=1');
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ data: { message: "Don't have id or rootcommentid" } });
    expect(upstream.calls).toHaveLength(0);
  });
  it('forwards continuation and custom comment options', async () => {
    const reply = { code: 0, comment: { commentlist: [] } };
    upstream.respond(reply);
    const response = await upstream.get(
      '/getComments?id=90001&pagenum=1&rootcommentid=synthetic-root&pagesize=3&cid=90002&cmd=6&reqtype=1&biztype=2',
    );
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ response: reply });
    expect(upstream.calls[0].params).toMatchObject({
      topid: '90001',
      pagenum: '1',
      lasthotcommentid: 'synthetic-root',
      pagesize: '3',
      cid: '90002',
      cmd: '6',
      reqtype: '1',
      biztype: '2',
    });
  });
});
