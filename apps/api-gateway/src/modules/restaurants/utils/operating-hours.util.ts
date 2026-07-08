interface OperatingHourLike {
  dayOfWeek: number;
  opensAt: string;
  closesAt: string;
  isClosed: boolean;
}

function toMinutesSinceMidnight(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

/**
 * A branch with no configured operating hours is treated as always open — hours are opt-in
 * configuration, not a prerequisite for being listed. Once a branch has hours for at least one
 * day, a day with no matching entry is treated as closed for that day, since the owner has
 * deliberately scoped which days they operate.
 *
 * Uses server-local time (JS `Date.getDay()`: 0 = Sunday .. 6 = Saturday). A production system
 * serving multiple timezones would need a branch-level timezone field; out of scope here since
 * this platform currently operates in a single region.
 */
export function computeIsOpenNow(
  operatingHours: OperatingHourLike[],
  now: Date = new Date(),
): boolean {
  if (operatingHours.length === 0) {
    return true;
  }

  const today = operatingHours.find(
    (entry) => entry.dayOfWeek === now.getDay(),
  );

  if (!today || today.isClosed) {
    return false;
  }

  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const opensMinutes = toMinutesSinceMidnight(today.opensAt);
  const closesMinutes = toMinutesSinceMidnight(today.closesAt);

  return nowMinutes >= opensMinutes && nowMinutes <= closesMinutes;
}
