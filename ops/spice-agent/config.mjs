import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

/**
 * What every local tool agrees on: where spicy.trade is, where the proxy listens, which keyring
 * entry holds the agent token, and how to name the CLI in a message. One module, so the proxy,
 * `spice-agent`, and `connect-tastytrade.mjs` cannot drift apart on any of them.
 *
 * Importing this starts nothing, unlike `proxy.mjs`.
 */

/** The Worker's MCP endpoint; every other Worker path is resolved against its origin. */
export const UPSTREAM = process.env.SPICE_MCP_URL ?? 'https://spicy.trade/mcp'
export const ORIGIN = new URL(UPSTREAM).origin
export const TASTYTRADE_API_BASE = process.env.TASTYTRADE_API_BASE ?? 'https://api.tastyworks.com'

/**
 * Loopback only, and a fixed default port because every agent's MCP config names it: an
 * ephemeral port would have to be rewritten into each client on every start.
 */
export const LISTEN_HOST = '127.0.0.1'
export const DEFAULT_PORT = 8787
export const PROXY_PORT = Number(process.env.SPICE_AGENT_PORT ?? DEFAULT_PORT)
export const PROXY_URL = `http://${LISTEN_HOST}:${PROXY_PORT}/mcp`

/** The agent token is spicy.trade's credential, so it is filed under spicy.trade's service. */
export const SPICE_SERVICE = 'spice'
export const MCP_TOKEN_KEY = 'mcp-token'

/** The name agents' MCP configs know the server by. */
export const MCP_SERVER_NAME = 'spice'
export const UNIT_NAME = 'spice-agent-proxy.service'

export const PROXY_PATH = fileURLToPath(new URL('./proxy.mjs', import.meta.url))
export const CLI_PATH = fileURLToPath(new URL('./spice-agent.mjs', import.meta.url))
export const STORE_CREDENTIALS_PATH = fileURLToPath(new URL('./store-credentials.sh', import.meta.url))

/**
 * How a message tells the member to run the CLI. An npm install puts `spice-agent` on PATH; a
 * checkout does not, so there the message names the script itself, by a path that works from
 * any directory -- the proxy's own working directory under systemd is `/`, so a
 * checkout-relative path would be wrong exactly where these messages are read.
 */
function homeRelative(path) {
  const home = homedir()
  return path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path
}
const CLI_NAME = CLI_PATH.includes('/node_modules/') ? 'spice-agent' : homeRelative(CLI_PATH)

export function cliCommand(subcommand) {
  return `${CLI_NAME} ${subcommand}`
}

export function storeCredentialsCommand(argument) {
  return `${homeRelative(STORE_CREDENTIALS_PATH)} ${argument}`
}
