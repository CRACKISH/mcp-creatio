export interface AdminOperationServiceResult {
	success: boolean;
	exMessage?: string;
	[key: string]: unknown;
}

export interface UpsertAdminOperationRequest {
	id?: string;
	name: string;
	code: string;
	description?: string;
}

export interface UpsertAdminOperationResult extends AdminOperationServiceResult {
	id?: string;
}

export interface SetAdminOperationGranteeRequest {
	adminOperationId: string;
	adminUnitIds: string[];
	canExecute: boolean;
}

export interface AdminOperationProvider {
	readonly kind: string;
	upsertAdminOperation(request: UpsertAdminOperationRequest): Promise<UpsertAdminOperationResult>;
	deleteAdminOperation(recordIds: string[]): Promise<AdminOperationServiceResult>;
	setAdminOperationGrantee(
		request: SetAdminOperationGranteeRequest,
	): Promise<AdminOperationServiceResult>;
	deleteAdminOperationGrantee(recordIds: string[]): Promise<AdminOperationServiceResult>;
}
