/** Date-only schedule values are inclusive through the end of their day. */
export function isWithinPromotionDates(start?: string, end?: string, now = new Date()): boolean {
  const startTime = start ? Date.parse(start.length === 10 ? `${start}T00:00:00` : start) : -Infinity;
  const endTime = end ? Date.parse(end.length === 10 ? `${end}T23:59:59.999` : end) : Infinity;
  return !Number.isNaN(startTime) && !Number.isNaN(endTime) && now.getTime() >= startTime && now.getTime() <= endTime;
}
