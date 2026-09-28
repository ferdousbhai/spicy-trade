#!/usr/bin/env node
import { doctor } from './doctor.mjs'
import { login } from './login.mjs'
import { CliFailure } from './loopback.mjs'
import { setup } from './setup.mjs'
import { connectTastytrade } from './tastytrade-connect.mjs'

/**
 * `spicy-trade`: the one command a member runs on their own machine. `setup` is the whole path
 * from nothing to a working agent; the others are its steps, for when only one needs redoing.
 */

const USAGE = `Usage: spicy-trade <command>

  setup               Sign in, install the local proxy, optionally connect tastytrade, and
                      point Claude Code and Codex at the proxy. Safe to run again: it skips
                      what is done and repairs what is not.
  login               Sign this machine in to spicy.trade from the browser.
  connect-tastytrade  Approve spicy.trade on tastytrade, so agents can trade your account.
  doctor              Check every link from agent to spicy.trade, and say how to fix each.
`

const COMMANDS = {
  'connect-tastytrade': async () => { await connectTastytrade() },
  doctor: async () => { if (!await doctor()) process.exitCode = 1 },
  login: async () => { await login() },
  setup: async () => { if (!await setup()) process.exitCode = 1 },
}

const [command, ...rest] = process.argv.slice(2)
if (command === undefined || command === '-h' || command === '--help' || command === 'help') {
  process.stdout.write(USAGE)
} else if (!Object.hasOwn(COMMANDS, command) || rest.length) {
  process.stderr.write(USAGE)
  process.exitCode = 2
} else {
  try {
    await COMMANDS[command]()
  } catch (error) {
    if (!(error instanceof CliFailure)) throw error
    process.stderr.write(`spicy-trade ${command}: ${error.message}\n`)
    process.exitCode = 1
  }
}
