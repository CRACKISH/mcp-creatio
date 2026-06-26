/**
 * DataService (DataValueType / Select-Insert-Update-Delete query) primitives for the
 * planned Creatio `/0/DataService/json/SyncReply/SelectQuery|InsertQuery|...` backend.
 *
 * GROUNDWORK ONLY — these mirror the Creatio server-side enums so the DataService CRUD
 * provider can be built without re-deriving them. The values match Creatio's
 * `Terrasoft.DataValueType` / `Terrasoft.FilterComparisonType` so payloads are accepted
 * verbatim by the platform. Kept isolated (no transport, no MCP knowledge) so it is
 * trivially unit-testable. See the DataService provider plan in the repo memory.
 */

/** Subset of `Terrasoft.DataValueType` we need for CRUD. Numeric values are the platform's. */
export enum DataValueType {
	Guid = 0,
	Text = 1,
	Integer = 4,
	Float = 5,
	Money = 6,
	DateTime = 7,
	Date = 8,
	Time = 9,
	Lookup = 10,
	Boolean = 12,
	Binary = 13,
}

/** `Terrasoft.FilterComparisonType` — the subset our neutral ops map onto. */
export enum FilterComparisonType {
	Equal = 3,
	NotEqual = 4,
	Greater = 5,
	GreaterOrEqual = 6,
	Less = 7,
	LessOrEqual = 8,
	StartWith = 9,
	Contain = 10,
	EndWith = 11,
	IsNull = 12,
	IsNotNull = 13,
}

/** `Terrasoft.FilterType`. */
export enum FilterType {
	None = 0,
	CompareFilter = 1,
	IsNullFilter = 2,
	Group = 6,
}

/** `Terrasoft.LogicalOperationStrict`. */
export enum LogicalOperation {
	And = 0,
	Or = 1,
}

/** `Terrasoft.OrderDirection`. */
export enum OrderDirection {
	Ascending = 1,
	Descending = 2,
}

/** `Terrasoft.ExpressionType` (the only ones we emit). */
export enum ExpressionType {
	SchemaColumn = 0,
	Parameter = 2,
}

export interface DataServiceColumnExpression {
	expressionType: ExpressionType.SchemaColumn;
	columnPath: string;
}

export interface DataServiceSelectColumn {
	expression: DataServiceColumnExpression;
	orderDirection?: OrderDirection;
	orderPosition?: number;
}

export interface DataServiceSelectQuery {
	rootSchemaName: string;
	operationType: 0; // Select
	columns: { items: Record<string, DataServiceSelectColumn> };
	allColumns: boolean;
	rowCount?: number;
	rowsOffset?: number;
	isPageable?: boolean;
}
