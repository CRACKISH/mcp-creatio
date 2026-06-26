import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { jsonSchemaToZodShape } from '../../src/server/mcp/json-schema-to-zod';

describe('jsonSchemaToZodShape', () => {
	it('maps property types and marks non-required ones optional', () => {
		const shape = jsonSchemaToZodShape({
			type: 'object',
			properties: {
				name: { type: 'string', description: 'Full name' },
				age: { type: 'integer' },
				active: { type: 'boolean' },
				tags: { type: 'array', items: { type: 'string' } },
			},
			required: ['name'],
		});
		const schema = z.object(shape);

		expect(schema.parse({ name: 'Andrew', age: 30, active: true, tags: ['a'] })).toEqual({
			name: 'Andrew',
			age: 30,
			active: true,
			tags: ['a'],
		});
		// optional fields may be omitted
		expect(schema.parse({ name: 'Andrew' })).toEqual({ name: 'Andrew' });
		// required field enforced
		expect(() => schema.parse({})).toThrow();
		// integer enforced
		expect(() => schema.parse({ name: 'x', age: 1.5 })).toThrow();
	});

	it('supports enums as a union of literals', () => {
		const shape = jsonSchemaToZodShape({
			type: 'object',
			properties: { status: { enum: ['open', 'closed'] } },
			required: ['status'],
		});
		const schema = z.object(shape);
		expect(schema.parse({ status: 'open' })).toEqual({ status: 'open' });
		expect(() => schema.parse({ status: 'nope' })).toThrow();
	});

	it('degrades unknown/missing types to permissive (any) rather than failing', () => {
		const shape = jsonSchemaToZodShape({
			type: 'object',
			properties: { payload: {}, weird: { type: 'tuple' } },
		});
		const schema = z.object(shape);
		expect(schema.parse({ payload: { nested: 1 }, weird: 'anything' })).toEqual({
			payload: { nested: 1 },
			weird: 'anything',
		});
	});

	it('returns an empty shape for non-object / missing schemas', () => {
		expect(jsonSchemaToZodShape(undefined)).toEqual({});
		expect(jsonSchemaToZodShape({ type: 'object' })).toEqual({});
		expect(jsonSchemaToZodShape('nonsense')).toEqual({});
	});
});
