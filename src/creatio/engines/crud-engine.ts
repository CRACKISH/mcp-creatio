import { suggestNames } from '../../utils';
import {
	CrudCapabilities,
	CrudDeleteParams,
	CrudProvider,
	CrudUpdateParams,
	CrudWriteParams,
	EntitySchemaDescription,
	ReadQuery,
	ReadResult,
	UnknownNameError,
	unknownNameErrorOf,
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

	/**
	 * Runs a call and, when Creatio rejects an unknown entity or column, rethrows it as an
	 * {@link UnknownNameError} carrying the closest known names — written once for every backend;
	 * each provider only recognizes its own dialect's message.
	 */
	private async _explainUnknownNames<T>(
		entity: string,
		collectionRead: boolean,
		run: () => Promise<T>,
	): Promise<T> {
		try {
			return await run();
		} catch (err) {
			const unknown = unknownNameErrorOf(this._provider, err, { entity, collectionRead });
			throw unknown ? await this._withSuggestions(unknown) : err;
		}
	}

	private async _knownNames(err: UnknownNameError): Promise<string[]> {
		if (err.kind === 'entity') {
			return this._provider.listEntitySets();
		}
		const schema = await this._provider.describeEntity(err.entity);
		return schema.properties.map((p) => p.name);
	}

	/** Best effort, from the provider's (cached) schema or entity list; never masks the error. A
	 *  dotted path is skipped: its last segment belongs to a related entity's schema. */
	private async _withSuggestions(err: UnknownNameError): Promise<UnknownNameError> {
		if (err.unknownName.includes('.')) {
			return err;
		}
		try {
			const known = await this._knownNames(err);
			const suggestions = suggestNames(err.unknownName, known);
			if (!suggestions.length) {
				return err;
			}
			const cause = err.cause ?? err;
			return new UnknownNameError(err.kind, err.unknownName, err.entity, {
				cause,
				suggestions,
			});
		} catch {
			return err;
		}
	}

	public listEntitySets(): Promise<string[]> {
		return this._provider.listEntitySets();
	}

	public describeEntity(entitySet: string): Promise<EntitySchemaDescription> {
		return this._explainUnknownNames(entitySet, true, () =>
			this._provider.describeEntity(entitySet),
		);
	}

	public read(query: ReadQuery): Promise<ReadResult> {
		return this._explainUnknownNames(query.entity, true, () => this._provider.read(query));
	}

	public create(params: CrudWriteParams): Promise<any> {
		return this._mutate('crud.create', { entity: params.entity }, () =>
			this._explainUnknownNames(params.entity, true, () => this._provider.create(params)),
		);
	}

	public update(params: CrudUpdateParams): Promise<any> {
		return this._mutate('crud.update', { entity: params.entity, id: params.id }, () =>
			this._explainUnknownNames(params.entity, false, () => this._provider.update(params)),
		);
	}

	public delete(params: CrudDeleteParams): Promise<any> {
		return this._mutate('crud.delete', { entity: params.entity, id: params.id }, () =>
			this._provider.delete(params),
		);
	}
}
