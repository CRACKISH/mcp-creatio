export interface ExecuteProcessParams {
	processName: string;
	parameters?: Record<string, any> | undefined;
}

export interface ExecuteProcessResult {
	status?: string;
	returnValues?: Record<string, any>;
	[key: string]: any;
}

export interface ProcessProvider {
	readonly kind: string;
	executeProcess(params: ExecuteProcessParams): Promise<ExecuteProcessResult>;
}
