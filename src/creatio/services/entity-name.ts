const ENTITY_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;

/**
 * Guard an entity/schema name shared by both CRUD backends. Creatio entity-set and schema
 * names are simple identifiers; rejecting anything else prevents a name from being used for
 * path/segment injection (OData URL) or to tamper with the request envelope (DataService).
 * Returns the validated name so it can be used inline.
 */
export function assertEntityName(entity: string): string {
	if (!entity || !ENTITY_NAME_PATTERN.test(entity)) {
		throw new Error(`invalid_entity_name:${entity}`);
	}
	return entity;
}
