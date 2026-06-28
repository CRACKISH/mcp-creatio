import { describe, expect, it } from 'vitest';

import {
	DataServiceFilterTranslator,
	DataValueType,
	FilterComparisonType,
	FilterType,
	LogicalOperation,
	ODataQueryTranslator,
} from '../../src/creatio';
import { buildFilterNode } from '../../src/server/mcp/filters';

/**
 * Exhaustive filter-translation matrix: every operator, value type, lookup form and
 * combination, compiled from the tool `{all,any}` shape and rendered to BOTH dialects.
 * OData asserts the `$filter` string; DataService asserts the Filters tree.
 */

const G = '8ecab4a1-0ca3-4515-9399-efe0a19390bd';
const G2 = '11111111-2222-3333-4444-555555555555';

const odata = (filters: unknown): string | undefined =>
	new ODataQueryTranslator().translateFilter(buildFilterNode(filters));

const ds = (filters: unknown): any =>
	new DataServiceFilterTranslator().translate('E', buildFilterNode(filters));
/** Build a single-condition `all` filter. */
const one = (field: string, op: string, value?: unknown, extra?: object) => ({
	all: [{ field, op, ...(value === undefined ? {} : { value }), ...extra }],
});

// ───────────────────────────── OData ─────────────────────────────

describe('OData filter matrix', () => {
	describe('comparison operators', () => {
		it.each([
			['eq', 'X eq 5'],
			['ne', 'X ne 5'],
			['gt', 'X gt 5'],
			['ge', 'X ge 5'],
			['lt', 'X lt 5'],
			['le', 'X le 5'],
		])('%s', (op, expected) => {
			expect(odata(one('X', op, 5))).toBe(expected);
		});

		it.each([
			['contains', "contains(X,'a')"],
			['startswith', "startswith(X,'a')"],
			['endswith', "endswith(X,'a')"],
		])('%s', (op, expected) => {
			expect(odata(one('X', op, 'a'))).toBe(expected);
		});

		it('eq null -> `X eq null`, ne null -> `X ne null`', () => {
			expect(odata(one('X', 'eq', null))).toBe('X eq null');
			expect(odata(one('X', 'ne', null))).toBe('X ne null');
		});
	});

	describe('value types', () => {
		it.each([
			['string', 'Bob', "X eq 'Bob'"],
			['integer', 5, 'X eq 5'],
			['float', 5.5, 'X eq 5.5'],
			['boolean true', true, 'X eq true'],
			['boolean false', false, 'X eq false'],
			['string with quote', "O'Brien", "X eq 'O''Brien'"],
			['guid on a non-Id column (quoted)', G, `X eq '${G}'`],
		])('%s', (_name, value, expected) => {
			expect(odata(one('X', 'eq', value))).toBe(expected);
		});

		it('guid on the primary key Id is bare (unquoted)', () => {
			expect(odata(one('Id', 'eq', G))).toBe(`Id eq ${G}`);
		});

		// Regression: OData v4 datetime/date literals MUST be unquoted, else 400
		// "incompatible types Edm.DateTimeOffset and Edm.String" (found in live regression).
		it.each([
			['datetime with Z', '2026-06-01T00:00:00Z', 'CreatedOn ge 2026-06-01T00:00:00Z'],
			['date only', '2026-06-01', 'CreatedOn ge 2026-06-01'],
			[
				'datetime with offset',
				'2026-06-01T10:00:00+03:00',
				'CreatedOn ge 2026-06-01T10:00:00+03:00',
			],
		])('ISO %s is emitted UNQUOTED', (_name, value, expected) => {
			expect(odata(one('CreatedOn', 'ge', value))).toBe(expected);
		});

		it('a date-shaped value inside a string function stays quoted', () => {
			expect(odata(one('Name', 'contains', '2026-06-01'))).toBe(
				"contains(Name,'2026-06-01')",
			);
		});
	});

	describe('lookup navigation', () => {
		it.each([
			['scalar FK -> nav/Id', 'ContactId', `Contact/Id eq ${G}`],
			['already-navigated /Id', 'Contact/Id', `Contact/Id eq ${G}`],
			['nested scalar FK -> nav/Id', 'Contact/TypeId', `Contact/Type/Id eq ${G}`],
			['explicit nested /Id', 'Contact/Type/Id', `Contact/Type/Id eq ${G}`],
		])('%s', (_name, field, expected) => {
			expect(odata(one(field, 'eq', G))).toBe(expected);
		});

		it('lookup by display name stays quoted', () => {
			expect(odata(one('Contact/Name', 'eq', 'Acme'))).toBe("Contact/Name eq 'Acme'");
		});

		it('a bare column without an Id signal is NOT auto-navigated (quoted)', () => {
			expect(odata(one('Owner', 'eq', G))).toBe(`Owner eq '${G}'`);
		});
	});

	describe('in-lists', () => {
		it('strings -> OR group', () => {
			expect(odata(one('Status', undefined, undefined, { in: ['a', 'b'] }))).toBe(
				"(Status eq 'a' or Status eq 'b')",
			);
		});
		it('FK guids -> navigated OR group', () => {
			expect(odata(one('ContactId', undefined, undefined, { in: [G, G2] }))).toBe(
				`(Contact/Id eq ${G} or Contact/Id eq ${G2})`,
			);
		});
		it('single-element in-list -> no parentheses', () => {
			expect(odata(one('Status', undefined, undefined, { in: ['a'] }))).toBe("Status eq 'a'");
		});
	});

	describe('combinations', () => {
		it('multiple AND', () => {
			expect(
				odata({
					all: [
						{ field: 'A', op: 'eq', value: 1 },
						{ field: 'B', op: 'eq', value: 2 },
					],
				}),
			).toBe('(A eq 1 and B eq 2)');
		});
		it('multiple OR', () => {
			expect(
				odata({
					any: [
						{ field: 'A', op: 'eq', value: 1 },
						{ field: 'B', op: 'eq', value: 2 },
					],
				}),
			).toBe('(A eq 1 or B eq 2)');
		});
		it('AND + OR combined', () => {
			expect(
				odata({
					all: [{ field: 'A', op: 'eq', value: 1 }],
					any: [
						{ field: 'B', op: 'eq', value: 2 },
						{ field: 'C', op: 'eq', value: 3 },
					],
				}),
			).toBe('(A eq 1 and (B eq 2 or C eq 3))');
		});
		it('mixed types in one AND group', () => {
			expect(
				odata({
					all: [
						{ field: 'IsActive', op: 'eq', value: true },
						{ field: 'Name', op: 'contains', value: 'Jo' },
						{ field: 'ContactId', op: 'eq', value: G },
					],
				}),
			).toBe(`(IsActive eq true and contains(Name,'Jo') and Contact/Id eq ${G})`);
		});
		it('empty / absent filters -> undefined', () => {
			expect(odata(undefined)).toBeUndefined();
			expect(odata({})).toBeUndefined();
			expect(odata({ all: [], any: [] })).toBeUndefined();
		});
	});
});

// ─────────────────────────── DataService ───────────────────────────

describe('DataService filter matrix', () => {
	describe('comparison operators map to FilterComparisonType', () => {
		it.each([
			['eq', FilterComparisonType.Equal],
			['ne', FilterComparisonType.NotEqual],
			['gt', FilterComparisonType.Greater],
			['ge', FilterComparisonType.GreaterOrEqual],
			['lt', FilterComparisonType.Less],
			['le', FilterComparisonType.LessOrEqual],
			['contains', FilterComparisonType.Contain],
			['startswith', FilterComparisonType.StartWith],
			['endswith', FilterComparisonType.EndWith],
		])('%s', (op, expected) => {
			expect(
				ds(one('X', op, op === 'contains' || op.endsWith('with') ? 'a' : 5)).comparisonType,
			).toBe(expected);
		});

		it('eq/ne null -> IsNull / IsNotNull filter', () => {
			const isNull = ds(one('X', 'eq', null));
			expect(isNull.filterType).toBe(FilterType.IsNullFilter);
			expect(isNull.comparisonType).toBe(FilterComparisonType.IsNull);
			expect(isNull.rightExpression).toBeUndefined();
			expect(ds(one('X', 'ne', null)).comparisonType).toBe(FilterComparisonType.IsNotNull);
		});
	});

	describe('value types map to DataValueType', () => {
		it.each([
			['string', 'Bob', DataValueType.Text],
			['integer', 5, DataValueType.Integer],
			['float', 5.5, DataValueType.Float],
			['boolean', true, DataValueType.Boolean],
			['guid', G, DataValueType.Guid],
			['iso date', '2026-01-01', DataValueType.DateTime],
			['iso datetime', '2026-01-01T10:00:00Z', DataValueType.DateTime],
		])('%s', (_name, value, expected) => {
			expect(ds(one('X', 'eq', value)).rightExpression.parameter.dataValueType).toBe(
				expected,
			);
		});
	});

	describe('lookup navigation (column paths)', () => {
		it.each([
			['scalar FK -> nav.Id', 'ContactId', 'Contact.Id'],
			['slash nav -> dot path', 'Contact/Id', 'Contact.Id'],
			['nested scalar FK -> nav.Id', 'Contact/TypeId', 'Contact.Type.Id'],
			['explicit nested', 'Contact/Type/Id', 'Contact.Type.Id'],
		])('%s', (_name, field, path) => {
			expect(ds(one(field, 'eq', G)).leftExpression.columnPath).toBe(path);
		});

		it('lookup by display name -> dotted path, Text value', () => {
			const f = ds(one('Contact/Name', 'eq', 'Acme'));
			expect(f.leftExpression.columnPath).toBe('Contact.Name');
			expect(f.rightExpression.parameter.dataValueType).toBe(DataValueType.Text);
		});

		it('a bare column without an Id signal is NOT auto-navigated', () => {
			expect(ds(one('Owner', 'eq', G)).leftExpression.columnPath).toBe('Owner');
		});
	});

	describe('in-lists and combinations', () => {
		it('in-list -> OR group of equalities (FK navigated)', () => {
			const f = ds(one('ContactId', undefined, undefined, { in: [G, G2] }));
			expect(f.filterType).toBe(FilterType.Group);
			expect(f.logicalOperation).toBe(LogicalOperation.Or);
			expect(Object.keys(f.items)).toHaveLength(2);
			expect(f.items.item1.leftExpression.columnPath).toBe('Contact.Id');
			expect(f.items.item2.rightExpression.parameter.value).toBe(G2);
		});

		it('multiple AND -> And group', () => {
			const f = ds({
				all: [
					{ field: 'A', op: 'eq', value: 1 },
					{ field: 'B', op: 'eq', value: 2 },
				],
			});
			expect(f.filterType).toBe(FilterType.Group);
			expect(f.logicalOperation).toBe(LogicalOperation.And);
			expect(Object.keys(f.items)).toHaveLength(2);
		});

		it('AND + OR -> nested groups carrying the root schema', () => {
			const f = ds({
				all: [{ field: 'A', op: 'eq', value: 1 }],
				any: [
					{ field: 'B', op: 'eq', value: 2 },
					{ field: 'C', op: 'eq', value: 3 },
				],
			});
			expect(f.rootSchemaName).toBe('E');
			expect(f.logicalOperation).toBe(LogicalOperation.And);
			expect(f.items.item1.leftExpression.columnPath).toBe('A');
			expect(f.items.item2.logicalOperation).toBe(LogicalOperation.Or);
		});

		it('empty / absent filters -> undefined', () => {
			expect(ds(undefined)).toBeUndefined();
			expect(ds({ all: [], any: [] })).toBeUndefined();
		});
	});
});
