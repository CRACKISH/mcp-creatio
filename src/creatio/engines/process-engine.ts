import { ExecuteProcessParams, ExecuteProcessResult, ProcessProvider } from '../contracts';

import { BaseEngine, EngineEnv } from './engine';

export class ProcessEngine extends BaseEngine {
	private readonly _provider: ProcessProvider;

	public readonly name = 'process';

	constructor(provider: ProcessProvider, env?: EngineEnv) {
		super(env);
		this._provider = provider;
	}

	public get kind(): string {
		return this._provider.kind;
	}

	public execute(params: ExecuteProcessParams): Promise<ExecuteProcessResult> {
		return this._mutate('process.execute', { processName: params.processName }, () =>
			this._provider.executeProcess(params),
		);
	}
}
