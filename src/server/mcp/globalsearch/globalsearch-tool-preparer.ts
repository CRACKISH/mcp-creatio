import { withValidation } from '../../../utils';
import { ToolPreparer, ToolRegistrar } from '../tool-preparer';
import { globalSearchDescriptor, globalSearchInput } from '../tools-data';

import { GlobalSearchClient } from './globalsearch-client';

/** Stable capability key. */
export const GLOBAL_SEARCH_CAPABILITY = 'global-search';

/**
 * Registers the `global-search` tool, but only when Global Search is enabled on
 * the environment. Encapsulates everything Global-Search-specific so the Server
 * stays agnostic (Open/Closed: adding capabilities = adding preparers).
 */
export class GlobalSearchToolPreparer implements ToolPreparer {
	private readonly _client: GlobalSearchClient;

	public readonly name = GLOBAL_SEARCH_CAPABILITY;

	constructor(client: GlobalSearchClient) {
		this._client = client;
	}

	public async prepare(registrar: ToolRegistrar): Promise<boolean> {
		const enabled = await this._client.isEnabled();
		if (!enabled) {
			return false;
		}
		registrar.register(
			'global-search',
			globalSearchDescriptor,
			withValidation(globalSearchInput, ({ query, entities, limit, from }) =>
				this._client.search({
					query,
					type: entities && entities.length > 0 ? entities.join(',') : undefined,
					recordCount: limit,
					from,
				}),
			),
		);
		return true;
	}
}
