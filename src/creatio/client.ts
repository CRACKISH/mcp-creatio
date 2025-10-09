import { ICreatioAuthProvider } from './auth';

export interface CreatioClient {
	authProvider: ICreatioAuthProvider;
	getCurrentUserInfo(): Promise<any>;
	listEntitySets(): Promise<string[]>;
	describeEntity(entitySet: string): Promise<any>;
	read(
		entity: string,
		filter?: string,
		select?: string[],
		top?: number,
		expand?: string[],
		orderBy?: string,
	): Promise<any>;
	create(entity: string, data: any): Promise<any>;
	update(entity: string, id: string, data: any): Promise<any>;
	delete(entity: string, id: string): Promise<any>;
	executeProcess(processName: string, parameters: any): Promise<any>;
}
