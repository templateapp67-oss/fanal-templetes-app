export function isPartnerProfileComplete(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const p = value as Record<string, unknown>;
  return ['name', 'whatsapp', 'postal', 'city', 'area', 'avatar', 'dob'].every(
    key => typeof p[key] === 'string' && (p[key] as string).trim().length > 0
  );
}
