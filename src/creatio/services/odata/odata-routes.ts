/** OData service root for a Creatio instance. Kept in the OData layer so the shared
 *  {@link CreatioHttpClient} stays transport-only (no dialect-specific URL knowledge). */
export function odataRoot(normalizedBaseUrl: string): string {
	return `${normalizedBaseUrl}/0/odata`;
}
