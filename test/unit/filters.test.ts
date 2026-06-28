import { describe, expect, it } from 'vitest';

import { ODataQueryTranslator } from '../../src/creatio';
import { buildFilterNode, parseOrderBy } from '../../src/server/mcp/filters';

// The tool-level `{ all, any }` shape is compiled to a neutral FilterNode, then rendered to
// OData by the translator. This composition replaces the old direct buildFilterFromStructured.
const odata = (filters: unknown): string | undefined =>
	new ODataQueryTranslator().translateFilter(buildFilterNode(filters));

describe('buildFilterNode (tool filters -> neutral AST)', () => {
	it('returns undefined for empty / invalid input', () => {
		expect(buildFilterNode(undefined)).toBeUndefined();
		expect(buildFilterNode({})).toBeUndefined();
		expect(buildFilterNode({ all: [], any: [] })).toBeUndefined();
	});

	it('builds an AND group from `all`', () => {
		expect(buildFilterNode({ all: [{ field: 'Name', op: 'eq', value: 'Bob' }] })).toEqual({
			kind: 'group',
			logic: 'and',
			items: [{ kind: 'condition', field: 'Name', op: 'eq', value: 'Bob' }],
		});
	});

	it('combines `all` and `any` under a top-level AND group', () => {
		const node = buildFilterNode({
			all: [{ field: 'A', op: 'eq', value: 1 }],
			any: [{ field: 'B', op: 'eq', value: 2 }],
		});
		expect(node).toEqual({
			kind: 'group',
			logic: 'and',
			items: [
				{
					kind: 'group',
					logic: 'and',
					items: [{ kind: 'condition', field: 'A', op: 'eq', value: 1 }],
				},
				{
					kind: 'group',
					logic: 'or',
					items: [{ kind: 'condition', field: 'B', op: 'eq', value: 2 }],
				},
			],
		});
	});

	it('maps an `in` list to an in-node and null eq/ne to isNull/isNotNull', () => {
		expect(buildFilterNode({ all: [{ field: 'S', in: ['a', 'b'] }] })).toEqual({
			kind: 'group',
			logic: 'and',
			items: [{ kind: 'in', field: 'S', values: ['a', 'b'] }],
		});
		expect(buildFilterNode({ all: [{ field: 'X', op: 'eq', value: null }] })).toEqual({
			kind: 'group',
			logic: 'and',
			items: [{ kind: 'condition', field: 'X', op: 'isNull' }],
		});
		expect(buildFilterNode({ all: [{ field: 'X', op: 'ne', value: null }] })).toEqual({
			kind: 'group',
			logic: 'and',
			items: [{ kind: 'condition', field: 'X', op: 'isNotNull' }],
		});
	});

	it('defaults a missing op to eq', () => {
		expect(buildFilterNode({ all: [{ field: 'Name', value: 'Bob' }] })).toEqual({
			kind: 'group',
			logic: 'and',
			items: [{ kind: 'condition', field: 'Name', op: 'eq', value: 'Bob' }],
		});
	});
});

describe('ODataQueryTranslator filter rendering', () => {
	it('returns undefined for empty input', () => {
		expect(odata(undefined)).toBeUndefined();
		expect(odata({ all: [], any: [] })).toBeUndefined();
	});

	it('joins a single all-condition without parentheses', () => {
		expect(odata({ all: [{ field: 'Name', value: 'Bob' }] })).toBe("Name eq 'Bob'");
	});

	it('wraps multiple all-conditions in parentheses joined by and', () => {
		expect(
			odata({
				all: [
					{ field: 'Name', value: 'Bob' },
					{ field: 'Age', value: 30 },
				],
			}),
		).toBe("(Name eq 'Bob' and Age eq 30)");
	});

	it('joins any-conditions with or', () => {
		expect(
			odata({
				any: [
					{ field: 'Name', value: 'A' },
					{ field: 'Name', value: 'B' },
				],
			}),
		).toBe("(Name eq 'A' or Name eq 'B')");
	});

	it('supports function operators', () => {
		expect(odata({ all: [{ field: 'Name', op: 'contains', value: 'ab' }] })).toBe(
			"contains(Name,'ab')",
		);
	});

	it('emits `field op null` for null comparisons', () => {
		expect(odata({ all: [{ field: 'X', op: 'eq', value: null }] })).toBe('X eq null');
	});

	it('expands an in-list into an or-group', () => {
		expect(odata({ all: [{ field: 'Status', in: ['a', 'b'] }] })).toBe(
			"(Status eq 'a' or Status eq 'b')",
		);
	});

	it('keeps a bare GUID for Id fields but quotes other strings', () => {
		const guid = '11111111-2222-3333-4444-555555555555';
		expect(odata({ all: [{ field: 'Id', value: guid }] })).toBe(`Id eq ${guid}`);
		expect(odata({ all: [{ field: 'Name', value: guid }] })).toBe(`Name eq '${guid}'`);
	});

	describe('lookup FK filters -> navigation (Creatio cannot filter scalar XxxId)', () => {
		const guid = '11111111-2222-3333-4444-555555555555';

		it('rewrites <Lookup>Id eq <guid> to <Lookup>/Id eq <guid> (unquoted)', () => {
			expect(odata({ all: [{ field: 'ContactId', value: guid }] })).toBe(
				`Contact/Id eq ${guid}`,
			);
			expect(odata({ all: [{ field: 'AccountId', value: guid }] })).toBe(
				`Account/Id eq ${guid}`,
			);
			expect(odata({ all: [{ field: 'CreatedById', value: guid }] })).toBe(
				`CreatedBy/Id eq ${guid}`,
			);
		});

		it('rewrites for the ne operator too', () => {
			expect(odata({ all: [{ field: 'OwnerId', op: 'ne', value: guid }] })).toBe(
				`Owner/Id ne ${guid}`,
			);
		});

		it('rewrites every value of an in-list', () => {
			const g2 = '99999999-2222-3333-4444-555555555555';
			expect(odata({ all: [{ field: 'ContactId', in: [guid, g2] }] })).toBe(
				`(Contact/Id eq ${guid} or Contact/Id eq ${g2})`,
			);
		});

		it('leaves the primary key Id untouched', () => {
			expect(odata({ all: [{ field: 'Id', value: guid }] })).toBe(`Id eq ${guid}`);
		});

		it('accepts an already-navigated Contact/Id (unquoted GUID)', () => {
			expect(odata({ all: [{ field: 'Contact/Id', value: guid }] })).toBe(
				`Contact/Id eq ${guid}`,
			);
		});

		it('does not rewrite when the value is not a GUID', () => {
			expect(odata({ all: [{ field: 'ContactId', value: 'abc' }] })).toBe(
				"ContactId eq 'abc'",
			);
		});

		it('keeps navigation string filters quoted (Contact/Name)', () => {
			expect(odata({ all: [{ field: 'Contact/Name', value: 'Andrew' }] })).toBe(
				"Contact/Name eq 'Andrew'",
			);
		});
	});

	it('escapes single quotes in string literals', () => {
		expect(odata({ all: [{ field: 'Name', value: "O'Brien" }] })).toBe("Name eq 'O''Brien'");
	});

	it('renders numbers and booleans as bare literals', () => {
		expect(odata({ all: [{ field: 'Active', value: true }] })).toBe('Active eq true');
		expect(odata({ all: [{ field: 'Count', value: 5 }] })).toBe('Count eq 5');
	});
});

describe('parseOrderBy', () => {
	it('returns undefined for empty / non-string input', () => {
		expect(parseOrderBy(undefined)).toBeUndefined();
		expect(parseOrderBy('')).toBeUndefined();
		expect(parseOrderBy('   ')).toBeUndefined();
	});

	it('parses single and multi-term clauses with default-asc direction', () => {
		expect(parseOrderBy('Name')).toEqual([{ field: 'Name', dir: 'asc' }]);
		expect(parseOrderBy('CreatedOn desc, Name')).toEqual([
			{ field: 'CreatedOn', dir: 'desc' },
			{ field: 'Name', dir: 'asc' },
		]);
	});
});
