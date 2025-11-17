import { SysSettingsProvider } from '../../providers';
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
}
