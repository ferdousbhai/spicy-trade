#!/usr/bin/env node
// The pre-rename path, kept only because installed `spice-agent-proxy.service` units start it
// directly: without this, a member's proxy stops at its next restart, before `spicy-trade setup`
// has rewritten the unit. Delete once members have had a release cycle to run setup.
import '../spicy-trade/proxy.mjs'
