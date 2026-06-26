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

	describe('lookup FK filters -> navigation (Creatio cannot filter scalar XxxId)', () => {
		const guid = '11111111-2222-3333-4444-555555555555';

		it('rewrites <Lookup>Id eq <guid> to <Lookup>/Id eq <guid> (unquoted)', () => {
			expect(buildFilterFromStructured({ all: [{ field: 'ContactId', value: guid }] })).toBe(
				`Contact/Id eq ${guid}`,
			);
			expect(buildFilterFromStructured({ all: [{ field: 'AccountId', value: guid }] })).toBe(
				`Account/Id eq ${guid}`,
			);
			expect(
				buildFilterFromStructured({ all: [{ field: 'CreatedById', value: guid }] }),
			).toBe(`CreatedBy/Id eq ${guid}`);
		});

		it('rewrites for the ne operator too', () => {
			expect(
				buildFilterFromStructured({ all: [{ field: 'OwnerId', op: 'ne', value: guid }] }),
			).toBe(`Owner/Id ne ${guid}`);
		});

		it('rewrites every value of an in-list', () => {
			const g2 = '99999999-2222-3333-4444-555555555555';
			expect(
				buildFilterFromStructured({ all: [{ field: 'ContactId', in: [guid, g2] }] }),
			).toBe(`(Contact/Id eq ${guid} or Contact/Id eq ${g2})`);
		});

		it('leaves the primary key Id untouched', () => {
			expect(buildFilterFromStructured({ all: [{ field: 'Id', value: guid }] })).toBe(
				`Id eq ${guid}`,
			);
		});

		it('accepts an already-navigated Contact/Id (unquoted GUID)', () => {
			expect(buildFilterFromStructured({ all: [{ field: 'Contact/Id', value: guid }] })).toBe(
				`Contact/Id eq ${guid}`,
			);
		});

		it('does not rewrite when the value is not a GUID', () => {
			expect(buildFilterFromStructured({ all: [{ field: 'ContactId', value: 'abc' }] })).toBe(
				"ContactId eq 'abc'",
			);
		});

		it('keeps navigation string filters quoted (Contact/Name)', () => {
			expect(
				buildFilterFromStructured({ all: [{ field: 'Contact/Name', value: 'Andrew' }] }),
			).toBe("Contact/Name eq 'Andrew'");
		});
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
