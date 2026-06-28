#!/usr/bin/env node
/**
 * Live regression harness for mcp-creatio — drives a REAL Creatio instance over MCP and exercises
 * every auth mode + tool surface, including an opt-in CRUD lifecycle. Reusable: describe targets in
 * a JSON config and run it whenever you change the server. NOT part of `npm test` (needs real
 * credentials + network); this is the manual end-to-end gate described in AGENTS.md §10.
 *
 *   node scripts/live-regression.mjs [config.json] [--only <label>]
 *
 * Config defaults to scripts/live-regression.local.json (gitignored — keep your creds there).
 * See scripts/live-regression.example.json for the schema. Each target:
 *   { label, kind:"stdio"|"http", ... , crud?:bool, crudEntity?:string }
 *   stdio:  { baseUrl, login, password, env? }
 *   http:   { mode:"legacy"|"client_credentials"|"delegated"|"gateway"|"broker",
 *             serverEnv:{...}, port?, baseUrlOverride?, bearer?|clientCredentials:{tokenUrl,clientId,clientSecret},
 *             broker?:{ callbackPort?, waitMs?, scope? } }
 *
 * The server process (dist/index.js) is started/stopped by the harness for http targets, and
 * dist/cli.js is spawned for stdio targets — run `npm run build` first. For broker the harness does
 * DCR + PKCE + a local callback catcher and PRINTS the authorize URL, then waits: open it in a
 * browser and log in (the interactive consent is the whole point of broker mode).
 */
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const args = process.argv.slice(2);
const onlyIdx = args.indexOf('--only');
const only = onlyIdx >= 0 ? args[onlyIdx + 1] : undefined;
const configPath = args.find((a) => !a.startsWith('--') && a !== only) ?? 'scripts/live-regression.local.json';

let pass = 0;
let fail = 0;
const check = (label, cond, detail = '') => {
	(cond ? (pass++, console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ''}`)) : (fail++, console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`)));
	return cond;
};

function categorize(names) {
	return {
		base: names.filter((n) => !n.startsWith('dataforge-') && n !== 'global-search' && !n.startsWith('pub-')),
		df: names.filter((n) => n.startsWith('dataforge-')),
		gs: names.filter((n) => n === 'global-search'),
		pub: names.filter((n) => n.startsWith('pub-')),
	};
}

// The capability probe is async and runs preparers sequentially (dataforge → globalsearch →
// published, which registers LAST), so wait until the tool count is stable across two reads.
async function waitToolsStable(client) {
	let names = [];
	let prev = -1;
	let stable = 0;
	for (let i = 0; i < 15; i++) {
		await sleep(2000);
		names = (await client.listTools()).tools.map((t) => t.name);
		if (names.length === prev) {
			if (++stable >= 2) break;
		} else stable = 0;
		prev = names.length;
	}
	return names;
}

async function call(client, name, argv) {
	try {
		const r = await client.callTool({ name, arguments: argv ?? {} });
		const text = (r.content ?? []).map((b) => b.text ?? '').join('');
		return { ok: !r.isError, text };
	} catch (e) {
		return { ok: false, text: String(e) };
	}
}

const firstGuid = (s) => (s.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i) ?? [])[0];

async function readSmoke(client) {
	const u = await call(client, 'get-current-user-info', {});
	check('get-current-user-info', u.ok && /contactId/i.test(u.text), u.text.slice(0, 80));
	const d = await call(client, 'describe-entity', { entitySet: 'Contact' });
	const src = (d.text.match(/"source":"(\w+)"/) ?? [])[1];
	check('describe-entity', d.ok, `source=${src}`);
	const r = await call(client, 'read', { entity: 'Contact', top: 2, select: ['Id', 'Name'] });
	check('read Contact', r.ok && /"Id"/.test(r.text), r.text.slice(0, 60));
}

// Full create → read-back → update → delete → verify-gone lifecycle. Opt-in (target.crud), uses a
// clearly-labelled throwaway record and cleans up after itself.
async function crudLifecycle(client, entity) {
	const tag = `mcp-live-regression ${new Date().toISOString()}`;
	const created = await call(client, 'create', { entity, data: { Name: tag } });
	const id = firstGuid(created.text);
	if (!check('CRUD create', created.ok && !!id, id ?? created.text.slice(0, 80))) return;
	const back = await call(client, 'read', { entity, filters: { all: [{ field: 'Id', op: 'eq', value: id }] }, top: 1 });
	check('CRUD read-back', back.ok && back.text.includes(id), 'found new record');
	const upd = await call(client, 'update', { entity, id, data: { Name: `${tag} (updated)` } });
	check('CRUD update', upd.ok, upd.text.slice(0, 60));
	const del = await call(client, 'delete', { entity, id });
	check('CRUD delete', del.ok, del.text.slice(0, 60));
	const gone = await call(client, 'read', { entity, filters: { all: [{ field: 'Id', op: 'eq', value: id }] }, top: 1 });
	check('CRUD verify-gone', gone.ok && !gone.text.includes(id), 'record removed');
}

async function mintBearer(cc) {
	const body = new URLSearchParams({ grant_type: 'client_credentials', client_id: cc.clientId, client_secret: cc.clientSecret });
	const res = await fetch(cc.tokenUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
	const json = await res.json();
	if (!json.access_token) throw new Error(`token endpoint: ${JSON.stringify(json)}`);
	return json.access_token;
}

function startServer(serverEnv) {
	const proc = spawn(process.execPath, [path.join(ROOT, 'dist', 'index.js')], {
		env: { ...process.env, ...serverEnv },
		stdio: ['ignore', 'ignore', 'inherit'],
	});
	return proc;
}

async function waitHttpReady(url) {
	for (let i = 0; i < 40; i++) {
		try { await fetch(url, { method: 'GET' }); return; } catch { await sleep(500); }
	}
	throw new Error(`server not ready at ${url}`);
}

// Broker: DCR-register a client, run a local callback catcher, print the authorize URL, wait for the
// interactive login to deliver a code, then exchange it (PKCE) for an MCP access token.
async function brokerToken(baseUrl, broker) {
	const callbackPort = broker.callbackPort ?? 9876;
	const redirectUri = `http://localhost:${callbackPort}/callback`;
	const reg = await (await fetch(`${baseUrl}/register`, {
		method: 'POST', headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ client_name: 'live-regression', redirect_uris: [redirectUri], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' }),
	})).json();
	const verifier = b64url(randomBytes(32));
	const challenge = b64url(createHash('sha256').update(verifier).digest());
	const state = b64url(randomBytes(8));
	let resolveCode;
	const codePromise = new Promise((res) => (resolveCode = res));
	const catcher = createServer((req, res) => {
		const u = new URL(req.url, redirectUri);
		if (u.pathname === '/callback') {
			res.writeHead(200, { 'Content-Type': 'text/plain' });
			res.end('Login complete — you can close this tab.');
			resolveCode({ code: u.searchParams.get('code'), state: u.searchParams.get('state') });
		} else { res.writeHead(404); res.end(); }
	}).listen(callbackPort);
	const authorizeUrl = `${baseUrl}/authorize?response_type=code&client_id=${encodeURIComponent(reg.client_id)}&redirect_uri=${encodeURIComponent(redirectUri)}&code_challenge=${challenge}&code_challenge_method=S256&state=${state}${broker.scope ? `&scope=${encodeURIComponent(broker.scope)}` : ''}`;
	console.log(`\n  >>> OPEN THIS URL IN A BROWSER AND LOG IN (Supervisor/Supervisor):\n  ${authorizeUrl}\n`);
	const waitMs = broker.waitMs ?? 240000;
	const got = await Promise.race([codePromise, sleep(waitMs).then(() => null)]);
	catcher.close();
	if (!got?.code) throw new Error('broker: no authorization code received before timeout');
	check('broker state echo', got.state === state);
	const tok = await (await fetch(`${baseUrl}/token`, {
		method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({ grant_type: 'authorization_code', code: got.code, redirect_uri: redirectUri, client_id: reg.client_id, code_verifier: verifier }),
	})).json();
	if (!tok.access_token) throw new Error(`broker token: ${JSON.stringify(tok)}`);
	return tok.access_token;
}

async function runTarget(t) {
	console.log(`\n=== ${t.label} (${t.kind}${t.mode ? `/${t.mode}` : ''}) ===`);
	let proc;
	let transport;
	const port = t.port ?? 3000;
	const url = `http://localhost:${port}/mcp`;
	try {
		if (t.kind === 'stdio') {
			transport = new StdioClientTransport({
				command: process.execPath,
				args: [path.join(ROOT, 'dist', 'cli.js'), '--base-url', t.baseUrl, '--login', t.login, '--password', t.password],
				env: { ...process.env, ...(t.env ?? {}) },
				cwd: ROOT,
				stderr: 'inherit',
			});
		} else {
			proc = startServer({ CREATIO_MCP_PORT: String(port), ...t.serverEnv });
			await waitHttpReady(url);
			const headers = { ...(t.headers ?? {}) };
			let bearer = t.bearer;
			if (!bearer && t.clientCredentials) bearer = await mintBearer(t.clientCredentials);
			if (t.mode === 'broker') bearer = await brokerToken(`http://localhost:${port}`, t.broker ?? {});
			if (bearer) headers['Authorization'] = `Bearer ${bearer}`;
			if (t.baseUrlOverride) headers['X-Creatio-Base-Url'] = t.baseUrlOverride;
			transport = new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers } });
		}
		const client = new Client({ name: 'live-regression', version: '1.0.0' }, { capabilities: {} });
		await client.connect(transport);
		const names = await waitToolsStable(client);
		const c = categorize(names);
		console.log(`  tools: total=${names.length} base=${c.base.length} dataforge=${c.df.length} globalSearch=${c.gs.length} published=${c.pub.length}`);
		if (t.expect) {
			if (t.expect.dataforge !== undefined) check('expect dataforge', (c.df.length > 0) === t.expect.dataforge);
			if (t.expect.published !== undefined) check('expect published', (c.pub.length > 0) === t.expect.published);
			if (t.expect.baseOnly) check('expect base-only', c.df.length === 0 && c.gs.length === 0 && c.pub.length === 0);
		}
		await readSmoke(client);
		if (t.crud) await crudLifecycle(client, t.crudEntity ?? 'Contact');
		await client.close();
	} catch (e) {
		fail++;
		console.log(`  ✗ target threw: ${String(e).slice(0, 200)}`);
	} finally {
		if (proc) proc.kill();
	}
}

const config = JSON.parse(readFileSync(path.resolve(configPath), 'utf8'));
const targets = (config.targets ?? []).filter((t) => !only || t.label === only);
if (!targets.length) { console.error(`No targets (config=${configPath}${only ? `, --only ${only}` : ''})`); process.exit(2); }
for (const t of targets) await runTarget(t);
console.log(`\n==== RESULT: ${pass} passed, ${fail} failed ====`);
process.exit(fail ? 1 : 0);
