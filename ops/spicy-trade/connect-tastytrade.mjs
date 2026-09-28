#!/usr/bin/env node
import { CliFailure } from './loopback.mjs'
import { connectTastytrade } from './tastytrade-connect.mjs'

/**
 * The standalone entry the Connect tab has always named; `spicy-trade connect-tastytrade` runs
 * the same thing. The work is in `tastytrade-connect.mjs`, which `spicy-trade setup` imports.
 */
try {
  await connectTastytrade()
} catch (error) {
  if (!(error instanceof CliFailure)) throw error
  process.stderr.write(`SpicyTradeConnectTastytrade: ${error.message}\n`)
  process.exit(1)
}
