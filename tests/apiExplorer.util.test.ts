import {
  apiExplorerBaseRoutes,
  apiExplorerMetadata,
  createApiExplorerEndpoint,
  extractRouteParams,
  stripRouteParams,
} from '../src/config/apiExplorer';
import {
  buildApiExplorerRequest,
  createApiExplorerRequestLogEntry,
  filterApiExplorerEndpoints,
  parseExplorerBody,
  toQueryString,
  updateApiExplorerRequestLogEntry,
} from '../src/util/apiExplorer';

describe('apiExplorer util', () => {
  it('应忽略空查询参数并保留有效值', () => {
    expect(
      toQueryString({
        key: '周杰伦',
        limit: '10',
        page: '',
      }),
    ).toBe('key=%E5%91%A8%E6%9D%B0%E4%BC%A6&limit=10');
  });

  it('应构造 GET 请求预览地址', () => {
    const endpoint = apiExplorerMetadata.endpoints.find(({ id }) => id === 'get-search');

    expect(endpoint).toBeDefined();
    if (!endpoint) {
      throw new Error('Expected get-search endpoint to exist.');
    }

    const request = buildApiExplorerRequest(endpoint, {
      baseUrl: 'http://localhost:3200/',
      queryValues: {
        keyword: '周杰伦',
        limit: '20',
      },
    });

    expect(request).toEqual({
      method: 'GET',
      url: 'http://localhost:3200/search?keyword=%E5%91%A8%E6%9D%B0%E4%BC%A6&limit=20',
      body: undefined,
    });
  });

  it('应构造 POST 请求并解析 JSON body', () => {
    const endpoint = apiExplorerMetadata.endpoints.find(({ id }) => id === 'batch-get-song-info');

    expect(endpoint).toBeDefined();
    if (!endpoint) {
      throw new Error('Expected batch-get-song-info endpoint to exist.');
    }

    const request = buildApiExplorerRequest(endpoint, {
      baseUrl: 'http://localhost:3200',
      bodyText: '{"songs":[["001fNHEf1SFEFN",""]]}',
    });

    expect(request).toEqual({
      method: 'POST',
      url: 'http://localhost:3200/batchGetSongInfo',
      body: {
        songs: [['001fNHEf1SFEFN', '']],
      },
    });
  });

  it('应支持路径参数替换', () => {
    const request = buildApiExplorerRequest(
      {
        id: 'demo',
        name: 'demo',
        category: 'demo',
        description: 'demo',
        method: 'GET',
        routePath: '/demo/:id/:lang?',
        path: '/demo/:id/:lang?',
      },
      {
        baseUrl: 'http://localhost:3200',
        pathValues: {
          id: 'song001',
          lang: 'zh-CN',
        },
      },
    );

    expect(request.url).toBe('http://localhost:3200/demo/song001/zh-CN');
  });

  it('应拒绝非对象类型的 JSON body', () => {
    expect(() => parseExplorerBody('["invalid"]')).toThrow('Request body must be a JSON object.');
  });

  it('应在 body 为空时返回 undefined', () => {
    expect(parseExplorerBody('   ')).toBeUndefined();
  });

  it('应从路由路径中提取可选参数信息', () => {
    expect(extractRouteParams('/getSongInfo/:songmid?/:songid?')).toEqual([
      expect.objectContaining({
        key: 'songmid',
        required: false,
      }),
      expect.objectContaining({
        key: 'songid',
        required: false,
      }),
    ]);
  });

  it('应将路由路径裁剪为可直接请求的基础路径', () => {
    expect(stripRouteParams('/getSearchByKey/:key?/:limit?/:page?/:catZhida?')).toBe(
      '/getSearchByKey',
    );
  });

  it('应为全部基础路由生成 Explorer 元数据', () => {
    expect(apiExplorerMetadata.endpoints).toHaveLength(apiExplorerBaseRoutes.length);
  });

  it('应让手工覆盖配置优先于默认生成配置', () => {
    const endpoint = createApiExplorerEndpoint(
      {
        name: 'getSearchByKey',
        method: 'GET',
        routePath: '/getSearchByKey/:key?/:limit?/:page?/:catZhida?',
        category: 'Search',
      },
      {
        description: 'Search songs, singers, or albums by keyword.',
        queryParams: [
          {
            key: 'key',
            label: 'Keyword',
            required: true,
          },
        ],
      },
    );

    expect(endpoint.description).toBe('Search songs, singers, or albums by keyword.');
    expect(endpoint.queryParams).toEqual([
      expect.objectContaining({
        key: 'key',
        required: true,
      }),
    ]);
  });

  it('应按接口名、分类和路径进行搜索过滤', () => {
    const filtered = filterApiExplorerEndpoints(apiExplorerMetadata.endpoints, 'search');

    expect(filtered).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'get-hotkey' }),
        expect.objectContaining({ id: 'get-search' }),
      ]),
    );
  });

  it('应按请求方法过滤接口列表', () => {
    const filtered = filterApiExplorerEndpoints(apiExplorerMetadata.endpoints, '', 'POST');

    expect(filtered).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'batch-get-song-info', method: 'POST' }),
        expect.objectContaining({ id: 'batch-get-song-lists', method: 'POST' }),
      ]),
    );
    expect(filtered.every((endpoint) => endpoint.method === 'POST')).toBe(true);
  });

  it('应创建 pending 状态的请求日志记录', () => {
    const endpoint = apiExplorerMetadata.endpoints.find(({ id }) => id === 'get-search');

    expect(endpoint).toBeDefined();
    if (!endpoint) {
      throw new Error('Expected get-search endpoint to exist.');
    }

    expect(
      createApiExplorerRequestLogEntry(
        endpoint,
        {
          url: '/search?keyword=%E5%91%A8%E6%9D%B0%E4%BC%A6',
        },
        {
          id: 'log-1',
          timestamp: '2026-05-01T12:00:00.000Z',
        },
      ),
    ).toEqual(
      expect.objectContaining({
        id: 'log-1',
        endpointId: 'get-search',
        status: 'pending',
        requestBody: '',
        responsePreview: '请求进行中...',
      }),
    );
  });

  it('应只更新目标请求日志记录', () => {
    const logs = [
      {
        id: 'log-1',
        timestamp: '2026-05-01T12:00:00.000Z',
        endpointId: 'get-search',
        endpointName: 'getSearch',
        method: 'GET' as const,
        url: '/search?keyword=%E5%91%A8%E6%9D%B0%E4%BC%A6',
        requestBody: '',
        status: 'pending' as const,
        duration: null,
        responsePreview: '请求进行中...',
        errorMessage: '',
      },
      {
        id: 'log-2',
        timestamp: '2026-05-01T12:01:00.000Z',
        endpointId: 'batch-get-song-info',
        endpointName: 'batchGetSongInfo',
        method: 'POST' as const,
        url: '/batchGetSongInfo',
        requestBody: '{"songs":[]}',
        status: 'pending' as const,
        duration: null,
        responsePreview: '请求进行中...',
        errorMessage: '',
      },
    ];

    expect(
      updateApiExplorerRequestLogEntry(logs, 'log-2', {
        status: 200,
        duration: 123,
        responsePreview: '{"code":0}',
      }),
    ).toEqual([
      logs[0],
      expect.objectContaining({
        id: 'log-2',
        status: 200,
        duration: 123,
        responsePreview: '{"code":0}',
      }),
    ]);
  });
});
