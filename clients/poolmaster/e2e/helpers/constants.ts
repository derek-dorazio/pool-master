/**
 * #278 — every password a spec generates starts with this, so redact-artifacts.ts can find
 * it in a trace without the spec and the scrubber sharing anything else.
 */
export const GENERATED_PASSWORD_PREFIX = 'e2e-pw-';
