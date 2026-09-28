import { spawnSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

import { cliCommand, PROXY_PATH, UNIT_NAME } from './config.mjs'
import { CliFailure } from './loopback.mjs'

/**
 * The proxy's systemd user unit: written from the template beside this file, with `ExecStart`
 * naming this install's own node and `proxy.mjs` by absolute path. That is what lets one unit
 * work from a checkout and from an npm install alike, and what `doctor` compares against to
 * notice a unit left pointing at a checkout or a node version that has since moved.
 */

const TEMPLATE_URL = new URL('./systemd/spice-agent-proxy.service', import.meta.url)

export function unitPath() {
  return join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'systemd', 'user', UNIT_NAME)
}

/**
 * One `ExecStart` word, quoted for systemd: a word with whitespace or a quote is double-quoted
 * with `\` and `"` escaped, and `%` and `$`, which systemd expands inside quotes too, are doubled.
 */
function unitWord(word) {
  const escaped = word.replaceAll('%', '%%').replaceAll('$', '$$$$')
  return /[\s"'\\]/.test(escaped) ? `"${escaped.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"` : escaped
}

export function expectedExecStart() {
  return `ExecStart=${unitWord(process.execPath)} ${unitWord(PROXY_PATH)}`
}

export async function renderUnit() {
  const template = await readFile(TEMPLATE_URL, 'utf8')
  if (!/^ExecStart=.*$/m.test(template)) throw new CliFailure('the unit template has no ExecStart line')
  return template.replace(/^ExecStart=.*$/m, expectedExecStart())
}

/** `systemctl --user` with no output; true when it exits 0, false for any failure or no systemctl. */
export function systemctl(...args) {
  return spawnSync('systemctl', ['--user', ...args], { stdio: 'ignore' }).status === 0
}

/**
 * What is installed: the unit file (undefined when there is none), whether its `ExecStart` is this
 * install's, and whether systemd has it enabled and running.
 */
export async function unitState() {
  const installed = await readFile(unitPath(), 'utf8').catch(() => undefined)
  const execStart = installed?.match(/^ExecStart=.*$/m)?.[0]
  return {
    active: systemctl('is-active', UNIT_NAME),
    current: execStart === expectedExecStart(),
    enabled: systemctl('is-enabled', UNIT_NAME),
    installed,
  }
}

/**
 * Write the unit if it differs from what this install would write, then make sure it is enabled
 * and running. `unchanged` when nothing needed doing. A unit that was already running when its
 * file changed is restarted, since `enable --now` leaves a running unit on its old command.
 */
export async function installUnit() {
  const wanted = await renderUnit()
  const before = await unitState()
  if (before.installed === wanted && before.enabled && before.active) return 'unchanged'
  if (before.installed !== wanted) {
    await mkdir(dirname(unitPath()), { recursive: true })
    await writeFile(unitPath(), wanted)
    if (!systemctl('daemon-reload')) throw new CliFailure('systemctl --user daemon-reload failed')
  }
  if (!systemctl('enable', '--now', UNIT_NAME)) throw new CliFailure(`systemctl --user enable --now ${UNIT_NAME} failed`)
  if (before.active && before.installed !== wanted && !systemctl('restart', UNIT_NAME)) {
    throw new CliFailure(`systemctl --user restart ${UNIT_NAME} failed`)
  }
  return before.installed === undefined ? 'installed' : 'updated'
}

/**
 * The proxy reads the keyring once at startup, so it has to be restarted to see a new value.
 * Writes what happened, and what to run next, to `out`.
 */
export function restartProxy(out) {
  if (!systemctl('is-enabled', UNIT_NAME)) {
    out.write(`\nThe proxy service is not installed yet. Install it with:\n  ${cliCommand('setup')}\n`)
    return
  }
  systemctl('restart', UNIT_NAME)
  out.write(systemctl('is-active', UNIT_NAME)
    ? '\nProxy restarted.\n'
    : `\nThe proxy failed to restart. Find out why with:\n  ${cliCommand('doctor')}\n`)
}
