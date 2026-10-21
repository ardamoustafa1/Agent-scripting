/**
 * A readable fallback for names authors never wrote as prose: `defaultValue` → "Default value",
 * `ORDER_NOT_FOUND` → "Order not found", `kargoSorgu` → "Kargo sorgu".
 */
export function humanize(name: string): string {
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
