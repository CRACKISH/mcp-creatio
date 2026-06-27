import { env } from './utils';

// Canonical CREATIO_MCP_PORT; env() transparently falls back to the conventional PORT (no warning).
export const HTTP_MCP_PORT = Number(env('CREATIO_MCP_PORT')) || 3000;
