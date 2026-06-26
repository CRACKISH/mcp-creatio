import { z } from 'zod';

/**
 * Minimal JSON Schema → Zod converter for MCP tool input schemas.
 *
 * MCP `inputSchema` is a JSON Schema object (`{ type: 'object', properties, required }`).
 * The MCP SDK's `registerTool` expects a Zod raw shape (one Zod type per property),
 * so this projects the top-level properties into that shape — enough to advertise the
 * parameters (names, types, descriptions, required-ness) to an LLM client. It is a
 * structural projection, not a full validator: anything unrecognised degrades to
 * `z.any()` rather than failing, since the authoritative validation happens downstream.
 */

interface JsonSchemaNode {
	type?: string;
	properties?: Record<string, unknown>;
	required?: string[];
	items?: unknown;
	enum?: Array<string | number | boolean | null>;
	description?: string;
}

export function jsonSchemaToZodShape(schema: unknown): Record<string, z.ZodTypeAny> {
	const node = asNode(schema);
	const properties = isRecord(node.properties) ? node.properties : {};
	const required = new Set(Array.isArray(node.required) ? node.required : []);
	const shape: Record<string, z.ZodTypeAny> = {};
	for (const [key, raw] of Object.entries(properties)) {
		const zodType = nodeToZod(raw);
		shape[key] = required.has(key) ? zodType : zodType.optional();
	}
	return shape;
}

function nodeToZod(raw: unknown): z.ZodTypeAny {
	const node = asNode(raw);
	let zodType = baseType(node);
	if (typeof node.description === 'string' && node.description.length > 0) {
		zodType = zodType.describe(node.description);
	}
	return zodType;
}

function baseType(node: JsonSchemaNode): z.ZodTypeAny {
	if (Array.isArray(node.enum) && node.enum.length > 0) {
		const literals = node.enum.map((value) => z.literal(value as never));
		return literals.length === 1
			? literals[0]!
			: z.union(literals as unknown as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]);
	}
	switch (node.type) {
		case 'string':
			return z.string();
		case 'integer':
			return z.number().int();
		case 'number':
			return z.number();
		case 'boolean':
			return z.boolean();
		case 'array':
			return z.array(node.items === undefined ? z.any() : nodeToZod(node.items));
		case 'object':
			return z.record(z.string(), z.any());
		default:
			return z.any();
	}
}

function asNode(value: unknown): JsonSchemaNode {
	return isRecord(value) ? (value as JsonSchemaNode) : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
