declare const brand: unique symbol;

/** Nominal typing helper: `Brand<string, 'TenantId'>` is not assignable from a plain string. */
export type Brand<T, B extends string> = T & { readonly [brand]: B };

export type TenantId = Brand<string, 'TenantId'>;
export type UserId = Brand<string, 'UserId'>;
export type CorrelationId = Brand<string, 'CorrelationId'>;
