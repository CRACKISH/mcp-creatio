import {
	AdminOperationProvider,
	AdminOperationServiceResult,
	SetAdminOperationGranteeRequest,
	UpsertAdminOperationRequest,
	UpsertAdminOperationResult,
} from '../../providers';
import { CreatioEngine } from '../engine';

export class AdminOperationEngine implements CreatioEngine {
	private readonly _provider: AdminOperationProvider;

	public readonly name = 'admin-operation';

	constructor(provider: AdminOperationProvider) {
		this._provider = provider;
	}

	public get kind(): string {
		return this._provider.kind;
	}

	public upsertAdminOperation(
		request: UpsertAdminOperationRequest,
	): Promise<UpsertAdminOperationResult> {
		return this._provider.upsertAdminOperation(request);
	}

	public deleteAdminOperation(recordIds: string[]): Promise<AdminOperationServiceResult> {
		return this._provider.deleteAdminOperation(recordIds);
	}

	public setAdminOperationGrantee(
		request: SetAdminOperationGranteeRequest,
	): Promise<AdminOperationServiceResult> {
		return this._provider.setAdminOperationGrantee(request);
	}

	public deleteAdminOperationGrantee(
		recordIds: string[],
	): Promise<AdminOperationServiceResult> {
		return this._provider.deleteAdminOperationGrantee(recordIds);
	}
}
