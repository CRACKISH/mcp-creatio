import { env } from './utils';

export const HTTP_MCP_PORT = Number(env('PORT')) || 3000;
