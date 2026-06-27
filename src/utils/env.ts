import { resolveLegacyEnv } from './env-aliases';

function readRaw(name: string): string | undefined {
	const v = process.env[name];
	return (v && v.trim()) || undefined;
}

/**
 * Reads an environment variable by its CANONICAL name, transparently falling back to any legacy
 * alias (see {@link resolveLegacyEnv}) for backward compatibility. Returns `undefined` for unset or
 * blank values.
 */
export function env(name: string): string | undefined {
	return readRaw(name) ?? resolveLegacyEnv(name, readRaw);
}

export function envBool(name: string, def: boolean): boolean {
	const v = env(name);
	if (v == null) {
		return def;
	}
	return v.toLowerCase() === 'true' || v === '1';
}
