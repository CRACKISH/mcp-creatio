import { describe, expect, it, vi } from 'vitest';

import {
	CrudEngine,
	EngineEnv,
	ProcessEngine,
	ReadonlyModeError,
	SysSettingsEngine,
} from '../../src/creatio';

function makeEnv(readonly: boolean) {
	const audit = vi.fn();
	const env: EngineEnv = { readonly, audit };
	return { env, audit };
}

function fakeCrudProvider() {
	return {
		kind: 'crud',
		listEntitySets: vi.fn().mockResolvedValue([]),
		describeEntity: vi.fn().mockResolvedValue({}),
		read: vi.fn().mockResolvedValue([]),
		create: vi.fn().mockResolvedValue({ id: 'x' }),
		update: vi.fn().mockResolvedValue('ok'),
		delete: vi.fn().mockResolvedValue('ok'),
	};
}

describe('engine readonly enforcement', () => {
	it('blocks mutating CRUD ops with ReadonlyModeError and never touches the provider', async () => {
		const provider = fakeCrudProvider();
		const { env } = makeEnv(true);
		const engine = new CrudEngine(provider as never, env);

		await expect(engine.create({ entity: 'Contact', data: {} })).rejects.toBeInstanceOf(
			ReadonlyModeError,
		);
		await expect(engine.update({ entity: 'Contact', id: '1', data: {} })).rejects.toThrow(
			/readonly_mode_blocked:crud\.update/,
		);
		await expect(engine.delete({ entity: 'Contact', id: '1' })).rejects.toThrow(
			/readonly_mode_blocked:crud\.delete/,
		);

		expect(provider.create).not.toHaveBeenCalled();
		expect(provider.update).not.toHaveBeenCalled();
		expect(provider.delete).not.toHaveBeenCalled();
	});

	it('still allows read operations in readonly mode', async () => {
		const provider = fakeCrudProvider();
		const { env } = makeEnv(true);
		const engine = new CrudEngine(provider as never, env);

		await engine.listEntitySets();
		await engine.read({ entity: 'Contact' });

		expect(provider.listEntitySets).toHaveBeenCalledTimes(1);
		expect(provider.read).toHaveBeenCalledTimes(1);
	});

	it('blocks process execution in readonly mode', async () => {
		const provider = { kind: 'process', executeProcess: vi.fn() };
		const { env } = makeEnv(true);
		const engine = new ProcessEngine(provider as never, env);
		await expect(engine.execute({ processName: 'P', parameters: {} })).rejects.toBeInstanceOf(
			ReadonlyModeError,
		);
		expect(provider.executeProcess).not.toHaveBeenCalled();
	});
});

describe('engine audit trail', () => {
	it('audits each mutation with action + details before delegating', async () => {
		const provider = fakeCrudProvider();
		const { env, audit } = makeEnv(false);
		const engine = new CrudEngine(provider as never, env);

		await engine.create({ entity: 'Contact', data: { Name: 'A' } });
		await engine.update({ entity: 'Account', id: 'a-1', data: {} });
		await engine.delete({ entity: 'Lead', id: 'l-1' });

		expect(audit).toHaveBeenCalledWith('crud.create', { entity: 'Contact' });
		expect(audit).toHaveBeenCalledWith('crud.update', { entity: 'Account', id: 'a-1' });
		expect(audit).toHaveBeenCalledWith('crud.delete', { entity: 'Lead', id: 'l-1' });
		expect(provider.create).toHaveBeenCalledTimes(1);
	});

	it('does not audit read operations', async () => {
		const provider = fakeCrudProvider();
		const { env, audit } = makeEnv(false);
		const engine = new CrudEngine(provider as never, env);
		await engine.read({ entity: 'Contact' });
		expect(audit).not.toHaveBeenCalled();
	});

	it('audits sys-settings mutations with the changed codes', async () => {
		const provider = {
			kind: 'sys-settings',
			setValues: vi.fn().mockResolvedValue('ok'),
			queryValues: vi.fn().mockResolvedValue({}),
			createSetting: vi.fn().mockResolvedValue({}),
			updateDefinition: vi.fn().mockResolvedValue({}),
		};
		const { env, audit } = makeEnv(false);
		const engine = new SysSettingsEngine(provider as never, env);
		await engine.setValues({ MaxSessions: 5, Theme: 'dark' });
		expect(audit).toHaveBeenCalledWith('sys-settings.set-values', {
			codes: ['MaxSessions', 'Theme'],
		});
	});
});
