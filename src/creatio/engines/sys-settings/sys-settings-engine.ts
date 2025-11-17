import {
	CreateSysSettingRequest,
	CreateSysSettingResult,
	QuerySysSettingsResponse,
	SysSettingDefinitionUpdate,
	SysSettingUpdateResponse,
	SysSettingsProvider,
} from '../../providers';
import { CreatioEngine } from '../engine';

export class SysSettingsEngine implements CreatioEngine {
	private readonly _provider: SysSettingsProvider;

	public readonly name = 'sys-settings';

	constructor(provider: SysSettingsProvider) {
		this._provider = provider;
	}

	public get kind(): string {
		return this._provider.kind;
	}

	public setValues(values: Record<string, any>): Promise<any> {
		return this._provider.setValues(values);
	}

	public queryValues(codes: string[]): Promise<QuerySysSettingsResponse> {
		return this._provider.queryValues(codes);
	}

	public createSetting(request: CreateSysSettingRequest): Promise<CreateSysSettingResult> {
		return this._provider.createSetting(request);
	}

	public updateDefinition(
		definition: SysSettingDefinitionUpdate,
	): Promise<SysSettingUpdateResponse> {
		return this._provider.updateDefinition(definition);
	}
}
