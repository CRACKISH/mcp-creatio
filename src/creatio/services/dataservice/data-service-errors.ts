import { UnknownNameError } from '../../contracts';

// DataService's "unknown name" messages (verified live on .NET Framework and .NET 8). The text is
// JSON-embedded in the error, so the entity name's quotes may arrive escaped (`\"X\"`).
const UNKNOWN_COLUMN_PATH = /Column by path ([\w.]+) not found in schema/;
const UNKNOWN_COLUMN_ITEM = /Collection item with name ([\w.]+) not found/;
const UNKNOWN_ENTITY = /Item with name \W*(\w+)\W* not found/;

/** The neutral {@link UnknownNameError} for a DataService failure about an unknown name, if any. */
export function toUnknownNameError(err: unknown, entity: string): UnknownNameError | undefined {
	const message = String((err as Error)?.message ?? err);
	const column = UNKNOWN_COLUMN_PATH.exec(message) ?? UNKNOWN_COLUMN_ITEM.exec(message);
	if (column) {
		return new UnknownNameError('column', column[1]!, entity, { cause: err });
	}
	const unknownEntity = UNKNOWN_ENTITY.exec(message);
	return unknownEntity
		? new UnknownNameError('entity', unknownEntity[1]!, entity, { cause: err })
		: undefined;
}
