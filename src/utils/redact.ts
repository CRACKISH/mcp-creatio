/**
 * Central secret-scrubber for anything that crosses an outward boundary — tool results relayed to
 * the LLM client and log lines. Invariant #7 / §9 in AGENTS.md ("do not leak secrets or access
 * tokens in tool responses; strip or mask token-like values") used to be a convention enforced by
 * hand at each call site; this turns it into one guaranteed choke point.
 *
 * It is defense-in-depth, NOT the primary control: providers should still avoid putting credentials
 * into messages/results in the first place. Because it errs toward over-redaction (a stray "Token
 * abc" in prose is scrubbed), it is intentionally applied only at the two outward edges, never to
 * data the server operates on internally.
 *
 * Complements {@link redactUrl} in the HTTP middleware (which scrubs single-use OAuth codes from
 * request URLs) — that one is URL/query-specific; this one is a general value scrubber.
 */

const REDACTED = '[REDACTED]';

/**
 * A value following an auth scheme keyword: `Bearer <jwt>`, `Basic <b64>`, `ApiKey <v>`, `Token <v>`.
 * The scheme is preserved (it is not the secret); only the credential after it is masked.
 */
const AUTH_SCHEME_VALUE_RE = /\b(Bearer|Basic|ApiKey|Token)\s+[\w.\-+/=]+/gi;

/** An `Authorization` header value in either `Authorization: <v>` or `Authorization=<v>` form. */
const AUTHORIZATION_HEADER_RE = /\b(Authorization)(\s*[:=]\s*)[^\s,;"']+/gi;

/**
 * A secret-bearing parameter's VALUE in query-string (`client_secret=…`), form, or JSON
 * (`"password":"…"`) shape. The key (and an optional opening quote) is preserved; the value up to
 * the next delimiter/closing quote is masked. Stops before a closing `"` so JSON stays well-formed.
 */
const SECRET_PARAM_RE =
	/("?\b(?:client_secret|client_id_secret|api_key|apikey|password|passwd|pwd|access_token|refresh_token|id_token|session_token|secret|bpmcsrf)\b"?\s*[:=]\s*)("?)[^"\s,;&}]+/gi;

/**
 * Mask credential-looking substrings in arbitrary text. Idempotent (re-running yields the same
 * output) and safe on non-secret text (returns it unchanged). Always returns a string.
 */
export function redactSecrets(input: unknown): string {
	if (typeof input !== 'string' || input.length === 0) {
		return typeof input === 'string' ? input : String(input ?? '');
	}
	return input
		.replace(AUTH_SCHEME_VALUE_RE, (_m, scheme: string) => `${scheme} ${REDACTED}`)
		.replace(AUTHORIZATION_HEADER_RE, (_m, key: string, sep: string) => `${key}${sep}${REDACTED}`)
		.replace(SECRET_PARAM_RE, (_m, prefix: string, openQuote: string) => `${prefix}${openQuote}${REDACTED}`);
}

/**
 * Redact secrets from an Error's message while preserving the Error instance (type + stack), so the
 * MCP layer can relay a clean message without losing diagnostics. Non-Error throwables are wrapped.
 */
export function redactError(err: unknown): Error {
	if (err instanceof Error) {
		try {
			err.message = redactSecrets(err.message);
		} catch {
			// Some exotic Error subclasses define a non-writable `message`; fall back to a wrapper
			// that carries the redacted text while keeping the original as the cause for debugging.
			return new Error(redactSecrets(err.message), { cause: err });
		}
		return err;
	}
	return new Error(redactSecrets(typeof err === 'string' ? err : String(err)));
}
