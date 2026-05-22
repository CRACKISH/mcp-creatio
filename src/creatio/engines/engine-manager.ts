import { CreatioProviderContext } from '../provider-context';
import {
	AdminOperationProvider,
	ConfigurationProvider,
	CrudProvider,
	FeatureProvider,
	ProcessProvider,
	SysSettingsProvider,
	UserProvider,
} from '../providers';

import { AdminOperationEngine } from './admin-operation/admin-operation-engine';
import { ConfigurationEngine } from './configuration/configuration-engine';
import { CrudEngine } from './crud/crud-engine';
import { CreatioEngine } from './engine';
import { EngineRegistry, EngineType } from './engine-registry';
import { FeatureEngine } from './feature/feature-engine';
import { ProcessEngine } from './process/process-engine';
import { SysSettingsEngine } from './sys-settings/sys-settings-engine';
import { UserEngine } from './user/user-engine';

export interface EngineManagerOptions {
	adminOperationProvider?: AdminOperationProvider;
	configurationProvider?: ConfigurationProvider;
	crudProvider?: CrudProvider;
	featureProvider?: FeatureProvider;
	processProvider?: ProcessProvider;
	sysSettingsProvider?: SysSettingsProvider;
	userProvider?: UserProvider;
	enableAdminOperation?: boolean;
	enableConfiguration?: boolean;
	enableCrud?: boolean;
	enableFeature?: boolean;
	enableProcess?: boolean;
	enableSysSettings?: boolean;
	enableUser?: boolean;
}

export class CreatioEngineManager {
	private readonly _context: CreatioProviderContext;
	private readonly _options: EngineManagerOptions | undefined;
	private readonly _registry = new EngineRegistry();
	private readonly _engines = new Map<string, CreatioEngine>();

	public get authProvider() {
		return this._context.authProvider;
	}

	public get registry(): EngineRegistry {
		return this._registry;
	}

	public get adminOperation(): AdminOperationEngine {
		return this._registry.require<AdminOperationEngine>(EngineType.AdminOperation);
	}

	public get configuration(): ConfigurationEngine {
		return this._registry.require<ConfigurationEngine>(EngineType.Configuration);
	}

	public get crud(): CrudEngine {
		return this._registry.require<CrudEngine>(EngineType.Crud);
	}

	public get feature(): FeatureEngine {
		return this._registry.require<FeatureEngine>(EngineType.Feature);
	}

	public get process(): ProcessEngine {
		return this._registry.require<ProcessEngine>(EngineType.Process);
	}

	public get sysSettings(): SysSettingsEngine {
		return this._registry.require<SysSettingsEngine>(EngineType.SysSettings);
	}

	public get user(): UserEngine {
		return this._registry.require<UserEngine>(EngineType.User);
	}

	constructor(context: CreatioProviderContext, options?: EngineManagerOptions) {
		this._context = context;
		this._options = options;
		this._initialize();
	}

	private _initialize() {
		this._registerEngine(
			EngineType.AdminOperation,
			() =>
				new AdminOperationEngine(
					this._options?.adminOperationProvider ??
						(this._context.adminOperation as AdminOperationProvider),
				),
			this._options?.enableAdminOperation ?? true,
		);
		this._registerEngine(
			EngineType.Configuration,
			() =>
				new ConfigurationEngine(
					this._options?.configurationProvider ??
						(this._context.configuration as ConfigurationProvider),
				),
			this._options?.enableConfiguration ?? true,
		);
		this._registerEngine(
			EngineType.Crud,
			() =>
				new CrudEngine(this._options?.crudProvider ?? (this._context.crud as CrudProvider)),
			this._options?.enableCrud ?? true,
		);
		this._registerEngine(
			EngineType.Feature,
			() =>
				new FeatureEngine(
					this._options?.featureProvider ?? (this._context.feature as FeatureProvider),
				),
			this._options?.enableFeature ?? true,
		);
		this._registerEngine(
			EngineType.Process,
			() =>
				new ProcessEngine(
					this._options?.processProvider ?? (this._context.process as ProcessProvider),
				),
			this._options?.enableProcess ?? true,
		);
		this._registerEngine(
			EngineType.SysSettings,
			() =>
				new SysSettingsEngine(
					this._options?.sysSettingsProvider ??
						(this._context.sysSettings as SysSettingsProvider),
				),
			this._options?.enableSysSettings ?? true,
		);
		this._registerEngine(
			EngineType.User,
			() =>
				new UserEngine(this._options?.userProvider ?? (this._context.user as UserProvider)),
			this._options?.enableUser ?? true,
		);
	}

	private _registerEngine<T extends CreatioEngine>(
		type: EngineType,
		factory: () => T,
		enabled: boolean,
	) {
		if (!enabled) {
			return;
		}
		const engine = factory();
		this._engines.set(type, engine);
		this._registry.register(engine);
	}
}
