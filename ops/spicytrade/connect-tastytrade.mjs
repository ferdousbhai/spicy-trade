#!/usr/bin/env node
import { CliFailure } from './loopback.mjs'
import { connectTastytrade } from './tastytrade-connect.mjs'

/**
 * The standalone entry the Connect tab has always named; `spicytrade connect-tastytrade` runs
 * the same thing. The work is in `tastytrade-connect.mjs`, which `spicytrade setup` imports.
 */
try {
  await connectTastytrade()
} catch (error) {
  if (!(error instanceof CliFailure)) throw error
  process.stderr.write(`SpicytradeConnectTastytrade: ${error.message}\n`)
  process.exit(1)
}
