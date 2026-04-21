# Platform Logging and Observability — Open Questions

## Blocking Questions

None for the first pass.

## Non-Blocking Follow-Ups

- whether frontend/browser telemetry should later use Sentry or another client
  error-reporting tool
- whether request/session correlation should include a separate externally
  visible correlation ID beyond Fastify `reqId`
- whether specific PII fields should be further minimized in logs beyond
  default header/token redaction
- whether future external log shipping should target Splunk, Datadog, or a
  different sink beyond CloudWatch

## Known Current Drift

- global request error handling returns correct error envelopes but does not yet
  log errors consistently
- backend modules mix `app.log`, `console.*`, and silent negative paths rather
  than one logging policy
- request-context bindings such as `sessionId`, `userId`, and route/action are
  not yet applied consistently to all backend logs
