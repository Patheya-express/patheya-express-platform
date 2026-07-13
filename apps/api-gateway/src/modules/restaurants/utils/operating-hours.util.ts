import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);

interface OperatingHourLike {
  dayOfWeek: number;
  opensAt: string;
  closesAt: string;
  isClosed: boolean;
}

export interface HolidayLike {
  date: Date | string;
  isClosed: boolean;
  specialOpensAt?: string | null;
  specialClosesAt?: string | null;
}

/** Used whenever a branch has no `timezone` configured, or an invalid IANA zone was stored. */
const DEFAULT_TIMEZONE = 'Asia/Kolkata';

function toMinutesSinceMidnight(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

function resolveZonedNow(timezoneName: string | null | undefined, now: Date) {
  if (timezoneName) {
    try {
      const zoned = dayjs(now).tz(timezoneName);

      if (zoned.isValid()) {
        return zoned;
      }
    } catch {
      // Falls through to the default zone below on an unrecognized IANA timezone string.
    }
  }

  return dayjs(now).tz(DEFAULT_TIMEZONE);
}

/**
 * A branch with no configured operating hours is treated as always open — hours are opt-in
 * configuration, not a prerequisite for being listed. Once a branch has hours for at least one
 * day, a day with no matching entry is treated as closed for that day, since the owner has
 * deliberately scoped which days they operate.
 *
 * Always evaluated in the branch's own IANA timezone (falls back to Asia/Kolkata when unset or
 * invalid) rather than server-local time, so "open now" is correct regardless of where the API
 * process happens to run.
 *
 * Supports split shifts: multiple `operatingHours` rows sharing the same `dayOfWeek` are treated
 * as separate windows (e.g. lunch + dinner) — the branch is open if `now` falls within any of
 * them. A holiday entry for today's date (in the branch's timezone) takes precedence over the
 * regular weekly schedule.
 */
export function computeIsOpenNow(
  operatingHours: OperatingHourLike[],
  timezoneName?: string | null,
  now: Date = new Date(),
  holidays: HolidayLike[] = [],
): boolean {
  const zonedNow = resolveZonedNow(timezoneName, now);
  const todayKey = zonedNow.format('YYYY-MM-DD');

  const holidayToday = holidays.find(
    (holiday) => dayjs(holiday.date).format('YYYY-MM-DD') === todayKey,
  );

  if (holidayToday) {
    if (
      holidayToday.isClosed ||
      !holidayToday.specialOpensAt ||
      !holidayToday.specialClosesAt
    ) {
      return false;
    }

    const nowMinutes = zonedNow.hour() * 60 + zonedNow.minute();

    return (
      nowMinutes >= toMinutesSinceMidnight(holidayToday.specialOpensAt) &&
      nowMinutes <= toMinutesSinceMidnight(holidayToday.specialClosesAt)
    );
  }

  if (operatingHours.length === 0) {
    return true;
  }

  const todayShifts = operatingHours.filter(
    (entry) => entry.dayOfWeek === zonedNow.day(),
  );

  if (todayShifts.length === 0 || todayShifts.some((shift) => shift.isClosed)) {
    return false;
  }

  const nowMinutes = zonedNow.hour() * 60 + zonedNow.minute();

  return todayShifts.some(
    (shift) =>
      nowMinutes >= toMinutesSinceMidnight(shift.opensAt) &&
      nowMinutes <= toMinutesSinceMidnight(shift.closesAt),
  );
}
