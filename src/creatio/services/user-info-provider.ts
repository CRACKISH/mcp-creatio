import { CurrentUserInfo, UserProvider } from '../providers';

import { CreatioHttpClient } from './http-client';

export class UserInfoProvider implements UserProvider {
	private readonly _client: CreatioHttpClient;

	public readonly kind = 'creatio-user-info-service';

	constructor(client: CreatioHttpClient) {
		this._client = client;
	}

	public async getCurrentUserInfo(): Promise<CurrentUserInfo> {
		const url = this._client.getUserInfoServiceUrl();
		return this._client.executeWithTiming(
			'getCurrentUserInfo',
			url,
			async () => {
				const requestInit = await this._client.createPostRequest();
				return this._client.fetchWithAuth(url, async () => requestInit);
			},
			async (response, duration) => {
				this._client.logSuccess('getCurrentUserInfo', response.status, duration);
				const body = await response.json().catch(() => ({}));
				return body as CurrentUserInfo;
			},
			async (response, duration) =>
				this._client.handleErrorResponse(
					'getCurrentUserInfo',
					response,
					duration,
					'creatio_get_current_user_info_failed',
				),
		);
	}
}
