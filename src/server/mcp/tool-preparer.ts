/**
 * Tool preparation contracts.
 *
 * A {@link ToolPreparer} encapsulates one optional capability: it probes the
 * environment once at startup and, only when the capability is available,
 * registers the MCP tools it owns through a {@link ToolRegistrar}. This keeps
 * the Server open for extension (add a preparer) and closed for modification.
 */

export type ToolHandler = (payload: any) => Promise<any>;

/** Sink for tool registration, decoupling preparers from the Server internals. */
export interface ToolRegistrar {
	register(name: string, descriptor: unknown, handler: ToolHandler): void;
}

/** A self-contained, probe-then-register unit for one optional capability. */
export interface ToolPreparer {
	/** Stable capability key, also used to look up the prepare result. */
	readonly name: string;

	/**
	 * Probe the environment and, when the capability is available, register its
	 * tools via {@link registrar}.
	 *
	 * @returns `true` when the capability is enabled and its tools were registered.
	 */
	prepare(registrar: ToolRegistrar): Promise<boolean>;
}
