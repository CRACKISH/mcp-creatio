import { withValidation } from '../../../utils';
import { ToolPreparer, ToolRegistrar } from '../tool-preparer';
import {
	dataforgeLookupValuesDescriptor,
	dataforgeLookupValuesInput,
	dataforgeSimilarTablesDescriptor,
	dataforgeSimilarTablesInput,
	dataforgeStatusDescriptor,
	dataforgeStatusInput,
	dataforgeTableDetailsDescriptor,
	dataforgeTableDetailsInput,
	dataforgeTableRelationshipsDescriptor,
	dataforgeTableRelationshipsInput,
} from '../tools-data';

import { DataForgeClient } from './dataforge-client';

/** Stable capability key; also used by the Server to gate describe-entity routing. */
export const DATAFORGE_CAPABILITY = 'dataforge';

/**
 * Registers the DataForge MCP tools, but only when DataForge is enabled on the
 * environment. Encapsulates everything DataForge-specific so the Server remains
 * agnostic of how the capability is probed or wired.
 */
export class DataForgeToolPreparer implements ToolPreparer {
	public readonly name = DATAFORGE_CAPABILITY;

	private readonly _client: DataForgeClient;

	constructor(client: DataForgeClient) {
		this._client = client;
	}

	public async prepare(registrar: ToolRegistrar): Promise<boolean> {
		const enabled = await this._client.isEnabled();
		if (!enabled) {
			return false;
		}
		this._registerTools(registrar);
		return true;
	}

	private _registerTools(registrar: ToolRegistrar): void {
		registrar.register(
			'dataforge-similar-tables',
			dataforgeSimilarTablesDescriptor,
			withValidation(dataforgeSimilarTablesInput, ({ query, limit }) =>
				this._client.getSimilarTableNames({ query, limit }),
			),
		);
		registrar.register(
			'dataforge-table-details',
			dataforgeTableDetailsDescriptor,
			withValidation(dataforgeTableDetailsInput, ({ query, limit }) =>
				this._client.getTableDetails({ query, limit }),
			),
		);
		registrar.register(
			'dataforge-table-relationships',
			dataforgeTableRelationshipsDescriptor,
			withValidation(
				dataforgeTableRelationshipsInput,
				({ sourceTable, targetTable, limit, bidirectional, skipDetails }) =>
					this._client.getTableRelationships({
						sourceTable,
						targetTable,
						limit,
						bidirectional,
						skipDetails,
					}),
			),
		);
		registrar.register(
			'dataforge-lookup-values',
			dataforgeLookupValuesDescriptor,
			withValidation(dataforgeLookupValuesInput, ({ query, schemaName, limit }) =>
				this._client.getLookupValues({ query, schemaName, limit }),
			),
		);
		registrar.register(
			'dataforge-status',
			dataforgeStatusDescriptor,
			withValidation(dataforgeStatusInput, () => this._client.getServiceStatus()),
		);
	}
}
