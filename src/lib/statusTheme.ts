/** Shared semantic status colors from the app's existing booking theme. */
export type StatusTone = 'amber' | 'emerald' | 'sky' | 'rose' | 'slate' | 'blue' | 'orange';

export const STATUS_TONE_CLASSES: Record<StatusTone, { badge: string; text: string }> = {
  amber: { badge: 'bg-amber-100 text-amber-800 border-amber-300', text: 'text-amber-700' },
  emerald: { badge: 'bg-emerald-100 text-emerald-800 border-emerald-300', text: 'text-emerald-700' },
  sky: { badge: 'bg-sky-100 text-sky-800 border-sky-300', text: 'text-sky-700' },
  rose: { badge: 'bg-rose-100 text-rose-800 border-rose-300', text: 'text-rose-700' },
  slate: { badge: 'bg-slate-200 text-slate-700 border-slate-300', text: 'text-slate-600' },
  blue: { badge: 'bg-blue-100 text-blue-800 border-blue-300', text: 'text-blue-700' },
  orange: { badge: 'bg-orange-100 text-orange-800 border-orange-300', text: 'text-orange-700' },
};
