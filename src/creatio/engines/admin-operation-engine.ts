import {
	AdminOperationProvider,
	AdminOperationServiceResult,
	SetAdminOperationGranteeRequest,
	UpsertAdminOperationRequest,
	UpsertAdminOperationResult,
} from '../contracts';

import { BaseEngine, EngineEnv } from './engine';

export class AdminOperationEngine extends BaseEngine {
	private readonly _provider: AdminOperationProvider;

	public readonly name = 'admin-operation';

	public get kind(): string {
		return this._provider.kind;
	}

	constructor(provider: AdminOperationProvider, env?: EngineEnv) {
		super(env);
		this._provider = provider;
	}

	public upsertAdminOperation(
		request: UpsertAdminOperationRequest,
	): Promise<UpsertAdminOperationResult> {
		return this._mutate('admin-operation.upsert', { code: request?.code ?? null }, () =>
			this._provider.upsertAdminOperation(request),
		);
	}

	public deleteAdminOperation(recordIds: string[]): Promise<AdminOperationServiceResult> {
		return this._mutate('admin-operation.delete', { count: recordIds?.length ?? 0 }, () =>
			this._provider.deleteAdminOperation(recordIds),
		);
	}

	public setAdminOperationGrantee(
		request: SetAdminOperationGranteeRequest,
	): Promise<AdminOperationServiceResult> {
		return this._mutate(
			'admin-operation.set-grantee',
			{ adminOperationId: request?.adminOperationId ?? null },
			() => this._provider.setAdminOperationGrantee(request),
		);
	}

	public deleteAdminOperationGrantee(recordIds: string[]): Promise<AdminOperationServiceResult> {
		return this._mutate(
			'admin-operation.delete-grantee',
			{ count: recordIds?.length ?? 0 },
			() => this._provider.deleteAdminOperationGrantee(recordIds),
		);
	}
}
