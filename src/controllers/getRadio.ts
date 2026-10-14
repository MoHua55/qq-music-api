import type { Context } from 'koa';
import services from '../services';
import { getTypedQuery } from '../types/core/request';
import { getAuthToken } from './login';

// src/controllers/getRadio.ts

interface RadioTracksQuery {
  id?: string;
}

export const getRadioList = async (ctx: Context): Promise<void> => {
  const result = await services.getRadioList({ token: getAuthToken(ctx) });
  ctx.status = result.status;
  ctx.set(result.headers);
  ctx.body = result.body;
};

export const getRadioTracks = async (ctx: Context): Promise<void> => {
  const { id } = getTypedQuery<RadioTracksQuery>(ctx);
  const result = await services.getRadioTracks({ token: getAuthToken(ctx), id });
  ctx.status = result.status;
  ctx.set(result.headers);
  ctx.body = result.body;
};
