/** What an attachment is: an uploaded file, a web link, or a link to another Creatio record. */
export type RecordFileKind = 'file' | 'link' | 'object-link';

/** Attachment metadata — never the content. */
export interface RecordFile {
	id: string;
	name: string;
	kind: RecordFileKind;
	/** Bytes (0 for links). */
	size: number;
	createdOn: string | null;
	/** Where the attachment is stored (`<Entity>File` or `SysFile`). */
	storage: string;
	/** A file's download link (needs a signed-in Creatio browser session). */
	downloadUrl?: string;
	/** A link's target address. */
	url?: string;
}

export interface RecordFilesQuery {
	entity: string;
	id: string;
	top: number;
}

export interface RecordFilesResult {
	files: RecordFile[];
	hasMore: boolean;
}

export interface RecordFilesProvider {
	readonly kind: string;
	listRecordFiles(query: RecordFilesQuery): Promise<RecordFilesResult>;
}
