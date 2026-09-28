#!/usr/bin/env bash
# Store the credentials the local proxy needs, in the OS keyring.
#
# `secret-tool store` prompts for the value itself and reads it from the terminal, so nothing
# here reaches your shell history, the process argument list, or any file. That is the whole
# reason the proxy reads the keyring rather than an env file: a value in the environment is
# readable by any tool the agent can run, and a tastytrade refresh token never expires.
set -euo pipefail

# SPICE_MCP_URL is the pre-rename name, still read so an old environment keeps working.
mcp_url=${SPICY_TRADE_MCP_URL:-${SPICE_MCP_URL:-https://spicy.trade/mcp}}
agent_cli="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/spicy-trade.mjs"
# The agent token's keyring service, and the one an install from before the rename used (see
# config.mjs); the proxy prefers the current one, so a token stored here replaces the old entry.
token_service=spicy-trade
legacy_token_service=spice
unit=spicy-trade-proxy.service

usage() {
  cat <<'EOF'
Usage: store-credentials.sh [mcp-token|tastytrade]

The easy path is one command, which signs in from the browser with nothing to paste:

  spicy-trade setup     (from a checkout: ./ops/spicy-trade/spicy-trade.mjs setup)

This script is for pasting a credential by hand instead:

  mcp-token   A spicy.trade agent token, created under "Headless access" in the
              web app's Connect tab (default). It is checked against spicy.trade
              before it is kept.
  tastytrade  A personal grant instead of spicy.trade's tastytrade app: the client
              secret and refresh token from my.tastytrade.com > OAuth
              Applications > Manage > Create Grant. The read and trade scopes
              need two-factor auth on your account.

Each value is prompted for; nothing is passed on the command line.

Keep one kind of tastytrade credential: the proxy refuses to start with both.
EOF
}

# Filed under the service that issued the credential, not the app that spends it, so a second
# broker becomes its own service rather than more keys under spicy.trade's. The label is only what
# Seahorse displays; the service and key attributes are what the proxy looks up.
store() {
  local service=$1 key=$2 label=$3 prompt=$4
  printf '\n%s\n' "${prompt}"
  secret-tool store --label="${label}" service "${service}" key "${key}"
  if [[ -z $(secret-tool lookup service "${service}" key "${key}" 2>/dev/null) ]]; then
    echo "  failed to store ${service}/${key}" >&2
    exit 1
  fi
  echo "  stored ${service}/${key}"
}

# The spicy.trade agent token is checked the way an agent would use it -- a tools/list on the MCP
# endpoint -- so a token that would only fail later, inside the proxy, is refused here instead.
# The token reaches curl on stdin, as a config line, never as an argument other processes can
# read. A 401 clears the entry: a token spicy.trade rejects is worth nothing kept. No answer at
# all keeps it, since that says nothing about the token, and says to check again later. The
# timeout is the proxy's budget for one forwarded call (UPSTREAM_TIMEOUT_MS), which this is.
check_mcp_token() {
  if ! command -v curl >/dev/null; then
    echo '  curl is not installed, so the token was stored unchecked.' >&2
    return
  fi
  local status
  status=$(printf 'header = "Authorization: Bearer %s"\n' "$(secret-tool lookup service "${token_service}" key mcp-token)" \
    | curl --silent --output /dev/null --write-out '%{http_code}' --max-time 60 --config - \
      --header 'Accept: application/json, text/event-stream' --header 'Content-Type: application/json' \
      --data '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' "${mcp_url}" || true)
  case "${status}" in
    401)
      secret-tool clear service "${token_service}" key mcp-token
      echo '  spicy.trade rejected that token, so it was not kept. Sign in from the browser instead:' >&2
      echo "    ${agent_cli} login" >&2
      exit 1
      ;;
    2??)
      echo '  spicy.trade accepted the token'
      secret-tool clear service "${legacy_token_service}" key mcp-token
      ;;
    *)
      echo "  spicy.trade could not check the token (${status:-no answer}); it is stored unchecked. Check later with:" >&2
      echo "    ${agent_cli} doctor" >&2
      ;;
  esac
}

command -v secret-tool >/dev/null || { echo 'secret-tool is not installed (package: libsecret).' >&2; exit 1; }

# The default is the spicy.trade token alone. A personal grant is the exception now that tastytrade
# connects through spicy.trade's app (connect-tastytrade.mjs), and storing one beside an app grant
# stops the proxy, so it is only ever asked for by name.
case "${1:-mcp-token}" in
  mcp-token) want_mcp=1; want_tasty=0 ;;
  tastytrade) want_mcp=0; want_tasty=1 ;;
  -h|--help) usage; exit 0 ;;
  *) usage >&2; exit 1 ;;
esac

if [[ ${want_mcp} -eq 1 ]]; then
  store "${token_service}" mcp-token 'spicy.trade agent token' 'spicy.trade agent token (Connect tab in the web app):'
  check_mcp_token
  if ! secret-tool lookup service tastytrade key app-refresh-token >/dev/null 2>&1 \
    && ! secret-tool lookup service tastytrade key refresh-token >/dev/null 2>&1; then
    echo
    echo 'No tastytrade connection yet. To add one, approve spicy.trade on tastytrade with:'
    echo "  ${agent_cli} connect-tastytrade"
  fi
fi

if [[ ${want_tasty} -eq 1 ]]; then
  store tastytrade client-secret 'tastytrade OAuth client secret' 'tastytrade OAuth client secret:'
  store tastytrade refresh-token 'tastytrade refresh token' 'tastytrade refresh token (the grant you created):'
fi

# The proxy reads the keyring once at startup, so it has to be restarted to see a new value.
if systemctl --user is-enabled "${unit}" >/dev/null 2>&1; then
  systemctl --user restart "${unit}"
  echo
  systemctl --user is-active "${unit}" >/dev/null \
    && echo 'Proxy restarted. Check everything with:' \
    || echo 'Proxy failed to restart. Find out why with:'
  echo "  ${agent_cli} doctor"
else
  echo
  echo 'The proxy service is not installed. Install it with:'
  echo "  ${agent_cli} setup"
fi
