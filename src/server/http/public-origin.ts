import { env } from '../../utils';

import type { Request } from 'express';

/**
 * The deployment's PUBLIC origin — what clients actually reach. Behind a TLS-terminating proxy /
 * ingress, `req.protocol`/`req.get('host')` reflect the INTERNAL hop (e.g. `http://mcp:3000`), which
 * would poison the broker's issuer/audience, redirect URIs, and discovery metadata. Set
 * `CREATIO_MCP_PUBLIC_URL` (e.g. `https://mcp.example.com`) to pin the external origin; when unset we
 * fall back to the request's own origin (correct for a direct/local deployment).
 */
export function resolvePublicOrigin(req: Request): string {
	const configured = env('CREATIO_MCP_PUBLIC_URL');
	if (configured) {
		return configured.replace(/\/+$/, '');
	}
	return `${req.protocol}://${req.get('host')}`;
}
