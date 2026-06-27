import { describe, expect, it } from 'vitest';

import {
	DataServiceFilterTranslator,
	DataValueType,
	ExpressionType,
	FilterComparisonType,
	FilterType,
	LogicalOperation,
	inferDataValueType,
} from '../../src/creatio';
import type { FilterNode } from '../../src/creatio';

const GUID = '11111111-2222-3333-4444-555555555555';

describe('inferDataValueType (heuristic fallback)', () => {
	it('maps JS values + GUID/ISO strings to Terrasoft data value types', () => {
		expect(inferDataValueType('IsActive', true)).toBe(DataValueType.Boolean);
		expect(inferDataValueType('Count', 5)).toBe(DataValueType.Integer);
		expect(inferDataValueType('Amount', 5.5)).toBe(DataValueType.Float);
		expect(inferDataValueType('ContactId', GUID)).toBe(DataValueType.Guid);
		expect(inferDataValueType('CreatedOn', '2026-06-27T00:00:00Z')).toBe(DataValueType.DateTime);
		expect(inferDataValueType('Name', 'Bob')).toBe(DataValueType.Text);
	});
});

describe('DataServiceFilterTranslator', () => {
	const t = new DataServiceFilterTranslator();

	it('translates a single compare into a typed CompareFilter carrying the root schema', () => {
		const node: FilterNode = {
			kind: 'group',
			logic: 'and',
			items: [{ kind: 'condition', field: 'Name', op: 'eq', value: 'Bob' }],
		};
		const f = t.translate('Contact', node)!;
		expect(f.rootSchemaName).toBe('Contact');
		expect(f.filterType).toBe(FilterType.CompareFilter);
		expect(f.comparisonType).toBe(FilterComparisonType.Equal);
		expect(f.leftExpression).toEqual({
			expressionType: ExpressionType.SchemaColumn,
			columnPath: 'Name',
		});
		expect(f.rightExpression).toEqual({
			expressionType: ExpressionType.Parameter,
			parameter: { dataValueType: DataValueType.Text, value: 'Bob' },
		});
	});

	it('builds a logical Group with keyed items for multiple conditions', () => {
		const node: FilterNode = {
			kind: 'group',
			logic: 'or',
			items: [
				{ kind: 'condition', field: 'A', op: 'eq', value: 1 },
				{ kind: 'condition', field: 'B', op: 'gt', value: 2 },
			],
		};
		const f = t.translate('X', node)!;
		expect(f.filterType).toBe(FilterType.Group);
		expect(f.logicalOperation).toBe(LogicalOperation.Or);
		expect(Object.keys(f.items!)).toEqual(['item1', 'item2']);
		expect(f.items!.item2.comparisonType).toBe(FilterComparisonType.Greater);
	});

	it('renders isNull / isNotNull as IsNullFilter without a right expression', () => {
		const isNull = t.translate('X', { kind: 'condition', field: 'Y', op: 'isNull' })!;
		expect(isNull.filterType).toBe(FilterType.IsNullFilter);
		expect(isNull.comparisonType).toBe(FilterComparisonType.IsNull);
		expect(isNull.rightExpression).toBeUndefined();
		const notNull = t.translate('X', { kind: 'condition', field: 'Y', op: 'isNotNull' })!;
		expect(notNull.comparisonType).toBe(FilterComparisonType.IsNotNull);
	});

	it('expands an in-list into an OR group of equalities', () => {
		const f = t.translate('X', { kind: 'in', field: 'S', values: ['a', 'b'] })!;
		expect(f.filterType).toBe(FilterType.Group);
		expect(f.logicalOperation).toBe(LogicalOperation.Or);
		expect(Object.keys(f.items!)).toHaveLength(2);
		expect(f.items!.item1.leftExpression).toEqual({
			expressionType: ExpressionType.SchemaColumn,
			columnPath: 'S',
		});
	});

	it('types a GUID right-side parameter as Guid and a contains as Text', () => {
		const eq = t.translate('X', { kind: 'condition', field: 'ContactId', op: 'eq', value: GUID })!;
		expect(eq.rightExpression).toMatchObject({
			parameter: { dataValueType: DataValueType.Guid, value: GUID },
		});
		const contains = t.translate('X', {
			kind: 'condition',
			field: 'Name',
			op: 'contains',
			value: 'ac',
		})!;
		expect(contains.comparisonType).toBe(FilterComparisonType.Contain);
		expect(contains.rightExpression).toMatchObject({
			parameter: { dataValueType: DataValueType.Text },
		});
	});

	it('supports nested groups (AND of OR)', () => {
		const node: FilterNode = {
			kind: 'group',
			logic: 'and',
			items: [
				{
					kind: 'group',
					logic: 'or',
					items: [
						{ kind: 'condition', field: 'A', op: 'eq', value: 1 },
						{ kind: 'condition', field: 'B', op: 'eq', value: 2 },
					],
				},
				{ kind: 'condition', field: 'C', op: 'eq', value: 3 },
			],
		};
		const f = t.translate('X', node)!;
		expect(f.filterType).toBe(FilterType.Group);
		expect(f.logicalOperation).toBe(LogicalOperation.And);
		expect(f.items!.item1.filterType).toBe(FilterType.Group);
		expect(f.items!.item1.logicalOperation).toBe(LogicalOperation.Or);
		expect(f.items!.item2.filterType).toBe(FilterType.CompareFilter);
	});

	it('returns undefined for an empty tree', () => {
		expect(t.translate('X', undefined)).toBeUndefined();
		expect(t.translate('X', { kind: 'group', logic: 'and', items: [] })).toBeUndefined();
	});

	it('uses an injected schema-aware resolver for parameter typing', () => {
		const resolver = () => DataValueType.Lookup;
		const lt = new DataServiceFilterTranslator(resolver);
		const f = lt.translate('X', { kind: 'condition', field: 'Contact', op: 'eq', value: GUID })!;
		expect(f.rightExpression).toMatchObject({
			parameter: { dataValueType: DataValueType.Lookup },
		});
	});
});
