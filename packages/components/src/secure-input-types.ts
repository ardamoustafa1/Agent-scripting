export const SECURE_INPUT_TYPES = [
  'tcknInput',
  'vknInput',
  'ibanInput',
  'creditCardInput',
] as const;
export function isSecureInput(type: string): boolean {
  return (SECURE_INPUT_TYPES as readonly string[]).includes(type);
}
