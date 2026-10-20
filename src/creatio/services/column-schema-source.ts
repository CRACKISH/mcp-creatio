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
