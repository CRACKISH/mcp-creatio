import { randomUUID } from 'node:crypto';

import {
	AdminOperationProvider,
	AdminOperationServiceResult,
	SetAdminOperationGranteeRequest,
	UpsertAdminOperationRequest,
	UpsertAdminOperationResult,
} from '../providers';

import { CreatioHttpClient } from './http-client';

const EMPTY_GUID = '00000000-0000-0000-0000-000000000000';

interface RightsHelperInner {
	Success: boolean;
	ExMessage?: string;
}

export class AdminOperationServiceProvider implements AdminOperationProvider {
	private readonly _client: CreatioHttpClient;

	public readonly kind = 'creatio-admin-operation-service';

	constructor(client: CreatioHttpClient) {
		this._client = client;
	}

	private _getMethodUrl(method: string): string {
		return `${this._client.normalizedBaseUrl}/0/rest/RightsService/${method}`;
	}

	private _parseRightsResponse(method: string, body: any): RightsHelperInner {
		const resultKey = `${method}Result`;
		const wrapped = body?.[resultKey];
		if (typeof wrapped !== 'string') {
			throw new Error(
				`creatio_rights_service_unexpected_response:${method}:${JSON.stringify(body)}`,
			);
		}
		return JSON.parse(wrapped) as RightsHelperInner;
	}

	private async _callRightsService(
		method: string,
		payload: Record<string, unknown>,
	): Promise<AdminOperationServiceResult> {
		const url = this._getMethodUrl(method);
		return this._client.executeWithTiming(
			method,
			url,
			async () => {
				const requestInit = await this._client.createPostRequest(payload);
				return this._client.fetchWithAuth(url, async () => requestInit);
			},
			async (response, duration) => {
				const body = await response.json();
				const inner = this._parseRightsResponse(method, body);
				const success = Boolean(inner.Success);
				this._client.logSuccess(method, response.status, duration, {
					rightsServiceSuccess: success,
				});
				const result: AdminOperationServiceResult = { success };
				if (inner.ExMessage !== undefined && inner.ExMessage !== '') {
					result.exMessage = inner.ExMessage;
				}
				return result;
			},
			async (response, duration) =>
				this._client.handleErrorResponse(
					method,
					response,
					duration,
					`creatio_${method.toLowerCase()}_failed`,
					{ url },
				),
			{ method },
		);
	}

	public async upsertAdminOperation(
		request: UpsertAdminOperationRequest,
	): Promise<UpsertAdminOperationResult> {
		const recordId = request.id && request.id !== EMPTY_GUID ? request.id : randomUUID();
		const payload = {
			recordId,
			name: request.name,
			code: request.code,
			description: request.description ?? '',
		};
		const base = await this._callRightsService('UpsertAdminOperation', payload);
		const result: UpsertAdminOperationResult = { ...base, id: recordId };
		return result;
	}

	public async deleteAdminOperation(recordIds: string[]): Promise<AdminOperationServiceResult> {
		return this._callRightsService('DeleteAdminOperation', { recordIds });
	}

	public async setAdminOperationGrantee(
		request: SetAdminOperationGranteeRequest,
	): Promise<AdminOperationServiceResult> {
		return this._callRightsService('SetAdminOperationGrantee', {
			adminOperationId: request.adminOperationId,
			adminUnitIds: request.adminUnitIds,
			canExecute: request.canExecute,
		});
	}

	public async deleteAdminOperationGrantee(
		recordIds: string[],
	): Promise<AdminOperationServiceResult> {
		return this._callRightsService('DeleteAdminOperationGrantee', { recordIds });
	}
}
