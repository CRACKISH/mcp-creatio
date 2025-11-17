export interface SysSettingsProvider {
	readonly kind: string;
	setValues(values: Record<string, any>): Promise<any>;
}
