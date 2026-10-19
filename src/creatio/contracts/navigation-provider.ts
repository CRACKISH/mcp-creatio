/** Builds links into the Creatio UI. */
export interface NavigationProvider {
	readonly kind: string;
	/** A browser link that opens the record's page (classic or Freedom UI, whichever the instance
	 *  uses). Pure: the platform resolves the page when the link is opened. */
	recordUrl(entity: string, id: string): string;
}
