import { UnknownNameError } from '../../contracts';

// OData's messages for an unknown property (verified live): in $select / $filter / $orderby, and in
// a write body (.NET Framework only; .NET 8 answers a bare "The input was not valid"). Anchored to
// the unknown-property phrasings only: OData also says "The property 'X' cannot be used in …" (and
// similar) about properties that DO exist, and those must surface as the original Creatio error.
const UNKNOWN_PROPERTY =
	/Could not find a property named '([^']+)'|The property '([^']+)' does not exist/;

/**
 * The neutral {@link UnknownNameError} for an OData failure about an unknown name, if any. On a
 * collection read a 404 can only mean an unknown entity set (a key lookup 404s for a missing
 * record, so `collectionRead` must be false there).
 */
export function toUnknownNameError(
	err: unknown,
	entity: string,
	collectionRead: boolean,
): UnknownNameError | undefined {
	const message = String((err as Error)?.message ?? err);
	const property = UNKNOWN_PROPERTY.exec(message);
	if (property) {
		return new UnknownNameError('column', (property[1] ?? property[2])!, entity, {
			cause: err,
		});
	}
	return collectionRead && /_failed:404\b/.test(message)
		? new UnknownNameError('entity', entity, entity, { cause: err })
		: undefined;
}
