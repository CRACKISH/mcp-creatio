import crypto from 'node:crypto';

/**
 * AES-256-GCM encryption for tokens at rest. Stored Creatio tokens are bearer credentials, so a
 * persistent store (Redis) must never hold them in plaintext — a dump of the store would otherwise
 * be a credential leak. GCM gives confidentiality + integrity (a tampered blob fails to decrypt).
 */
const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;

/** Derive a stable 32-byte key from a secret (any length), domain-separated so it never collides
 *  with the JWT-signing use of the same secret when no dedicated `CREATIO_MCP_TOKEN_ENC_KEY` is set. */
export function deriveTokenKey(secret: string): Buffer {
	return crypto.createHash('sha256').update(`mcp-creatio:token-enc:${secret}`).digest();
}

/** Encrypt to a self-describing `iv.tag.ciphertext` (base64url) blob. */
export function encryptToken(plaintext: string, key: Buffer): string {
	const iv = crypto.randomBytes(IV_BYTES);
	const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
	const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
	const tag = cipher.getAuthTag();
	return [iv, tag, ciphertext].map((b) => b.toString('base64url')).join('.');
}

/** Decrypt an `iv.tag.ciphertext` blob; throws if the key is wrong or the blob was tampered with. */
export function decryptToken(blob: string, key: Buffer): string {
	const [ivB64, tagB64, ctB64] = blob.split('.');
	if (!ivB64 || !tagB64 || !ctB64) {
		throw new Error('token_blob_malformed');
	}
	const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(ivB64, 'base64url'));
	decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
	return Buffer.concat([
		decipher.update(Buffer.from(ctB64, 'base64url')),
		decipher.final(),
	]).toString('utf8');
}
