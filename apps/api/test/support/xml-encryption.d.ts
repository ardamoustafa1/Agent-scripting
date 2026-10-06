declare module 'xml-encryption' {
  export function encrypt(
    content: string,
    options: Record<string, unknown>,
    callback: (error: Error | null, result: string) => void,
  ): void;
}
