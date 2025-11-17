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

export interface CrudReadParams {
	entity: string;
	filter?: string | undefined;
	select?: string[] | undefined;
	top?: number | undefined;
	expand?: string[] | undefined;
	orderBy?: string | undefined;
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

export interface CrudProvider {
	readonly kind: string;
	listEntitySets(): Promise<string[]>;
	describeEntity(entitySet: string): Promise<EntitySchemaDescription>;
	read(params: CrudReadParams): Promise<any>;
	create(params: CrudWriteParams): Promise<any>;
	update(params: CrudUpdateParams): Promise<any>;
	delete(params: CrudDeleteParams): Promise<any>;
}
