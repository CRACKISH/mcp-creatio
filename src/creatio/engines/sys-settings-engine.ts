import {
	CreateSysSettingRequest,
	CreateSysSettingResult,
	QuerySysSettingsResponse,
	SysSettingDefinitionUpdate,
	SysSettingUpdateResponse,
	SysSettingsProvider,
} from '../providers';

import { BaseEngine, EngineEnv } from './engine';

export class SysSettingsEngine extends BaseEngine {
	private readonly _provider: SysSettingsProvider;

	public readonly name = 'sys-settings';

	constructor(provider: SysSettingsProvider, env?: EngineEnv) {
		super(env);
		this._provider = provider;
	}

	public get kind(): string {
		return this._provider.kind;
	}

	public setValues(values: Record<string, any>): Promise<any> {
		return this._mutate('sys-settings.set-values', { codes: Object.keys(values ?? {}) }, () =>
			this._provider.setValues(values),
		);
	}

	public queryValues(codes: string[]): Promise<QuerySysSettingsResponse> {
		return this._provider.queryValues(codes);
	}

	public createSetting(request: CreateSysSettingRequest): Promise<CreateSysSettingResult> {
		return this._mutate(
			'sys-settings.create',
			{ code: (request?.definition as any)?.code ?? null },
			() => this._provider.createSetting(request),
		);
	}

	public updateDefinition(
		definition: SysSettingDefinitionUpdate,
	): Promise<SysSettingUpdateResponse> {
		return this._mutate(
			'sys-settings.update-definition',
			{ id: (definition as any)?.id ?? null },
			() => this._provider.updateDefinition(definition),
		);
	}
}
