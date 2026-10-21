/** Card numbers stay in hosted capture: the value never enters Verbis (PCI, ADR-0053). */
export const SECURE_INPUT_TYPES = ['creditCardInput'] as const;
/** Typed by the agent, always written as personal data and masked on screen (KVKK, ADR-0053). */
export const PERSONAL_ID_INPUT_TYPES = ['tcknInput', 'vknInput', 'ibanInput'] as const;
export function isSecureInput(type: string): boolean {
  return (SECURE_INPUT_TYPES as readonly string[]).includes(type);
}
export function isPersonalIdInput(type: string): boolean {
  return (PERSONAL_ID_INPUT_TYPES as readonly string[]).includes(type);
}
