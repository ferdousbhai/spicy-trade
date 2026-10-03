// `cf` types a Durable Object binding that names its Worker by string as an untyped namespace, and
// a Worker's config cannot reference itself; these two bindings are this Worker's own classes.
declare namespace Cloudflare {
  interface Env {
    BROKER_GATE: DurableObjectNamespace<import('./server').BrokerGate>
    MARKET_FEED: DurableObjectNamespace<import('./server').MarketFeed>
  }
}
