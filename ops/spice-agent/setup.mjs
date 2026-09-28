import { createInterface } from 'node:readline/promises'

import { CLIENTS } from './clients.mjs'
import { cliCommand, MCP_SERVER_NAME, MCP_TOKEN_KEY, PROXY_URL, SPICE_SERVICE } from './config.mjs'
import { doctor } from './doctor.mjs'
import { keyringSecret, secretToolInstalled, tastytradeCredentialKind } from './keyring.mjs'
import { login } from './login.mjs'
import { CliFailure } from './loopback.mjs'
import { installUnit, restartProxy, systemctl } from './systemd.mjs'
import { connectTastytrade } from './tastytrade-connect.mjs'
import { checkAgentToken, describeTokenCheck } from './worker.mjs'

/**
 * `spice-agent setup`: everything between a fresh machine and an agent that can reach
 * spicy.trade, in one run. Each step looks before it acts and skips what is already done, so
 * running it again is also how a broken setup is repaired; `doctor` closes the run by checking
 * the result end to end.
 *
 * Only the tastytrade connection is asked about rather than done: it hands trading authority to
 * any agent on this machine, which is the member's call to make, and a run without a terminal to
 * ask on leaves it undone and says how to do it later.
 */

const PROGRAM = 'SpiceAgentSetup'

function step(out, title) {
  out.write(`\n== ${title}\n`)
}

async function confirm(question) {
  const prompt = createInterface({ input: process.stdin, output: process.stdout })
  try {
    return /^y(es)?$/i.test((await prompt.question(question)).trim())
  } finally {
    prompt.close()
  }
}

/** Runs every step, writing progress to `out`; resolves true when the closing doctor passes. */
export async function setup(out = process.stdout) {
  if (process.platform !== 'linux') {
    throw new CliFailure(`setup needs Linux, with a systemd user session and secret-tool; this is ${process.platform}`)
  }
  if (!await secretToolInstalled()) {
    throw new CliFailure('secret-tool is not installed. Install libsecret (it provides secret-tool), then run this again.')
  }
  if (!systemctl('show-environment')) {
    throw new CliFailure('no systemd user session answered (systemctl --user). Run this from your own login session.')
  }

  // A proxy that was already running keeps whatever credentials it read when it started.
  let credentialsChanged = false

  step(out, 'spicy.trade sign-in')
  const token = await keyringSecret(PROGRAM, SPICE_SERVICE, MCP_TOKEN_KEY)
  const check = token ? await checkAgentToken(token) : undefined
  if (check?.status === 'accepted') {
    out.write('✓ already signed in; skipped\n')
  } else if (check?.status === 'unanswered' || check?.status === 'unreachable') {
    throw new CliFailure(`${describeTokenCheck(check)}. Run this again once spicy.trade answers.`)
  } else {
    if (check?.status === 'rejected') out.write('The stored agent token was rejected; signing in again.\n')
    await login(out, { restartProxy: false })
    credentialsChanged = true
  }

  step(out, 'proxy service')
  const installed = await installUnit()
  if (installed === 'unchanged') {
    out.write('✓ already installed and running; skipped\n')
    if (credentialsChanged) restartProxy(out)
  } else {
    out.write(installed === 'installed' ? `✓ installed and started at ${PROXY_URL}\n` : `✓ updated and restarted at ${PROXY_URL}\n`)
  }

  step(out, 'tastytrade')
  const { kind } = await tastytradeCredentialKind(PROGRAM)
  if (kind === 'app' || kind === 'personal') {
    out.write('✓ already connected; skipped\n')
  } else if (kind === 'ambiguous') {
    out.write('✗ both an app grant and a personal grant are stored; the check below says which to remove\n')
  } else if (!process.stdin.isTTY) {
    out.write(`· not connected, and there is no terminal to ask on. Connect later with:\n    ${cliCommand('connect-tastytrade')}\n`)
  } else if (await confirm('Connect tastytrade now, so agents on this machine can trade your account? [y/N] ')) {
    try {
      await connectTastytrade(out)
    } catch (error) {
      if (!(error instanceof CliFailure)) throw error
      out.write(`✗ ${error.message}\n    Try again later with: ${cliCommand('connect-tastytrade')}\n`)
    }
  } else {
    out.write(`· skipped; agents get market and research tools only. Connect later with:\n    ${cliCommand('connect-tastytrade')}\n`)
  }

  step(out, 'agent clients')
  let clientsFound = 0
  for (const client of CLIENTS) {
    const configured = client.configured()
    if (configured.state === 'uninstalled') continue
    clientsFound += 1
    if (configured.state === 'failed') {
      out.write(`✗ ${client.name} did not answer; add it yourself with:\n    ${client.addCommand}\n`)
    } else if (configured.state === 'configured' && configured.url === PROXY_URL) {
      out.write(`✓ ${client.name} already points at the proxy; skipped\n`)
    } else if (configured.state === 'configured') {
      // Someone chose that entry; replacing it is theirs to decide.
      out.write(`! ${client.name} already has a ${MCP_SERVER_NAME} server pointing elsewhere; left as it is. To replace it:\n`
        + `    ${client.removeCommand} && ${client.addCommand}\n`)
    } else if (client.add().ok) {
      out.write(`✓ ${client.name}: added ${MCP_SERVER_NAME} at ${PROXY_URL}\n`)
    } else {
      out.write(`✗ ${client.name} refused to add the server; add it yourself with:\n    ${client.addCommand}\n`)
    }
  }
  if (!clientsFound) {
    out.write(`· no Claude Code or Codex found. Point any MCP client at ${PROXY_URL} (streamable HTTP, no credentials).\n`)
  }

  step(out, 'check')
  const healthy = await doctor(out)
  if (healthy) out.write('\nAn agent that was already running needs to reconnect: in Claude Code, /mcp.\n')
  return healthy
}
