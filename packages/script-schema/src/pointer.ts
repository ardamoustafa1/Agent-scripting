export type PathSegment = string | number;

/** RFC 6901 JSON Pointer from path segments. */
export function toPointer(segments: readonly PathSegment[]): string {
  return segments
    .map((segment) => `/${String(segment).replace(/~/g, '~0').replace(/\//g, '~1')}`)
    .join('');
}

/** Parses an RFC 6901 JSON Pointer into segments (array indices stay strings). */
export function fromPointer(pointer: string): string[] {
  if (pointer === '') return [];
  if (!pointer.startsWith('/')) throw new Error(`Invalid JSON Pointer: ${pointer}`);
  return pointer
    .slice(1)
    .split('/')
    .map((segment) => segment.replace(/~1/g, '/').replace(/~0/g, '~'));
}
