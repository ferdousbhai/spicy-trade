import { createHash, randomBytes } from 'node:crypto'
import { hostname } from 'node:os'
import { z } from 'zod'

import { AGENT_TOKEN_SERVICE, cliCommand, MCP_TOKEN_KEY, ORIGIN } from './config.mjs'
import { agentToken, storeAgentToken } from './keyring.mjs'
import { awaitReturn, CliFailure, loopbackListener, openBrowser } from './loopback.mjs'
import { restartProxy } from './systemd.mjs'
import { UPSTREAM_TIMEOUT_MS } from './token-refresh.mjs'

/**
 * `spicy-trade login`: sign this machine in to spicy.trade from a browser, and keep the agent
 * token it is issued in the OS keyring, where the proxy reads it.
 *
 * The member approves on spicy.trade's `/connect/agent` page, already signed in there; the page
 * sends the browser back to a listener here with a one-time code; this process redeems the code
 * for the token. The token itself never rides in a URL or the browser's history -- only the code
 * does, and the code is bound to a verifier that never leaves this process (PKCE, RFC 7636, with
 * S256), so a code read out of an address bar or a log is worth nothing. The state guards the
 * listener: a return this run did not start is refused.
 *
 * Output is fixed vocabulary. No token, code, verifier or state is printed; the approval URL is,
 * because following it is the whole point, and nothing in it grants anything on its own.
 */

const PROGRAM = 'SpicyTradeLogin'

/**
 * 32 random bytes, as the Worker's contract (`AGENT_LOGIN_RANDOM_BYTES` in
 * `src/domain/agent-login.ts`) expects of the state and the verifier.
 */
const RANDOM_BYTES = 32

/**
 * How long to wait for the member to approve. It covers signing in to spicy.trade with Google
 * first, the slowest thing a member does on that page, and matches how long a started tastytrade
 * connection stays redeemable (`BROKER_AUTHORIZATION_TTL_MS`). A product judgment.
 */
const APPROVAL_WAIT_MS = 10 * 60_000

/**
 * The label the Connect tab lists this machine's token under. The Worker bounds a label at
 * `MAX_MCP_TOKEN_LABEL_LENGTH` (`src/domain/mcp-tokens.ts`); this is that number, since this
 * package cannot import the Worker's source.
 */
const MAX_LABEL_LENGTH = 60
const FALLBACK_LABEL = 'This computer'

const ExchangeResponseSchema = z.object({ token: z.string().min(1) })

function machineLabel() {
  return hostname().trim().slice(0, MAX_LABEL_LENGTH).trim() || FALLBACK_LABEL
}

/**
 * Redeem the code. One Worker call, so it gets the same budget as one forwarded MCP call. A
 * refusal is described by its status in this CLI's own words, never the answer's body.
 */
async function exchange(code, codeVerifier, previousToken) {
  const body = { code, codeVerifier }
  if (previousToken) body.previousToken = previousToken
  let response
  try {
    response = await fetch(new URL('/api/agent-logins/exchange', ORIGIN), {
      body: JSON.stringify(body),
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      method: 'POST',
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    })
  } catch (error) {
    throw new CliFailure(`spicy.trade could not be reached (${error instanceof Error ? error.name : 'UnknownError'})`)
  }
  const payload = await response.json().catch(() => undefined)
  if (response.status === 400) {
    throw new CliFailure(`the sign-in expired or was already used; run login again:\n  ${cliCommand('login')}`)
  }
  if (response.status === 409) {
    throw new CliFailure('your account already holds as many agent tokens as it may. Revoke one you no longer\n'
      + `use under "Headless access" in the Connect tab (${ORIGIN}/connect), then run this again.`)
  }
  if (!response.ok) throw new CliFailure(`spicy.trade refused the sign-in (HTTP ${response.status})`)
  const parsed = ExchangeResponseSchema.safeParse(payload)
  if (!parsed.success) throw new CliFailure('spicy.trade answered the sign-in with an unreadable response')
  return parsed.data.token
}

/**
 * Sign in, store the token, and restart the proxy so it uses it. Progress goes to `out`.
 * `restartProxy: false` is for `setup`, which installs or restarts the proxy itself next.
 */
export async function login(out = process.stdout, options = { restartProxy: true }) {
  // The token this machine held before, if any, goes with the exchange so the Worker can retire
  // it: signing in again replaces this machine's token instead of adding a second one.
  const previousToken = await agentToken(PROGRAM)
  const state = randomBytes(RANDOM_BYTES).toString('base64url')
  const codeVerifier = randomBytes(RANDOM_BYTES).toString('base64url')
  const challenge = createHash('sha256').update(codeVerifier).digest('base64url')

  const listener = await loopbackListener(PROGRAM, {
    forbidden: 'This listener only answers the spicy.trade sign-in.',
    received: 'This computer is signed in to spicy.trade. You can close this tab and return to the terminal.',
    refused: 'spicy.trade did not approve this computer. You can close this tab.',
  })
  listener.expect(state)
  const approval = new URL('/connect/agent', ORIGIN)
  approval.search = new URLSearchParams({
    challenge,
    label: machineLabel(),
    port: String(listener.port),
    state,
  }).toString()

  out.write(`Sign in to spicy.trade and approve this computer:\n\n  ${approval}\n\n`)
  openBrowser(approval.toString())

  const outcome = await awaitReturn(listener, APPROVAL_WAIT_MS)
  if (outcome.lapsed) throw new CliFailure('the sign-in was not approved in time; run this again')
  if (outcome.error) throw new CliFailure(`spicy.trade did not approve this computer (${outcome.error})`)

  const token = await exchange(outcome.code, codeVerifier, previousToken)
  if (!await storeAgentToken(PROGRAM, token)) throw new CliFailure(`failed to store ${AGENT_TOKEN_SERVICE}/${MCP_TOKEN_KEY}`)
  out.write(`Signed in. Stored ${AGENT_TOKEN_SERVICE}/${MCP_TOKEN_KEY}.\n`)
  if (options.restartProxy) restartProxy(out)
}
