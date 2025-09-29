import { ICreatioAuthProvider } from './auth';

export interface CreatioClient {
	authProvider: ICreatioAuthProvider;
	read(entity: string, filter?: string, select?: string[], top?: number): Promise<any>;
	create(entity: string, data: any): Promise<any>;
	update(entity: string, id: string, data: any): Promise<any>;
	delete(entity: string, id: string): Promise<any>;
	listEntitySets(): Promise<string[]>;
	describeEntity(entitySet: string): Promise<any>;
	executeProcess(processName: string, parameters: any): Promise<any>;
}
