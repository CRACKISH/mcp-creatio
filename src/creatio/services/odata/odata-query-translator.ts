import { FilterCondition, FilterInCondition, FilterNode, ReadQuery } from '../../contracts';
import { lookupIdPath } from '../lookup-path';

/**
 * Projects a neutral {@link ReadQuery} onto OData query-string parameters. This is the
 * OData dialect's home: every OData-specific quirk lives here and nowhere above the
 * provider interface.
 *
 * Quirks preserved (verified live against Creatio OData v4):
 * - A lookup FK cannot be filtered by its scalar column (`ContactId eq <guid>` 500s); it
 *   must go through the navigation property (`Contact/Id eq <guid>`). We rewrite
 *   `<Lookup>Id` -> `<Lookup>/Id` for equality/inequality against a GUID.
 * - `Edm.Guid` keys take a BARE (unquoted) literal; other strings are single-quoted with
 *   embedded quotes doubled.
 */
export class ODataQueryTranslator {
	private static readonly GUID =
		/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

	private _isGuid(value: unknown): value is string {
		return typeof value === 'string' && ODataQueryTranslator.GUID.test(value);
	}

	private _isIdish(field: string): boolean {
		return /(^|\/)Id$/.test(field) || /Id$/i.test(field);
	}

	private _escapeStr(value: string): string {
		return value.replace(/'/g, "''");
	}

	private _literalFor(field: string, value: unknown): string {
		if (value == null) {
			return 'null';
		}
		const t = typeof value;
		if (t === 'number') {
			return String(value);
		}
		if (t === 'boolean') {
			return value ? 'true' : 'false';
		}
		if (t === 'string') {
			const v = String(value);
			// Bare (unquoted) GUID for any Id-typed path — the scalar key `Id`, a lookup FK
			// `XxxId`, or a navigation `Xxx/Id`. Other strings (incl. `Xxx/Name`) are quoted.
			if (this._isGuid(v) && this._isIdish(field)) {
				return v;
			}
			return `'${this._escapeStr(v)}'`;
		}
		return `'${this._escapeStr(JSON.stringify(value))}'`;
	}

	/** Navigate a lookup compared to a GUID to its `Id` path (`ContactId`/`Owner`/`Contact/Type`
	 *  -> `…/Id`); non-GUID values and already-`Id` paths are left untouched. */
	private _lookupNavField(field: string, value: unknown): string {
		return this._isGuid(value) ? lookupIdPath(field, '/') : field;
	}

	private _condition(node: FilterCondition): string | undefined {
		const field = String(node.field);
		const { op } = node;
		if (op === 'isNull') {
			return `${field} eq null`;
		}
		if (op === 'isNotNull') {
			return `${field} ne null`;
		}
		if (op === 'contains' || op === 'startswith' || op === 'endswith') {
			return `${op}(${field},${this._literalFor(field, node.value)})`;
		}
		if (node.value == null && (op === 'eq' || op === 'ne')) {
			return `${field} ${op} null`;
		}
		// Lookup-nav rewrite only applies to equality/inequality against a GUID.
		const f = op === 'eq' || op === 'ne' ? this._lookupNavField(field, node.value) : field;
		return `${f} ${op} ${this._literalFor(f, node.value)}`;
	}

	private _inCondition(node: FilterInCondition): string | undefined {
		if (!node.values.length) {
			return undefined;
		}
		const parts = node.values.map((v) => {
			const f = this._lookupNavField(node.field, v);
			return `${f} eq ${this._literalFor(f, v)}`;
		});
		return parts.length === 1 ? parts[0] : `(${parts.join(' or ')})`;
	}

	private _node(node: FilterNode): string | undefined {
		if (node.kind === 'condition') {
			return this._condition(node);
		}
		if (node.kind === 'in') {
			return this._inCondition(node);
		}
		const rendered = node.items.map((n) => this._node(n)).filter((s): s is string => Boolean(s));
		if (!rendered.length) {
			return undefined;
		}
		if (rendered.length === 1) {
			return rendered[0];
		}
		return `(${rendered.join(` ${node.logic} `)})`;
	}

	/** Render a {@link FilterNode} into an OData `$filter` expression (or undefined if empty). */
	public translateFilter(node: FilterNode | undefined): string | undefined {
		return node ? this._node(node) : undefined;
	}

	/** Combine the structured filter with an optional raw `$filter` escape hatch (AND-joined). */
	private _resolveFilter(query: ReadQuery): string | undefined {
		const structured = this.translateFilter(query.filter);
		const raw = query.odata?.rawFilter?.trim() || undefined;
		if (raw && structured) {
			return `(${raw}) and (${structured})`;
		}
		return raw || structured;
	}

	private _orderBy(query: ReadQuery): string | undefined {
		if (!query.order || query.order.length === 0) {
			return undefined;
		}
		return query.order.map((o) => `${o.field} ${o.dir}`).join(', ');
	}

	/** Build the encoded OData query-string params for a read. */
	public buildQueryParams(query: ReadQuery): string[] {
		const params: string[] = [];
		const filter = this._resolveFilter(query);
		if (filter) {
			params.push(`$filter=${encodeURIComponent(filter)}`);
		}
		if (query.columns && query.columns.length > 0) {
			params.push(`$select=${encodeURIComponent(query.columns.join(','))}`);
		}
		const expand = query.odata?.expand;
		if (expand && expand.length > 0) {
			params.push(`$expand=${encodeURIComponent(expand.join(','))}`);
		}
		const orderBy = this._orderBy(query);
		if (orderBy) {
			params.push(`$orderby=${encodeURIComponent(orderBy)}`);
		}
		if (typeof query.top === 'number') {
			params.push(`$top=${query.top}`);
		}
		if (typeof query.skip === 'number' && query.skip > 0) {
			params.push(`$skip=${query.skip}`);
		}
		if (query.count) {
			params.push('$count=true');
		}
		return params;
	}
}
