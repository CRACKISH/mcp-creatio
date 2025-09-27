function isGuid(s: unknown): s is string {
	return (
		typeof s === 'string' &&
		/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(s)
	);
}

function isIdish(field: string): boolean {
	return /(^|\/)Id$/.test(field) || /Id$/i.test(field);
}

function escapeStr(val: string): string {
	return val.replace(/'/g, "''");
}

function literalFor(field: string, value: any): string {
	if (value == null) {
		return 'null';
	}
	const t = typeof value;
	if (t === 'number') {
		return String(value);
	}
	if (t === 'boolean') {
		return value ? 'true' : 'false';
	}
	if (t === 'string') {
		const v = String(value);
		if (isGuid(v) && isIdish(field)) {
			return `guid'${v}'`;
		}
		return `'${escapeStr(v)}'`;
	}
	return `'${escapeStr(JSON.stringify(value))}'`;
}

function buildCondition(c: any): string | undefined {
	if (!c || !c.field) {
		return undefined;
	}
	const field = String(c.field);
	if (Array.isArray((c as any).in)) {
		const values = (c as any).in as any[];
		if (!values.length) {
			return undefined;
		}
		const parts = values.map((v) => `${field} eq ${literalFor(field, v)}`);
		return parts.length === 1 ? parts[0] : `(${parts.join(' or ')})`;
	}
	const op = String(c.op || 'eq');
	const value = (c as any).value;
	if (op === 'contains' || op === 'startswith' || op === 'endswith') {
		return `${op}(${field},${literalFor(field, value)})`;
	}
	if (value == null && (op === 'eq' || op === 'ne')) {
		return `${field} ${op} null`;
	}
	return `${field} ${op} ${literalFor(field, value)}`;
}

export function buildFilterFromStructured(filters: any | undefined): string | undefined {
	if (!filters || typeof filters !== 'object') {
		return undefined;
	}
	const andParts: string[] = [];
	const orParts: string[] = [];
	if (Array.isArray(filters.all)) {
		for (const c of filters.all) {
			const s = buildCondition(c);
			if (s) {
				andParts.push(s);
			}
		}
	}
	if (Array.isArray(filters.any)) {
		for (const c of filters.any) {
			const s = buildCondition(c);
			if (s) {
				orParts.push(s);
			}
		}
	}
	const andStr = andParts.join(' and ');
	const orStr = orParts.join(' or ');
	const parts: string[] = [];
	if (andStr) {
		parts.push(andParts.length > 1 ? `(${andStr})` : andStr);
	}
	if (orStr) {
		parts.push(orParts.length > 1 ? `(${orStr})` : orStr);
	}
	if (!parts.length) {
		return undefined;
	}
	return parts.join(' and ');
}
