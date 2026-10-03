import { bindings, defineConfig } from 'cf/config'

const SECRETS_STORE_ID = 'a436a6cefedc4acd8bb920cdbc202c1c'

// Each run deploys this under its own name (`ops/shared/temporary-worker.sh` sets it), so two
// runs never share a Worker, and deletes it when the run ends.
const name = process.env.SPICE_OPS_WORKER_NAME
if (!name) throw new Error('SPICE_OPS_WORKER_NAME is not set; run this through ops/instrument-catalog/run.sh.')

export default defineConfig({
  worker: {
    name,
    compatibilityDate: '2026-08-18',
    compatibilityFlags: ['nodejs_compat'],
    entrypoint: './worker.ts',
    workersDev: true,
    env: {
      // Temporary broker reads share the production account throttle instead of creating an
      // isolated coordinator namespace for each run. `worker` is the production Worker's name
      // (see the root cloudflare.config.ts).
      BROKER_GATE: bindings.durableObject({ worker: 'spicytrade', exportName: 'BrokerGate' }),
      TASTYTRADE_CLIENT_SECRET: bindings.secretsStoreSecret({
        storeId: SECRETS_STORE_ID,
        secretName: 'tastytrade-client-secret',
      }),
      TASTYTRADE_REFRESH_TOKEN: bindings.secretsStoreSecret({
        storeId: SECRETS_STORE_ID,
        secretName: 'tastytrade-refresh-token',
      }),
      DB: bindings.d1({ name: 'spice-production', id: 'e45e35cc-bd01-4e29-8940-b5d2ef5e840c' }),
      TASTYTRADE_API_BASE: bindings.text('https://api.tastyworks.com'),
    },
  },
})
