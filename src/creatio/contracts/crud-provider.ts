import { ReadQuery, ReadResult } from './query';

export interface EntitySchemaProperty {
	name: string;
	type: string;
	nullable?: boolean;
}

export interface EntitySchemaDescription {
	entitySet: string;
	entityType: string;
	key: string[];
	properties: EntitySchemaProperty[];
}

export interface CrudWriteParams {
	entity: string;
	data: any;
}

export interface CrudUpdateParams extends CrudWriteParams {
	id: string;
}

export interface CrudDeleteParams {
	entity: string;
	id: string;
}

/**
 * The data-access port (Strategy). Two interchangeable backends implement it — OData and
 * DataService — selected per-deployment by the factory. `read` takes the neutral
 * {@link ReadQuery} and returns the normalized {@link ReadResult}; each implementation owns
 * the translation to/from its native dialect so nothing above this interface is dialect-aware.
 */
export interface CrudProvider {
	readonly kind: string;
	listEntitySets(): Promise<string[]>;
	describeEntity(entitySet: string): Promise<EntitySchemaDescription>;
	read(query: ReadQuery): Promise<ReadResult>;
	create(params: CrudWriteParams): Promise<any>;
	update(params: CrudUpdateParams): Promise<any>;
	delete(params: CrudDeleteParams): Promise<any>;
}
