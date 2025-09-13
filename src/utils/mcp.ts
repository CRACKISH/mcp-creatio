import { z } from 'zod';

export function withValidation<T extends z.ZodTypeAny>(
	schema: T,
	handler: (args: z.infer<T>) => Promise<any>,
) {
	return async (payload: unknown) => handler(schema.parse(payload));
}
