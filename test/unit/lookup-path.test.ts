import { describe, expect, it } from 'vitest';

import { lookupIdPath, needsLookupNames } from '../../src/creatio/services/lookup-path';
import { ODataQueryTranslator } from '../../src/creatio/services/odata/odata-query-translator';

describe('lookupIdPath with the entity lookups known', () => {
	const lookups = new Set(['Account', 'Owner']);

	it('navigates a real lookup FK and keeps a genuine Id-suffixed column', () => {
		expect(lookupIdPath('AccountId', '/', lookups)).toBe('Account/Id');
		expect(lookupIdPath('RecordId', '/', lookups)).toBe('RecordId');
		expect(lookupIdPath('RecordId', '.', new Set())).toBe('RecordId');
	});

	it('keeps the heuristic without lookups and for nested paths', () => {
		expect(lookupIdPath('RecordId', '.')).toBe('Record.Id');
		expect(lookupIdPath('Contact/TypeId', '/', lookups)).toBe('Contact/Type/Id');
		expect(lookupIdPath('Id', '.', lookups)).toBe('Id');
	});
});

describe('needsLookupNames', () => {
	it('is true only for a top-level XxxId in columns, order or filter', () => {
		expect(needsLookupNames({ entity: 'X', columns: ['Name', 'Id'] })).toBe(false);
		expect(needsLookupNames({ entity: 'X', columns: ['Account.Name'] })).toBe(false);
		expect(needsLookupNames({ entity: 'X', columns: ['RecordId'] })).toBe(true);
		expect(needsLookupNames({ entity: 'X', order: [{ field: 'OwnerId', dir: 'asc' }] })).toBe(
			true,
		);
		expect(
			needsLookupNames({
				entity: 'X',
				filter: {
					kind: 'group',
					logic: 'or',
					items: [{ kind: 'in', field: 'AccountId', values: ['a'] }],
				},
			}),
		).toBe(true);
	});
});

describe('ODataQueryTranslator with the entity lookups known', () => {
	const G = '11111111-1111-1111-1111-111111111111';
	const filterOf = (field: string, lookups?: Set<string>) =>
		decodeURIComponent(
			new ODataQueryTranslator()
				.buildQueryParams(
					{ entity: 'SysFile', filter: { kind: 'condition', field, op: 'eq', value: G } },
					lookups,
				)
				.find((p) => p.startsWith('$filter='))!
				.slice('$filter='.length),
		);

	it('filters a real GUID column directly and navigates a real lookup FK', () => {
		const lookups = new Set(['CreatedBy']);
		expect(filterOf('RecordId', lookups)).toBe(`RecordId eq ${G}`);
		expect(filterOf('CreatedById', lookups)).toBe(`CreatedBy/Id eq ${G}`);
		expect(filterOf('RecordId')).toBe(`Record/Id eq ${G}`); // no metadata: the heuristic
	});
});

describe('ODataQueryTranslator accepts the dotted related-column path', () => {
	it('maps Account.Name to Account/Name in filters, in-lists and orderBy', () => {
		const params = new ODataQueryTranslator()
			.buildQueryParams({
				entity: 'Contact',
				filter: {
					kind: 'group',
					logic: 'and',
					items: [
						{ kind: 'condition', field: 'Account.Name', op: 'contains', value: 'Acme' },
						{ kind: 'in', field: 'Account.Code', values: ['A', 'B'] },
					],
				},
				order: [{ field: 'Account.Name', dir: 'desc' }],
			})
			.map(decodeURIComponent);
		expect(params).toContain(
			"$filter=(contains(Account/Name,'Acme') and (Account/Code eq 'A' or Account/Code eq 'B'))",
		);
		expect(params).toContain('$orderby=Account/Name desc');
	});

	it('still rejects an unsafe identifier', () => {
		expect(() =>
			new ODataQueryTranslator().buildQueryParams({
				entity: 'Contact',
				columns: ['Name;drop'],
			}),
		).toThrow(/unsafe_odata_identifier/);
	});
});
