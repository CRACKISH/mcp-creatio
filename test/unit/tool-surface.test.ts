import { describe, expect, it, vi } from 'vitest';

import { CreatioEngineManager } from '../../src/creatio';
import { Server } from '../../src/server/mcp';
import { ALL_PROMPTS } from '../../src/server/mcp/prompts-data';
import * as toolsData from '../../src/server/mcp/tools-data';
import { makeFakeContext } from '../support/fake-context';

interface Descriptor {
	title: string;
	description: string;
	annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; openWorldHint?: boolean };
}

/** The static tool surface (with the DataService feature catalog) in normal or readonly mode. */
function toolSurface(readonlyMode: boolean): Map<string, Descriptor> {
	const context = makeFakeContext() as ReturnType<typeof makeFakeContext> & {
		featureCatalog: unknown;
	};
	context.featureCatalog = {
		kind: 'catalog',
		listFeatures: vi.fn(),
		getFeature: vi.fn(),
		setFeatureState: vi.fn(),
	};
	const server = new Server(new CreatioEngineManager(context as never), { readonlyMode });
	return (server as unknown as { _descriptors: Map<string, Descriptor> })._descriptors;
}

/** Every descriptor tools-data exports (static + env-gated DataForge / Global Search). */
const exportedDescriptors = [
	...Object.entries(toolsData)
		.filter(([name, value]) => name.endsWith('Descriptor') && typeof value === 'object')
		.map(([name, value]) => [name, value as Descriptor] as const),
	[
		'read (DataService)',
		toolsData.buildReadDescriptor({ rawFilter: false, expand: false }) as Descriptor,
	] as const,
	[
		'read (OData)',
		toolsData.buildReadDescriptor({ rawFilter: true, expand: true }) as Descriptor,
	] as const,
];

const guideLinks = (text: string) => [...text.matchAll(/\/([a-z-]+-guide)\b/g)].map((m) => m[1]!);

const promptTexts = ALL_PROMPTS.map((p) => {
	const message = p.callback().messages[0]!;
	return { name: p.name, text: message.content.text };
});

describe('tool surface contract (MCP best practices)', () => {
	it('every tool declares annotations, none open-world', () => {
		for (const [name, descriptor] of [...toolSurface(false), ...exportedDescriptors]) {
			expect(descriptor.annotations, name).toBeDefined();
			expect(typeof descriptor.annotations!.readOnlyHint, name).toBe('boolean');
			expect(descriptor.annotations!.openWorldHint, name).toBe(false);
		}
	});

	it('readOnlyHint matches readonly-mode registration exactly', () => {
		const all = toolSurface(false);
		const readonly = toolSurface(true);
		for (const [name, descriptor] of all) {
			expect(descriptor.annotations!.readOnlyHint, name).toBe(readonly.has(name));
		}
	});

	it('every /…-guide a tool or prompt mentions exists', () => {
		const prompts = new Set(ALL_PROMPTS.map((p) => p.name));
		const texts = [
			...exportedDescriptors.map(
				([name, d]) => [name, `${d.title} ${d.description}`] as const,
			),
			...promptTexts.map((p) => [p.name, p.text] as const),
		];
		for (const [where, text] of texts) {
			for (const link of guideLinks(text)) {
				expect(prompts.has(link), `${where} → /${link}`).toBe(true);
			}
		}
	});

	it('prompts never recommend the raw OData `filter` string (not registered on DataService)', () => {
		for (const { name, text } of promptTexts) {
			expect(text, name).not.toMatch(/"filter"\s*:/);
		}
	});

	it('prompts have unique names and non-empty text', () => {
		expect(new Set(ALL_PROMPTS.map((p) => p.name)).size).toBe(ALL_PROMPTS.length);
		for (const { name, text } of promptTexts) {
			expect(text.length, name).toBeGreaterThan(200);
		}
	});
});
