import { spawn } from 'node:child_process'
import { timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:http'

import { LISTEN_HOST } from './config.mjs'

/**
 * The browser round trip both sign-ins share: `spicy-trade login` (spicy.trade approves this
 * machine) and `connect-tastytrade` (tastytrade approves spicy.trade). The member approves in a
 * browser, and the browser is sent back to a one-shot listener here on the loopback address with
 * a code and the state this run chose or was given.
 */

const CALLBACK_PATH = '/callback'

// The codes RFC 6749 §4.1.2.1 defines for a refused authorization. Anything else a return
// carries is reported without its text, since the text is not ours.
const OAUTH_ERRORS = new Set([
  'access_denied', 'invalid_request', 'invalid_scope', 'server_error', 'temporarily_unavailable',
  'unauthorized_client', 'unsupported_response_type',
])

/** A command-line failure: its message is printed after the program's name, and the run exits 1. */
export class CliFailure extends Error {
  constructor(message) {
    super(message)
    this.name = 'CliFailure'
  }
}

/** Constant-time equality for two strings, so a probe cannot learn the state a byte at a time. */
function sameState(presented, expected) {
  const left = Buffer.from(presented ?? '')
  const right = Buffer.from(expected)
  return left.length === right.length && timingSafeEqual(left, right)
}

function page(response, status, text) {
  response.writeHead(status, {
    'cache-control': 'no-store',
    // One return is all this listener serves, so no browser connection is kept open past it.
    connection: 'close',
    'content-type': 'text/plain; charset=utf-8',
    'referrer-policy': 'no-referrer',
  })
  response.end(`${text}\n`)
}

/**
 * Listen on an ephemeral loopback port and resolve with the port and a promise of the browser's
 * return: `{ code }` or `{ error }`. `expectedState` is set once it is known -- chosen here for a
 * login, issued by the Worker for a broker connection. `pages` is what the browser tab reads:
 * `{ forbidden, received, refused }`. `program` prefixes the one line a mismatched return logs.
 */
export async function loopbackListener(program, pages) {
  let expectedState
  let settle
  const returned = new Promise((resolve) => { settle = resolve })
  let port
  const server = createServer((request, response) => {
    // DNS rebinding, as in the proxy: a page can resolve its own name to 127.0.0.1 and reach this
    // port from the browser. The real return is a top-level navigation to this address, which
    // names it as Host and carries no Origin.
    const allowedHosts = new Set([`${LISTEN_HOST}:${port}`, `localhost:${port}`])
    if (!allowedHosts.has(request.headers.host ?? '') || request.headers.origin !== undefined) {
      request.resume()
      page(response, 403, pages.forbidden)
      return
    }
    const url = new URL(request.url ?? '/', `http://${LISTEN_HOST}:${port}`)
    if (request.method !== 'GET' || url.pathname !== CALLBACK_PATH || !expectedState) {
      page(response, 404, 'Not found.')
      return
    }
    if (!sameState(url.searchParams.get('state'), expectedState)) {
      // Not this run's return. Refused, and the real one can still arrive.
      process.stderr.write(`${program}: ignored a return whose state did not match this run\n`)
      page(response, 400, 'This return does not belong to the sign-in in progress.')
      return
    }
    const error = url.searchParams.get('error')
    const code = url.searchParams.get('code')
    if (error || !code) {
      page(response, 200, pages.refused)
      settle({ error: error && OAUTH_ERRORS.has(error) ? error : 'unrecognized' })
      return
    }
    page(response, 200, pages.received)
    settle({ code })
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, LISTEN_HOST, resolve)
  })
  port = server.address().port
  return {
    close: () => {
      server.close()
      server.closeAllConnections()
    },
    expect: (state) => { expectedState = state },
    port,
    returned,
  }
}

/**
 * Wait for the browser's return, but no longer than `waitMs`; resolves `{ lapsed: true }` then.
 * The listener is closed either way.
 */
export async function awaitReturn(listener, waitMs) {
  let timer
  const lapsed = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ lapsed: true }), Math.max(0, waitMs))
  })
  try {
    return await Promise.race([listener.returned, lapsed])
  } finally {
    clearTimeout(timer)
    listener.close()
  }
}

/** Best effort: the printed URL is the path, so failing to open a browser is not a failure. */
export function openBrowser(url) {
  const opener = process.platform === 'darwin' ? 'open' : 'xdg-open'
  try {
    const child = spawn(opener, [url], { detached: true, stdio: 'ignore' })
    child.on('error', () => {})
    child.unref()
  } catch {
    // The URL is already on screen.
  }
}
