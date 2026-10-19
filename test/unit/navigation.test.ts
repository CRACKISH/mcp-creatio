import { afterEach, describe, expect, it, vi } from 'vitest';

import { NavigationServiceProvider } from '../../src/creatio';
import { runWithContext } from '../../src/utils';
import { makeHttpClientHarness } from '../support/http-client';

const ID = '11111111-1111-1111-1111-111111111111';

afterEach(() => vi.unstubAllGlobals());

function provider() {
	const { client, fetchMock } = makeHttpClientHarness(() => new Response(''));
	return { navigation: new NavigationServiceProvider(client), fetchMock };
}

describe('NavigationServiceProvider.recordUrl', () => {
	it("builds a link to Creatio's record router without calling Creatio", () => {
		const { navigation, fetchMock } = provider();
		expect(navigation.recordUrl('Contact', ID)).toBe(
			`https://tenant.creatio.local/0/rest/NavigationService/Redirect?schemaName=Contact&recordId=${ID}`,
		);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('targets the calling tenant when the gateway overrides the base URL', async () => {
		const { navigation } = provider();
		const url = await runWithContext(
			{ baseUrlOverride: 'https://other.creatio.local/' },
			async () => navigation.recordUrl('Account', ID),
		);
		expect(
			url.startsWith('https://other.creatio.local/0/rest/NavigationService/Redirect?'),
		).toBe(true);
	});

	it.each([
		['an injected entity name', 'Contact&recordId=x', ID, /invalid_entity_name/],
		['a non-GUID id', 'Contact', '1 OR 1=1', /invalid_record_id/],
	])('rejects %s', (_label, entity, id, error) => {
		expect(() => provider().navigation.recordUrl(entity, id)).toThrow(error);
	});
});
