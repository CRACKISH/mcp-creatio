import { isEmptyPlaceholder } from '../identifiers';

import { DataValueType } from './data-service-types';
import { toParameterDataValueType } from './data-service-value-type';

/** `rowConfig` of a SelectQuery response: the authoritative type of every returned column. */
export type DataServiceRowConfig = Record<string, { dataValueType?: number } | undefined>;

type Row = Record<string, unknown>;

interface LookupCell {
	value?: unknown;
	displayValue?: unknown;
}

function isLookupCell(cell: unknown): cell is LookupCell {
	return Boolean(cell) && typeof cell === 'object' && 'value' in (cell as object);
}

/** A lookup keeps only what a caller can use; the image/colour hints are UI noise. */
function normalizeLookup(cell: unknown): unknown {
	if (!isLookupCell(cell)) {
		return cell === '' || isEmptyPlaceholder(cell) ? null : cell;
	}
	if (cell.value == null || cell.value === '' || isEmptyPlaceholder(cell.value)) {
		return null;
	}
	return { value: cell.value, displayValue: cell.displayValue ?? '' };
}

function normalizeCell(cell: unknown, dataValueType: number | undefined): unknown {
	if (dataValueType === undefined) {
		return cell;
	}
	const type = toParameterDataValueType(dataValueType);
	if (type === DataValueType.Lookup) {
		return normalizeLookup(cell);
	}
	// DataService sends `""` for every empty cell. Only a text column can genuinely hold "";
	// for a date, number, guid or boolean it means "no value".
	if (type !== DataValueType.Text && (cell === '' || isEmptyPlaceholder(cell))) {
		return null;
	}
	return cell;
}

/**
 * Normalizes SelectQuery rows by the response's `rowConfig` types, so a missing value reads as
 * `null` (not `""`) and a lookup as a compact `{ value, displayValue }`. Columns absent from
 * `rowConfig` pass through untouched.
 */
export function normalizeDataServiceRows(rows: Row[], rowConfig: DataServiceRowConfig = {}): Row[] {
	return rows.map((row) => {
		const out: Row = {};
		for (const [column, cell] of Object.entries(row)) {
			out[column] = normalizeCell(cell, rowConfig[column]?.dataValueType);
		}
		return out;
	});
}
