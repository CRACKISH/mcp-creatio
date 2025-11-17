import { ExecuteProcessParams, ExecuteProcessResult, ProcessProvider } from '../../providers';
import { CreatioEngine } from '../engine';

export class ProcessEngine implements CreatioEngine {
	private readonly _provider: ProcessProvider;

	public readonly name = 'process';

	constructor(provider: ProcessProvider) {
		this._provider = provider;
	}

	public get kind(): string {
		return this._provider.kind;
	}

	public execute(params: ExecuteProcessParams): Promise<ExecuteProcessResult> {
		return this._provider.executeProcess(params);
	}
}
