import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		environment: 'node',
		include: ['test/**/*.test.ts'],
		// Keep the logger quiet during tests.
		env: { CREATIO_MCP_LOG_LEVEL: 'silent' },
		coverage: {
			provider: 'v8',
			reporter: ['text', 'html'],
			include: ['src/**/*.ts'],
			exclude: [
				'src/**/index.ts',
				'src/types/**',
				'src/**/*-data.ts',
				// Interface/type-only module (erased at compile time, nothing to run).
				'src/server/mcp/tool-preparer.ts',
				// Process entry points (orchestration/bootstrap). Their pure helpers are
				// unit-tested; the wired binary is validated manually / at the CLI level.
				'src/cli.ts',
			],
		},
	},
});
