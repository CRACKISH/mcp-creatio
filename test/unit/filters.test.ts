import { describe, expect, it } from 'vitest';

import { buildFilterFromStructured } from '../../src/server/mcp/filters';

describe('buildFilterFromStructured', () => {
	it('returns undefined for empty / invalid input', () => {
		expect(buildFilterFromStructured(undefined)).toBeUndefined();
		expect(buildFilterFromStructured({})).toBeUndefined();
		expect(buildFilterFromStructured({ all: [], any: [] })).toBeUndefined();
	});

	it('joins a single all-condition without parentheses', () => {
		expect(buildFilterFromStructured({ all: [{ field: 'Name', value: 'Bob' }] })).toBe(
			"Name eq 'Bob'",
		);
	});

	it('wraps multiple all-conditions in parentheses joined by and', () => {
		expect(
			buildFilterFromStructured({
				all: [
					{ field: 'Name', value: 'Bob' },
					{ field: 'Age', value: 30 },
				],
			}),
		).toBe("(Name eq 'Bob' and Age eq 30)");
	});

	it('joins any-conditions with or', () => {
		expect(
			buildFilterFromStructured({
				any: [
					{ field: 'Name', value: 'A' },
					{ field: 'Name', value: 'B' },
				],
			}),
		).toBe("(Name eq 'A' or Name eq 'B')");
	});

	it('supports function operators', () => {
		expect(
			buildFilterFromStructured({ all: [{ field: 'Name', op: 'contains', value: 'ab' }] }),
		).toBe("contains(Name,'ab')");
	});

	it('emits `field op null` for null comparisons', () => {
		expect(buildFilterFromStructured({ all: [{ field: 'X', op: 'eq', value: null }] })).toBe(
			'X eq null',
		);
	});

	it('expands an in-list into an or-group', () => {
		expect(
			buildFilterFromStructured({ all: [{ field: 'Status', in: ['a', 'b'] }] }),
		).toBe("(Status eq 'a' or Status eq 'b')");
	});

	it('keeps a bare GUID for Id fields but quotes other strings', () => {
		const guid = '11111111-2222-3333-4444-555555555555';
		expect(buildFilterFromStructured({ all: [{ field: 'Id', value: guid }] })).toBe(
			`Id eq ${guid}`,
		);
		expect(buildFilterFromStructured({ all: [{ field: 'Name', value: guid }] })).toBe(
			`Name eq '${guid}'`,
		);
	});

	it('escapes single quotes in string literals', () => {
		expect(buildFilterFromStructured({ all: [{ field: 'Name', value: "O'Brien" }] })).toBe(
			"Name eq 'O''Brien'",
		);
	});

	it('renders numbers and booleans as bare literals', () => {
		expect(buildFilterFromStructured({ all: [{ field: 'Active', value: true }] })).toBe(
			'Active eq true',
		);
		expect(buildFilterFromStructured({ all: [{ field: 'Count', value: 5 }] })).toBe(
			'Count eq 5',
		);
	});
});
