import { RecordFilesProvider, RecordFilesQuery, RecordFilesResult } from '../contracts';

import { BaseEngine, EngineEnv } from './engine';

export class RecordFilesEngine extends BaseEngine {
	private readonly _provider: RecordFilesProvider;

	public readonly name = 'record-files';

	public get kind(): string {
		return this._provider.kind;
	}

	constructor(provider: RecordFilesProvider, env?: EngineEnv) {
		super(env);
		this._provider = provider;
	}

	public listRecordFiles(query: RecordFilesQuery): Promise<RecordFilesResult> {
		return this._provider.listRecordFiles(query);
	}
}
