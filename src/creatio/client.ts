export type CreatioClientAuthConfig =
	| { kind: 'legacy'; login: string; password: string }
	| { kind: 'oauth2'; clientId: string; clientSecret: string; idBaseUrl?: string };

export interface CreatioClientConfig {
	baseUrl: string;
	auth: CreatioClientAuthConfig;
}

export interface CreatioClient {
	read(entity: string, filter?: string, select?: string[], top?: number): Promise<any>;
	create(entity: string, data: any): Promise<any>;
	update(entity: string, id: string, data: any): Promise<any>;
	delete(entity: string, id: string): Promise<any>;
	listEntitySets(): Promise<string[]>;
	describeEntity(entitySet: string): Promise<any>;
}
