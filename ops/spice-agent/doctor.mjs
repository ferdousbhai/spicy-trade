import { z } from 'zod'

import { grantMinter, TastytradeAuthError } from './broker-grants.mjs'
import { CLIENTS } from './clients.mjs'
import {
  cliCommand, MCP_SERVER_NAME, MCP_TOKEN_KEY, ORIGIN, PROXY_URL, SPICE_SERVICE, storeCredentialsCommand, UNIT_NAME,
} from './config.mjs'
import {
  APP_REFRESH_TOKEN_KEY, keyringSecret, secretToolInstalled, TASTYTRADE, tastytradeCredentialKind,
} from './keyring.mjs'
import { unitState } from './systemd.mjs'
import { TOKEN_REQUEST_TIMEOUT_MS, UPSTREAM_TIMEOUT_MS } from './token-refresh.mjs'
import { checkAgentToken, describeTokenCheck } from './worker.mjs'

/**
 * `spice-agent doctor`: every link between an agent and spicy.trade, checked in the order a
 * request crosses them, each failure with the one command that fixes it.
 *
 * Output is fixed vocabulary, as everywhere in these tools: a status, a transport code, a path of
 * this install, or a message the proxy itself wrote from its own vocabulary. No credential is
 * printed, and the proxy's answer is read only for its JSON-RPC error message.
 */

const PROGRAM = 'SpiceAgentDoctor'

/**
 * The proxy's worst case for one call that also mints a broker token: a mint's budget, then the
 * forwarded call's (see the note beside `UPSTREAM_TIMEOUT_MS` in `proxy.mjs`).
 */
const PROXY_CHECK_TIMEOUT_MS = UPSTREAM_TIMEOUT_MS + TOKEN_REQUEST_TIMEOUT_MS

/** The MCP revision this probe speaks; any revision the Worker accepts would do for a liveness check. */
const MCP_PROTOCOL_VERSION = '2025-06-18'

const ProxyFailureSchema = z.object({ error: z.object({ message: z.string() }) })

function report(out) {
  let failed = 0
  return {
    fail: (label, fix) => {
      failed += 1
      out.write(`✗ ${label}\n    ${fix}\n`)
    },
    get failed() { return failed },
    note: (label, hint) => out.write(`· ${label}${hint ? `\n    ${hint}` : ''}\n`),
    pass: (label) => out.write(`✓ ${label}\n`),
  }
}

function brokerFailure(error, kind) {
  if (!(error instanceof TastytradeAuthError)) return 'the grant could not be minted'
  if (error.code === 'spice-401') return 'spicy.trade rejected the agent token while minting'
  if (error.code === 'unreachable') return `${error.party} could not be reached${error.transport ? ` (${error.transport})` : ''}`
  if (Number.isInteger(error.code)) return `tastytrade refused the ${kind === 'app' ? 'connection' : 'personal grant'} (HTTP ${error.code})`
  return `the mint failed (${String(error.code)})`
}

async function checkProxy() {
  let response
  try {
    response = await fetch(PROXY_URL, {
      body: JSON.stringify({
        id: 1,
        jsonrpc: '2.0',
        method: 'initialize',
        params: { capabilities: {}, clientInfo: { name: 'spice-agent-doctor', version: '1' }, protocolVersion: MCP_PROTOCOL_VERSION },
      }),
      headers: { Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json' },
      method: 'POST',
      signal: AbortSignal.timeout(PROXY_CHECK_TIMEOUT_MS),
    })
  } catch (error) {
    const code = error instanceof Error && error.cause instanceof Error && 'code' in error.cause
      ? String(error.cause.code)
      : error instanceof Error ? error.name : 'UnknownError'
    return { reason: `nothing answered (${code})` }
  }
  if (response.ok) {
    await response.body?.cancel()
    return { ok: true }
  }
  // The proxy's own failure carries a JSON-RPC error in its own words; anything else is the
  // Worker's answer relayed, and only its status is shown.
  const failure = ProxyFailureSchema.safeParse(await response.json().catch(() => undefined))
  return { reason: failure.success ? failure.data.error.message : `it answered HTTP ${response.status}` }
}

/** Runs every check, writing one line each to `out`; resolves true when none failed. */
export async function doctor(out = process.stdout) {
  const checks = report(out)
  const setup = cliCommand('setup')

  if (!await secretToolInstalled()) {
    checks.fail('secret-tool is not installed', 'Install libsecret (it provides secret-tool), then run: ' + setup)
    return false
  }
  checks.pass('secret-tool is installed')

  const token = await keyringSecret(PROGRAM, SPICE_SERVICE, MCP_TOKEN_KEY)
  if (!token) {
    checks.fail(`no agent token in the keyring (${SPICE_SERVICE}/${MCP_TOKEN_KEY})`, `Sign in with: ${cliCommand('login')}`)
  } else {
    const check = await checkAgentToken(token)
    if (check.status === 'accepted') checks.pass(describeTokenCheck(check))
    else if (check.status === 'rejected') checks.fail(describeTokenCheck(check), `Sign in again with: ${cliCommand('login')}`)
    else checks.fail(describeTokenCheck(check), `Check the network and ${ORIGIN}, then run this again.`)
  }

  const credential = await tastytradeCredentialKind(PROGRAM)
  if (credential.kind === 'none') {
    checks.note('no brokerage connected: agents get market and research tools only',
      `To trade from an agent: ${cliCommand('connect-tastytrade')}`)
  } else if (credential.kind === 'ambiguous') {
    checks.fail('the keyring holds both a tastytrade app grant and a personal grant, so the proxy will not start',
      `Keep one. To keep the personal grant: secret-tool clear service ${TASTYTRADE} key ${APP_REFRESH_TOKEN_KEY}`)
  } else if (credential.kind === 'app' && !token) {
    checks.fail('tastytrade is connected through spicy.trade, which needs the agent token to mint', `Sign in with: ${cliCommand('login')}`)
  } else {
    const described = credential.kind === 'app' ? 'tastytrade connection' : 'tastytrade personal grant'
    try {
      await grantMinter(token, credential)()
      checks.pass(`${described} mints an access token`)
    } catch (error) {
      // A refused agent token fails the app-grant mint too; signing in again fixes both.
      checks.fail(`${described}: ${brokerFailure(error, credential.kind)}`,
        error instanceof TastytradeAuthError && error.code === 'spice-401'
          ? `Sign in again with: ${cliCommand('login')}`
          : credential.kind === 'app'
            ? `Reconnect with: ${cliCommand('connect-tastytrade')}`
            : `Store a new grant from my.tastytrade.com with: ${storeCredentialsCommand('tastytrade')}`)
    }
  }

  const unit = await unitState()
  if (unit.installed === undefined) {
    checks.fail('the proxy service is not installed', `Install it with: ${setup}`)
  } else if (!unit.current) {
    checks.fail('the proxy service runs a different install of the proxy, or a node that has moved', `Rewrite it with: ${setup}`)
  } else if (!unit.enabled || !unit.active) {
    checks.fail(`the proxy service is ${unit.enabled ? 'enabled' : 'not enabled'} and ${unit.active ? 'running' : 'not running'}`,
      `Start it with: ${setup}  (its log: journalctl --user -u ${UNIT_NAME} -n 20)`)
  } else {
    checks.pass('the proxy service is installed, enabled and running')
  }

  const proxy = await checkProxy()
  if (proxy.ok) checks.pass(`the proxy answers at ${PROXY_URL}`)
  else checks.fail(`the proxy at ${PROXY_URL} did not complete a request: ${proxy.reason}`, `Its log: journalctl --user -u ${UNIT_NAME} -n 20`)

  for (const client of CLIENTS) {
    const configured = client.configured()
    if (configured.state === 'uninstalled') continue
    if (configured.state === 'failed') {
      checks.fail(`${client.name} did not answer when asked for its ${MCP_SERVER_NAME} server`, 'Run this again once it responds.')
    } else if (configured.state === 'missing') {
      checks.fail(`${client.name} has no ${MCP_SERVER_NAME} server`, `Add it with: ${setup}`)
    } else if (configured.url !== PROXY_URL) {
      // The configured address is not printed: a client entry may carry a credential in its URL.
      checks.fail(`${client.name} points ${MCP_SERVER_NAME} somewhere other than the proxy`,
        `Replace it: ${client.removeCommand} && ${client.addCommand}`)
    } else {
      checks.pass(`${client.name} points at the proxy`)
    }
  }

  out.write(checks.failed ? `\n${checks.failed} problem${checks.failed === 1 ? '' : 's'} found.\n` : '\nEverything is connected.\n')
  return checks.failed === 0
}
