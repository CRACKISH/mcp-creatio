export interface QuerySysSettingsResponse {
	success: boolean;
	values: Record<string, SysSettingDetail>;
	notFoundSettings?: string[];
}

export interface SysSettingDetail {
	code?: string;
	value?: unknown;
	displayValue?: string;
	isCacheable?: boolean;
	dataValueType?: number | string;
	dataValueTypeName?: number | string;
	id?: string;
	name?: string;
}

export interface SysSettingDefinition extends Record<string, unknown> {
	code: string;
	name: string;
	valueTypeName: string;
	id?: string | undefined;
	description?: string | undefined;
	isCacheable?: boolean | undefined;
	isPersonal?: boolean | undefined;
	isSSPAvailable?: boolean | undefined;
	referenceSchemaUId?: string | undefined;
	dataValueType?: number | string | undefined;
}

export type SysSettingDefinitionUpdate = Partial<SysSettingDefinition> & { id: string };

export interface CreateSysSettingRequest {
	definition: SysSettingDefinition;
	initialValue?: unknown;
	isPersonal?: boolean;
}

export interface SysSettingInsertResponse extends Record<string, unknown> {
	id: string;
	success: boolean;
	rowsAffected?: number;
	nextPrcElReady?: boolean;
}

export interface SysSettingUpdateResponse extends Record<string, unknown> {
	success?: boolean;
	rowsAffected?: number;
	nextPrcElReady?: boolean;
}

export interface CreateSysSettingResult {
	insertResult: SysSettingInsertResponse;
	setValueResult?: any;
}

export interface SysSettingsProvider {
	readonly kind: string;
	setValues(values: Record<string, any>): Promise<any>;
	queryValues(codes: string[]): Promise<QuerySysSettingsResponse>;
	createSetting(request: CreateSysSettingRequest): Promise<CreateSysSettingResult>;
	updateDefinition(definition: SysSettingDefinitionUpdate): Promise<SysSettingUpdateResponse>;
}
