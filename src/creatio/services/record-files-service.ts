import {
	CrudProvider,
	FilterNode,
	NavigationProvider,
	RecordFile,
	RecordFileKind,
	RecordFilesProvider,
	RecordFilesQuery,
	RecordFilesResult,
	unknownNameErrorOf,
} from '../contracts';

import { assertEntityName } from './entity-name';
import { assertRecordId } from './identifiers';

// Creatio keeps attachments in two places (verified live on .NET Framework and .NET 8): the
// classic per-object table `<Entity>File` (FK column `<Entity>`), and the generic `SysFile`
// (`RecordSchemaName` + `RecordId`). Both share these columns; `Data` (the content) is never read.
const SYS_FILE = 'SysFile';
const COLUMNS = ['Id', 'Name', 'TypeId', 'Size', 'CreatedOn'];
// `FileType` lookup ids (platform constants).
const KIND_BY_TYPE: Record<string, RecordFileKind> = {
	'529bc2f8-0ee0-df11-971b-001d60e938c6': 'file',
	'539bc2f8-0ee0-df11-971b-001d60e938c6': 'link',
	'549bc2f8-0ee0-df11-971b-001d60e938c6': 'object-link',
};

type Row = Record<string, unknown>;

const equals = (field: string, value: string): FilterNode => ({
	kind: 'condition',
	field,
	op: 'eq',
	value,
});

/**
 * Lists a record's attachments from both storages over the neutral {@link CrudProvider}, newest
 * first, as metadata plus a download link (files) or the target address (links).
 */
export class RecordFilesService implements RecordFilesProvider {
	private readonly _crud: CrudProvider;
	private readonly _navigation: NavigationProvider;

	public readonly kind = 'creatio-record-files';

	constructor(crud: CrudProvider, navigation: NavigationProvider) {
		this._crud = crud;
		this._navigation = navigation;
	}

	private _isUnknownEntity(err: unknown, entity: string): boolean {
		return (
			unknownNameErrorOf(this._crud, err, { entity, collectionRead: true })?.kind === 'entity'
		);
	}

	private async _read(storage: string, filter: FilterNode, top: number): Promise<RecordFile[]> {
		const { items } = await this._crud.read({
			entity: storage,
			columns: COLUMNS,
			filter,
			order: [{ field: 'CreatedOn', dir: 'desc' }],
			top,
		});
		return (items as Row[]).map((row) => this._toFile(storage, row));
	}

	/** An object without a classic `<Entity>File` table simply has no attachments there. */
	private async _readClassic(entity: string, id: string, top: number): Promise<RecordFile[]> {
		const storage = `${entity}File`;
		try {
			return await this._read(storage, equals(`${entity}Id`, id), top);
		} catch (err) {
			if (this._isUnknownEntity(err, storage)) {
				return [];
			}
			throw err;
		}
	}

	private _toFile(storage: string, row: Row): RecordFile {
		const id = String(row.Id);
		const name = row.Name == null ? '' : String(row.Name);
		const kind = KIND_BY_TYPE[String(row.TypeId ?? '').toLowerCase()] ?? 'file';
		return {
			id,
			name,
			kind,
			size: Number(row.Size) || 0,
			createdOn: row.CreatedOn == null ? null : String(row.CreatedOn),
			storage,
			...(kind === 'file'
				? { downloadUrl: this._navigation.fileDownloadUrl(storage, id) }
				: {}),
			...(kind === 'link' ? { url: name } : {}),
		};
	}

	public async listRecordFiles({
		entity,
		id,
		top,
	}: RecordFilesQuery): Promise<RecordFilesResult> {
		assertEntityName(entity);
		assertRecordId(id);
		// One extra row per storage tells whether another page exists.
		const [classic, generic] = await Promise.all([
			this._readClassic(entity, id, top + 1),
			this._read(
				SYS_FILE,
				{
					kind: 'group',
					logic: 'and',
					items: [equals('RecordSchemaName', entity), equals('RecordId', id)],
				},
				top + 1,
			),
		]);
		const files = [...classic, ...generic].sort((a, b) =>
			String(b.createdOn ?? '').localeCompare(String(a.createdOn ?? '')),
		);
		return { files: files.slice(0, top), hasMore: files.length > top };
	}
}
