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
	Function = 1,
	Parameter = 2,
	SubQuery = 3,
}

/** `Terrasoft.FunctionType` (subset). */
export enum FunctionType {
	None = 0,
	Macros = 1,
	Aggregation = 2,
}

/** `Terrasoft.AggregationType` (subset — we only need Count). */
export enum AggregationType {
	None = 0,
	Count = 1,
	Sum = 2,
	Avg = 3,
	Min = 4,
	Max = 5,
}

/** `Terrasoft.AggregationEvalType`. */
export enum AggregationEvalType {
	None = 0,
	All = 1,
	Distinct = 2,
}

/** `Terrasoft.QueryOperationType` (op is actually selected by the endpoint; sent for fidelity). */
export enum QueryOperationType {
	Select = 0,
	Insert = 1,
	Update = 2,
	Delete = 3,
	Batch = 4,
}

export interface DataServiceColumnExpression {
	expressionType: ExpressionType.SchemaColumn;
	columnPath: string;
}

/** A typed parameter value (`BaseExpression.Parameter`). DataValueType is mandatory — the
 *  platform does not infer it from the JSON value (an absent type silently defaults to Text). */
export interface DataServiceParameter {
	dataValueType: DataValueType;
	value: unknown;
}

export interface DataServiceParameterExpression {
	expressionType: ExpressionType.Parameter;
	parameter: DataServiceParameter;
}

export type DataServiceExpression = DataServiceColumnExpression | DataServiceParameterExpression;

/**
 * A node of the DataService `Filters` tree. A group uses `filterType: Group` + `items`
 * (a keyed map of child filters) + `logicalOperation`; a comparison uses
 * `filterType: CompareFilter` + `comparisonType` + left/right expressions; a null-check
 * uses `filterType: IsNullFilter` + `comparisonType: IsNull|IsNotNull` + `leftExpression`.
 */
export interface DataServiceFilter {
	filterType: FilterType;
	comparisonType?: FilterComparisonType;
	logicalOperation?: LogicalOperation;
	isNull?: boolean;
	isNot?: boolean;
	isEnabled?: boolean;
	leftExpression?: DataServiceExpression;
	rightExpression?: DataServiceExpression;
	rightExpressions?: DataServiceExpression[];
	items?: Record<string, DataServiceFilter>;
}

/** Root of a filter tree — a {@link DataServiceFilter} carrying the schema name. */
export interface DataServiceFilters extends DataServiceFilter {
	rootSchemaName?: string;
}

/** An aggregate-function expression (e.g. COUNT) over a column argument. */
export interface DataServiceAggregationExpression {
	expressionType: ExpressionType.Function;
	functionType: FunctionType.Aggregation;
	functionArgument: DataServiceColumnExpression;
	aggregationType: AggregationType;
	aggregationEvalType: AggregationEvalType;
}

export interface DataServiceSelectColumn {
	expression: DataServiceColumnExpression | DataServiceAggregationExpression;
	orderDirection?: OrderDirection;
	orderPosition?: number;
}

export interface DataServiceSelectQuery {
	rootSchemaName: string;
	operationType: QueryOperationType.Select;
	columns: { items: Record<string, DataServiceSelectColumn> };
	allColumns: boolean;
	isDistinct?: boolean;
	filters?: DataServiceFilters;
	rowCount?: number;
	rowsOffset?: number;
	isPageable?: boolean;
}

/** `ColumnValues` map for Insert/Update — each entry a typed parameter expression. */
export interface DataServiceColumnValues {
	items: Record<string, DataServiceParameterExpression>;
}

export interface DataServiceInsertQuery {
	rootSchemaName: string;
	operationType: QueryOperationType.Insert;
	columnValues: DataServiceColumnValues;
}

export interface DataServiceUpdateQuery {
	rootSchemaName: string;
	operationType: QueryOperationType.Update;
	columnValues: DataServiceColumnValues;
	filters: DataServiceFilters;
}

export interface DataServiceDeleteQuery {
	rootSchemaName: string;
	operationType: QueryOperationType.Delete;
	filters: DataServiceFilters;
}
