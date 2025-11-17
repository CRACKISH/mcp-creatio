import {
	CrudDeleteParams,
	CrudProvider,
	CrudReadParams,
	CrudUpdateParams,
	CrudWriteParams,
	EntitySchemaDescription,
} from '../../providers';
import { CreatioEngine } from '../engine';

export class CrudEngine implements CreatioEngine {
	private readonly _provider: CrudProvider;

	public readonly name = 'crud';

	constructor(provider: CrudProvider) {
		this._provider = provider;
	}

	public get kind(): string {
		return this._provider.kind;
	}

	public listEntitySets(): Promise<string[]> {
		return this._provider.listEntitySets();
	}

	public describeEntity(entitySet: string): Promise<EntitySchemaDescription> {
		return this._provider.describeEntity(entitySet);
	}

	public read(params: CrudReadParams): Promise<any> {
		return this._provider.read(params);
	}

	public create(params: CrudWriteParams): Promise<any> {
		return this._provider.create(params);
	}

	public update(params: CrudUpdateParams): Promise<any> {
		return this._provider.update(params);
	}

	public delete(params: CrudDeleteParams): Promise<any> {
		return this._provider.delete(params);
	}
}
