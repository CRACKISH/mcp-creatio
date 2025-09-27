function base64UrlEncode(bytes: Uint8Array): string {
	let bin = '';
	for (let i = 0; i < bytes.length; i++) {
		bin += String.fromCharCode(bytes[i]!);
	}
	const b64 = Buffer.from(bin, 'binary').toString('base64');
	return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function generateCodeVerifier(length: number = 32): string {
	const arr = new Uint8Array(length);
	if (typeof crypto !== 'undefined' && typeof (crypto as any).getRandomValues === 'function') {
		(crypto as any).getRandomValues(arr);
	} else {
		const { randomBytes } = require('node:crypto');
		const rb: Buffer = randomBytes(length);
		for (let i = 0; i < length; i++) {
			arr[i] = rb[i]!;
		}
	}
	return base64UrlEncode(arr);
}

export async function challengeS256(verifier: string): Promise<string> {
	const data = new TextEncoder().encode(verifier);
	if (typeof crypto !== 'undefined' && (crypto as any).subtle?.digest) {
		const hash = await (crypto as any).subtle.digest('SHA-256', data);
		return base64UrlEncode(new Uint8Array(hash));
	}
	const { createHash } = require('node:crypto');
	const hash = createHash('sha256').update(Buffer.from(data)).digest();
	return base64UrlEncode(new Uint8Array(hash));
}

export async function generatePkcePair() {
	const verifier = generateCodeVerifier();
	const challenge = await challengeS256(verifier);
	return { verifier, challenge } as const;
}
