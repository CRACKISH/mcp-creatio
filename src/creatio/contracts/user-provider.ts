export interface CurrentUserInfo {
	userId?: string;
	contactId?: string;
	userName?: string;
	cultureName?: string;
	[key: string]: any;
}

export interface UserProvider {
	readonly kind: string;
	getCurrentUserInfo(): Promise<CurrentUserInfo>;
}
