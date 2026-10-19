/** Builds browser links into a Creatio instance (pure: no request is made). */
export interface NavigationProvider {
	readonly kind: string;
	/** Opens the record's page (classic or Freedom UI, whichever the instance uses); the platform
	 *  resolves the page when the link is opened. */
	recordUrl(entity: string, id: string): string;
	/** Downloads an attachment stored in `fileEntity` (e.g. `AccountFile`, `SysFile`). */
	fileDownloadUrl(fileEntity: string, fileId: string): string;
}
