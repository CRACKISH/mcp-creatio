export function env(name: string): string | undefined {
	const v = process.env[name];
	return (v && v.trim()) || undefined;
}

export function envBool(name: string, def: boolean): boolean {
	const v = env(name);
	if (v == null) {
		return def;
	}
	return v.toLowerCase() === 'true' || v === '1';
}
