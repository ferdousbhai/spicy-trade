#!/usr/bin/env node
import { CliFailure } from './loopback.mjs'
import { connectTastytrade } from './tastytrade-connect.mjs'

/**
 * The standalone entry the Connect tab has always named; `spice-agent connect-tastytrade` runs
 * the same thing. The work is in `tastytrade-connect.mjs`, which `spice-agent setup` imports.
 */
try {
  await connectTastytrade()
} catch (error) {
  if (!(error instanceof CliFailure)) throw error
  process.stderr.write(`SpiceConnectTastytrade: ${error.message}\n`)
  process.exit(1)
}
