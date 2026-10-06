import { z } from 'zod';

const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$|^24:00$/);
const Interval = z
  .strictObject({ from: HHMM, to: HHMM })
  .refine((i) => i.from < i.to, 'from must be before to');
export const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

export const WorkingHoursSchema = z
  .strictObject({
    timezone: z
      .string()
      .min(1)
      .max(64)
      .refine((tz) => {
        try {
          new Intl.DateTimeFormat('en-US', { timeZone: tz });
          return true;
        } catch {
          return false;
        }
      }, 'unknown IANA time zone'),
    weekly: z.partialRecord(z.enum(DAYS), z.array(Interval).max(6)),
    holidays: z
      .array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/))
      .max(366)
      .default([]),
  })
  .meta({ id: 'WorkingHours' });
export type WorkingHours = z.output<typeof WorkingHoursSchema>;

/** Local weekday/date/time of `at` in `timezone` (Intl only; no tz database dependency). */
export function localParts(
  at: Date,
  timezone: string,
): { day: (typeof DAYS)[number]; date: string; time: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'short',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  const day = String(parts['weekday']).toLowerCase().slice(0, 3) as (typeof DAYS)[number];
  return {
    day,
    date: `${String(parts['year'])}-${String(parts['month'])}-${String(parts['day'])}`,
    time: `${String(parts['hour'])}:${String(parts['minute'])}`,
  };
}

export function isOpen(hours: WorkingHours, at: Date): boolean {
  const { day, date, time } = localParts(at, hours.timezone);
  if (hours.holidays.includes(date)) return false;
  return (hours.weekly[day] ?? []).some((i) => time >= i.from && time < i.to);
}
