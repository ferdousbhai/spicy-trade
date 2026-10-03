import { cloudflare } from '@cloudflare/vite-plugin'
import { defineConfig } from 'vite'

// The packages resolve from the repository root's node_modules; this folder declares them only
// so `cf` can tell which build it is.
export default defineConfig({ plugins: [cloudflare()] })
