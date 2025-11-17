import { CreatioEngine } from './engine';

export enum EngineType {
	Crud = 'crud',
	Process = 'process',
	SysSettings = 'sys-settings',
	User = 'user',
}

export class EngineRegistry {
	private readonly _engines = new Map<string, CreatioEngine>();

	public register(engine: CreatioEngine): CreatioEngine {
		if (this._engines.has(engine.name)) {
			throw new Error(`engine_already_registered:${engine.name}`);
		}
		this._engines.set(engine.name, engine);
		return engine;
	}

	public get<T extends CreatioEngine = CreatioEngine>(name: string): T | undefined {
		return this._engines.get(name) as T | undefined;
	}

	public require<T extends CreatioEngine = CreatioEngine>(name: string): T {
		const engine = this.get<T>(name);
		if (!engine) {
			throw new Error(`engine_not_registered:${name}`);
		}
		return engine;
	}

	public entries(): IterableIterator<[string, CreatioEngine]> {
		return this._engines.entries();
	}
}
