import log from '../../../log';
import { JSON_ACCEPT } from '../../../types';
import { parseSetCookie } from '../../../utils';
import { LegacyAuthConfig } from '../../client-config';
import { buildHeaders } from '../auth';

import { BaseProvider } from './base-provider';

export class LegacyProvider extends BaseProvider<LegacyAuthConfig> {
	private _bpmCsrf: string | undefined;

	private _cookieHeader: string | undefined;

	private async _ensureSession() {
		if (this._cookieHeader) {
			return;
		}
		const url = `${this.config.baseUrl.replace(/\/$/, '')}/ServiceModel/AuthService.svc/Login`;
		const body = JSON.stringify({
			UserName: this.authConfig.login,
			UserPassword: this.authConfig.password,
		});
		log.creatioAuthStart(this.config.baseUrl, 'legacy');
		const res = await fetch(url, {
			method: 'POST',
			headers: buildHeaders(JSON_ACCEPT, true),
			body,
			redirect: 'manual',
		});
		if (!res.ok) {
			const responseText = await res.text().catch(() => '');
			log.creatioAuthFailed(this.config.baseUrl, `${res.status} ${responseText}`, 'legacy');
			throw new Error(`auth_failed:${res.status} ${responseText}`);
		}
		log.creatioAuthOk(this.config.baseUrl, 'legacy');
		let setCookie: string[] = [];
		if (typeof (res.headers as any).getSetCookie === 'function') {
			setCookie = (res.headers as any).getSetCookie();
		} else if ((res.headers as any).raw && (res.headers as any).raw()['set-cookie']) {
			setCookie = (res.headers as any).raw()['set-cookie'];
		} else {
			setCookie = [];
		}
		const pairs = parseSetCookie(setCookie);
		if (!pairs.length) {
			throw new Error('auth_failed:no_set_cookie');
		}
		this._cookieHeader = pairs.map((c) => `${c.name}=${c.value}`).join('; ');
		const csrf = pairs.find((c) => c.name.toUpperCase() === 'BPMCSRF')?.value;
		if (csrf) {
			this._bpmCsrf = csrf;
		}
	}

	public async getHeaders(accept: string, isJson?: boolean): Promise<Record<string, string>> {
		await this._ensureSession();
		const h = buildHeaders(accept, Boolean(isJson));
		h['ForceUseSession'] = 'true';
		h['Cookie'] = this._cookieHeader!;
		if (this._bpmCsrf) {
			h['BPMCSRF'] = this._bpmCsrf;
		}
		return h;
	}

	public async refresh(): Promise<void> {
		this._cookieHeader = undefined;
		await this._ensureSession();
	}
}
