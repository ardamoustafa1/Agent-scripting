/** DI tokens of the identity module's non-class providers. */
export const IDENTITY_KEYRING = Symbol('IDENTITY_KEYRING');
export const IDP_FETCH = Symbol('IDP_FETCH');
export const SESSION_STORE = Symbol('SESSION_STORE');
export const APP_ORIGINS = Symbol('APP_ORIGINS');
export const IDENTITY_CLOCK = Symbol('IDENTITY_CLOCK');

/** Injectable clock (ms) so timeouts, TOTP and token lifetimes are deterministic in tests. */
export type Clock = () => number;
