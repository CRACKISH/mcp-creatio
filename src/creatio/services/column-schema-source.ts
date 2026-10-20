import { TemporalKind, temporalKindOf } from '../temporal';

/**
 * The column facts of Creatio's own entity schema (`RuntimeEntitySchemaRequest`), for a backend
 * whose wire format hides them — OData types DateTime, Date and Time columns all as
 * `Edm.DateTimeOffset` (verified on .NET Framework and .NET 8), so only the schema tells a
 * birth date from a timestamp. Both maps are empty when the schema is unavailable.
 */
export interface ColumnSchemaSource {
	/** Column name -> Creatio `DataValueType` code. */
	columnTypes(entity: string): Promise<ReadonlyMap<string, number>>;
	/** Lookup column name -> the entity it references. */
	references(entity: string): Promise<ReadonlyMap<string, string>>;
}

/** The temporal kind of a column or related path (`Activity.StartDate`, `Owner/BirthDate`) of
 *  `entity`, following lookups through the schema; `undefined` when any step is unknown. */
async function kindOfPath(
	schema: ColumnSchemaSource,
	entity: string,
	path: string,
): Promise<TemporalKind | undefined> {
	const segments = path.split(/[./]/);
	let current: string | undefined = entity;
	for (const segment of segments.slice(0, -1)) {
		current = (await schema.references(current)).get(segment);
		if (!current) {
			return undefined;
		}
	}
	return temporalKindOf((await schema.columnTypes(current)).get(segments.at(-1)!));
}

/** The temporal kinds of the given filter fields of `entity` (unresolvable fields are left out). */
export async function resolveTemporalKinds(
	schema: ColumnSchemaSource,
	entity: string,
	fields: string[],
): Promise<Map<string, TemporalKind>> {
	const kinds = new Map<string, TemporalKind>();
	await Promise.all(
		fields.map(async (field) => {
			const kind = await kindOfPath(schema, entity, field);
			if (kind) {
				kinds.set(field, kind);
			}
		}),
	);
	return kinds;
}
