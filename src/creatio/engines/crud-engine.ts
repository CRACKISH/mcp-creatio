import {
	CrudCapabilities,
	CrudDeleteParams,
	CrudProvider,
	CrudUpdateParams,
	CrudWriteParams,
	EntitySchemaDescription,
	ReadQuery,
	ReadResult,
} from '../contracts';

import { BaseEngine, EngineEnv } from './engine';

export class CrudEngine extends BaseEngine {
	private readonly _provider: CrudProvider;

	public readonly name = 'crud';

	public get kind(): string {
		return this._provider.kind;
	}

	/** Read features the active backend honors — drives which read params the tool registers. */
	public get capabilities(): CrudCapabilities {
		return this._provider.capabilities;
	}

	constructor(provider: CrudProvider, env?: EngineEnv) {
		super(env);
		this._provider = provider;
	}

	public listEntitySets(): Promise<string[]> {
		return this._provider.listEntitySets();
	}

	public describeEntity(entitySet: string): Promise<EntitySchemaDescription> {
		return this._provider.describeEntity(entitySet);
	}

	public read(query: ReadQuery): Promise<ReadResult> {
		return this._provider.read(query);
	}

	public create(params: CrudWriteParams): Promise<any> {
		return this._mutate('crud.create', { entity: params.entity }, () =>
			this._provider.create(params),
		);
	}

	public update(params: CrudUpdateParams): Promise<any> {
		return this._mutate('crud.update', { entity: params.entity, id: params.id }, () =>
			this._provider.update(params),
		);
	}

	public delete(params: CrudDeleteParams): Promise<any> {
		return this._mutate('crud.delete', { entity: params.entity, id: params.id }, () =>
			this._provider.delete(params),
		);
	}
}
