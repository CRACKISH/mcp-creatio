export type UnknownNameKind = 'entity' | 'column';

/**
 * A backend's neutral report that Creatio rejected a name it does not know — each CRUD provider
 * recognizes its own dialect's message, so callers above the provider never parse error text.
 * `suggestions` are the closest known names, when the engine could find any.
 */
export class UnknownNameError extends Error {
	public readonly kind: UnknownNameKind;
	public readonly unknownName: string;
	public readonly entity: string;
	public readonly suggestions: readonly string[];

	constructor(
		kind: UnknownNameKind,
		unknownName: string,
		entity: string,
		options: { cause?: unknown; suggestions?: readonly string[] } = {},
	) {
		const suggestions = options.suggestions ?? [];
		const where = kind === 'column' ? ` (${entity})` : '';
		const hint = suggestions.length ? `. Did you mean: ${suggestions.join(', ')}?` : '';
		super(`unknown_${kind}:${unknownName}${where}${hint}`, { cause: options.cause });
		this.name = 'UnknownNameError';
		this.kind = kind;
		this.unknownName = unknownName;
		this.entity = entity;
		this.suggestions = suggestions;
	}
}
