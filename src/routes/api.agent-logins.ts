import { createFileRoute } from '@tanstack/react-router'

import { approveAgentLogin } from '../server/agent-logins'
import { appEnv } from '../server/worker-env'

/**
 * The member's approval of a terminal sign-in, posted by `/connect/agent`. Authenticated by the
 * session cookie and same-origin only: approving is what the page's button does, never a link.
 */
export const Route = createFileRoute('/api/agent-logins')({
  server: {
    handlers: {
      POST: ({ request }) => approveAgentLogin(request, appEnv),
    },
  },
})
