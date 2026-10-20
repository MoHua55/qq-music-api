import {
  BaseServiceParams,
  BaseServiceResponse,
  BaseUCommonParams,
  BaseYCommonParams,
  TypedBodyContext,
  TypedQueryContext,
} from '../../src/types/core/request';
import { assertType, type IsEqual } from './assert-type';

// ==========================================
// Service 层参数接口测试
// ==========================================

// BaseServiceParams Test
const serviceParams: BaseServiceParams = {
  method: 'post',
  options: { timeout: 1000 },
  params: { id: 1 },
};
assertType<IsEqual<typeof serviceParams.method, string | undefined>>();

// BaseUCommonParams Test (Omit 'params')
const uParams: BaseUCommonParams = {
  method: 'get',
  options: { headers: { 'Content-Type': 'application/json' } },
};
// @ts-expect-error
uParams.params = {};

// BaseYCommonParams Test (Omit 'params', with 'url' and 'hasCommonParams')
const yParams: BaseYCommonParams = {
  url: '/api/test',
  hasCommonParams: false,
  method: 'get',
};
assertType<IsEqual<typeof yParams.url, string>>();

// BaseServiceResponse Test
const response: BaseServiceResponse<{ name: string }> = {
  status: 200,
  body: {
    response: { name: 'test' },
  },
};
assertType<IsEqual<typeof response.status, number>>();

// ==========================================
// Controller 层 Context 接口测试
// ==========================================

// TypedQueryContext Test
interface MyQuery {
  id: string;
  limit?: number;
}
const ctxQuery = {
  query: { id: '123', limit: 10 },
} as unknown as TypedQueryContext<MyQuery>;

assertType<IsEqual<typeof ctxQuery.query.id, string | undefined>>();

// TypedBodyContext Test
interface MyBody {
  username: string;
}
const ctxBody = {
  request: { body: { username: 'Alice' } },
} as unknown as TypedBodyContext<MyBody>;

assertType<IsEqual<typeof ctxBody.request.body.username, string>>();

describe('core request types', () => {
  it('should keep compile-time assertions valid', () => {
    expect(true).toBe(true);
  });
});
