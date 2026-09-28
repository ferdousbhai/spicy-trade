import { spawnSync } from 'node:child_process'
import { homedir } from 'node:os'
import { z } from 'zod'

import { MCP_SERVER_NAME, ORIGIN, PROXY_URL } from './config.mjs'

/**
 * The agent clients `setup` can point at the proxy, through each client's own CLI rather than by
 * editing its config file, whose format is the client's to change.
 *
 * Every client is added at user scope, so the proxy is there in any directory. The commands run
 * from the home directory: a project's own `.mcp.json` would otherwise answer for the server's name in
 * whatever directory `setup` happened to be run from.
 *
 * Nothing here carries a credential: the proxy URL is the whole configuration, which is the point
 * of the proxy.
 */

/**
 * Both CLIs connect to the server before `get` prints anything, to report its status. That can
 * take as long as the proxy's own first call, so the budget is the proxy's for one forwarded
 * call, plus the same again for the client to start.
 */
const CLIENT_COMMAND_TIMEOUT_MS = 2 * 60_000

const CodexServerSchema = z.object({ transport: z.object({ url: z.string().optional() }) })

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: homedir(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: CLIENT_COMMAND_TIMEOUT_MS,
  })
  if (result.error?.code === 'ENOENT') return { absent: true }
  // A timeout or a signal is not an answer: neither "configured" nor "not configured".
  if (result.error || result.signal) return { failed: true }
  return { ok: result.status === 0, stdout: result.stdout ?? '' }
}

/**
 * What a client has under one entry name: `uninstalled` (no such CLI), `failed` (the CLI did not answer),
 * `missing`, or `configured` with the URL it names -- empty when the entry is not a URL at all.
 */
function lookup(got, urlOf) {
  if (got.absent) return { state: 'uninstalled' }
  if (got.failed) return { state: 'failed' }
  if (!got.ok) return { state: 'missing' }
  return { state: 'configured', url: urlOf(got.stdout) }
}

/** Whether an entry's URL is this proxy or spicy.trade itself, so the entry is ours to replace. */
export function namesSpicyTrade(url) {
  return url === PROXY_URL || url.startsWith(`${ORIGIN}/`)
}

/**
 * Each client, with its lookup and removal taking the entry name: `setup` asks about both the
 * current name and the one an install from before the rename added (see `config.mjs`), and
 * replaces the old entry once the current one is in place. Only the current name is ever added.
 */
export const CLIENTS = [
  {
    add: () => run('claude', ['mcp', 'add', '--scope', 'user', '--transport', 'http', MCP_SERVER_NAME, PROXY_URL]),
    addCommand: `claude mcp add --scope user --transport http ${MCP_SERVER_NAME} ${PROXY_URL}`,
    name: 'Claude Code',
    configured: (entry = MCP_SERVER_NAME) => lookup(
      run('claude', ['mcp', 'get', entry]),
      (stdout) => stdout.match(/^\s*URL:\s*(\S+)\s*$/m)?.[1] ?? '',
    ),
    // Without a scope, Claude Code removes the entry from whichever scope holds it.
    remove: (entry = MCP_SERVER_NAME) => run('claude', ['mcp', 'remove', entry]),
    removeCommand: (entry = MCP_SERVER_NAME) => `claude mcp remove ${entry}`,
  },
  {
    add: () => run('codex', ['mcp', 'add', MCP_SERVER_NAME, '--url', PROXY_URL]),
    addCommand: `codex mcp add ${MCP_SERVER_NAME} --url ${PROXY_URL}`,
    name: 'Codex',
    configured: (entry = MCP_SERVER_NAME) => lookup(run('codex', ['mcp', 'get', entry, '--json']), (stdout) => {
      try {
        return CodexServerSchema.parse(JSON.parse(stdout)).transport.url ?? ''
      } catch {
        return ''
      }
    }),
    remove: (entry = MCP_SERVER_NAME) => run('codex', ['mcp', 'remove', entry]),
    removeCommand: (entry = MCP_SERVER_NAME) => `codex mcp remove ${entry}`,
  },
]
