import { createFileRoute } from '@tanstack/react-router'

import { exchangeAgentLogin } from '../server/agent-logins'
import { appEnv } from '../server/worker-env'

/**
 * The CLI redeeming an approved sign-in for its agent token. Unauthenticated by necessity -- the
 * CLI has no credential yet -- and bound instead by the verifier (see `exchangeAgentLogin`).
 */
export const Route = createFileRoute('/api/agent-logins/exchange')({
  server: {
    handlers: {
      POST: ({ request }) => exchangeAgentLogin(request, appEnv),
    },
  },
})
