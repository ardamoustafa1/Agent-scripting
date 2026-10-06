export type Value = null | boolean | number | string | Value[] | { readonly [key: string]: Value };
export type ValueType = 'null' | 'boolean' | 'number' | 'string' | 'array' | 'object' | 'unknown';
export type Ast =
  | { readonly kind: 'literal'; readonly value: Value; readonly position: number }
  | { readonly kind: 'identifier'; readonly name: string; readonly position: number }
  | { readonly kind: 'array'; readonly items: readonly Ast[]; readonly position: number }
  | {
      readonly kind: 'object';
      readonly entries: readonly { key: string; value: Ast }[];
      readonly position: number;
    }
  | {
      readonly kind: 'unary';
      readonly operator: string;
      readonly operand: Ast;
      readonly position: number;
    }
  | {
      readonly kind: 'binary';
      readonly operator: string;
      readonly left: Ast;
      readonly right: Ast;
      readonly position: number;
    }
  | {
      readonly kind: 'conditional';
      readonly condition: Ast;
      readonly yes: Ast;
      readonly no: Ast;
      readonly position: number;
    }
  | {
      readonly kind: 'member';
      readonly object: Ast;
      readonly property: Ast;
      readonly optional: boolean;
      readonly position: number;
    }
  | {
      readonly kind: 'call';
      readonly name: string;
      readonly args: readonly Ast[];
      readonly position: number;
    }
  | {
      readonly kind: 'lambda';
      readonly parameter: string;
      readonly body: Ast;
      readonly position: number;
    };
export class ExpressionError extends Error {
  override readonly name = 'ExpressionError';
  constructor(
    readonly code: string,
    readonly position = 0,
  ) {
    super(code);
  }
}
export const FORBIDDEN_KEYS: readonly string[] = Object.freeze([
  '__proto__',
  'prototype',
  'constructor',
  'caller',
  'callee',
  'arguments',
]);
export function assertKey(key: string): void {
  if (FORBIDDEN_KEYS.includes(key)) throw new ExpressionError('FORBIDDEN_PROPERTY');
}
export const valueType = (value: Value): ValueType =>
  value === null ? 'null' : Array.isArray(value) ? 'array' : (typeof value as ValueType);
