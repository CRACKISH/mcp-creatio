import {
	CallConfigurationServiceRequest,
	CallConfigurationServiceResult,
	ConfigurationProvider,
} from '../providers';

import { BaseEngine, EngineEnv } from './engine';

export class ConfigurationEngine extends BaseEngine {
	private readonly _provider: ConfigurationProvider;

	public readonly name = 'configuration';

	constructor(provider: ConfigurationProvider, env?: EngineEnv) {
		super(env);
		this._provider = provider;
	}

	public get kind(): string {
		return this._provider.kind;
	}

	public call(request: CallConfigurationServiceRequest): Promise<CallConfigurationServiceResult> {
		// The generic configuration caller can reach mutating endpoints, so it is treated
		// as a mutation for both the readonly guard and the audit trail (it is also in the
		// readonly-excluded tool list at the MCP layer).
		return this._mutate(
			'configuration.call',
			{ service: request?.service, method: request?.method, httpMethod: request?.httpMethod },
			() => this._provider.call(request),
		);
	}
}
