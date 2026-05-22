import {
	CallConfigurationServiceRequest,
	CallConfigurationServiceResult,
	ConfigurationProvider,
} from '../../providers';
import { CreatioEngine } from '../engine';

export class ConfigurationEngine implements CreatioEngine {
	private readonly _provider: ConfigurationProvider;

	public readonly name = 'configuration';

	constructor(provider: ConfigurationProvider) {
		this._provider = provider;
	}

	public get kind(): string {
		return this._provider.kind;
	}

	public call(
		request: CallConfigurationServiceRequest,
	): Promise<CallConfigurationServiceResult> {
		return this._provider.call(request);
	}
}
