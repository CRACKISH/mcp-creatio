import { workspaceBaseUrl } from '../../workspace-mount';

/** OData service root for a Creatio instance: `{base}/0/odata` on .NET Framework, `{base}/odata`
 *  on .NET 8 (see {@link workspaceBaseUrl}). Kept in the OData layer so the shared
 *  {@link CreatioHttpClient} stays transport-only (no dialect-specific URL knowledge). */
export async function odataRoot(normalizedBaseUrl: string): Promise<string> {
	return `${await workspaceBaseUrl(normalizedBaseUrl)}/odata`;
}
