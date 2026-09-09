import { BackendError } from './backendContext.js';
export function appointmentInstant(date: string, time: string, timezone = 'Asia/Kolkata') {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new BackendError(400, 'A valid appointment date and time are required.');
  const target = Date.parse(`${date}T${time}:00Z`);
  if (!Number.isFinite(target) || new Date(target).toISOString().slice(0,10) !== date) throw new BackendError(400, 'Invalid appointment date.');
  let instant = target;
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const wallTime = (value: number) => { const p = formatter.formatToParts(new Date(value)); const get = (key: string) => p.find(v=>v.type===key)?.value; return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:00Z`; };
  for (let n=0;n<3;n++) instant += target - Date.parse(wallTime(instant));
  if (wallTime(instant) !== `${date}T${time}:00Z`) throw new BackendError(400, 'This local time is not available in the salon timezone.');
  return new Date(instant).toISOString();
}
