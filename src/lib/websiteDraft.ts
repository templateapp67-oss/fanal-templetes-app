import type { HydratableSalonState } from './hydrationMerge';

export type WebsiteSnapshot = HydratableSalonState;
export function websiteSnapshot(state: WebsiteSnapshot): WebsiteSnapshot {
  return JSON.parse(JSON.stringify({ profile: state.profile, services: state.services, stylists: state.stylists,
    loyaltyConfig: state.loyaltyConfig, selectedTemplateId: state.selectedTemplateId }));
}
export function websiteDraftKey(ownerId: string, siteId: string): string {
  return `nexora_draft_${encodeURIComponent(ownerId)}_${encodeURIComponent(siteId)}`;
}
interface Draft { version: 1; ownerId: string; siteId: string; base: WebsiteSnapshot; state: WebsiteSnapshot }
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
function valid(state: any): state is WebsiteSnapshot {
  return !!state && state.profile && typeof state.profile === 'object' && !Array.isArray(state.profile)
    && Array.isArray(state.services) && Array.isArray(state.stylists)
    && state.loyaltyConfig && typeof state.loyaltyConfig === 'object' && typeof state.selectedTemplateId === 'string';
}
function read(ownerId: string, siteId: string): Draft | null {
  try {
    const raw = localStorage.getItem(websiteDraftKey(ownerId, siteId));
    const d = raw ? JSON.parse(raw) : null;
    if (d?.version !== 1 || d.ownerId !== ownerId || d.siteId !== siteId || !valid(d.base) || !valid(d.state)) return null;
    if (d.state.profile.ownerId && d.state.profile.ownerId !== ownerId) return null;
    return d;
  } catch { return null; }
}
/** Synchronous, before the network debounce. Do not strip images on quota failure. */
export function writeWebsiteDraft(ownerId: string, siteId: string, base: WebsiteSnapshot, state: WebsiteSnapshot): boolean {
  if (!ownerId || !siteId || (state.profile.ownerId && state.profile.ownerId !== ownerId)) return false;
  try {
    const clean = websiteSnapshot(state);
    if (equal(base, clean)) localStorage.removeItem(websiteDraftKey(ownerId, siteId));
    else localStorage.setItem(websiteDraftKey(ownerId, siteId), JSON.stringify({ version: 1, ownerId, siteId, base, state: clean }));
    return true;
  } catch { return false; }
}
/** Only locally edited fields win. Unedited values use the latest cloud row. */
export function recoverWebsiteDraft(ownerId: string, siteId: string, cloud: WebsiteSnapshot): WebsiteSnapshot {
  let draft = read(ownerId, siteId);
  // First publish gives an initially unnamed workspace its canonical salon ID.
  // Transfer only within the same owner AND matching persisted website slug.
  if (!draft && siteId !== 'workspace') {
    const initial = read(ownerId, 'workspace');
    const slug = cloud.profile.subdomain;
    if (initial && slug && (initial.base.profile.subdomain === slug || initial.state.profile.subdomain === slug)) {
      draft = { ...initial, siteId };
      if (writeWebsiteDraft(ownerId, siteId, initial.base, initial.state)) {
        try { localStorage.removeItem(websiteDraftKey(ownerId, 'workspace')); } catch { /* new copy is safe */ }
      }
    }
  }
  if (!draft) return cloud;
  const next = websiteSnapshot(cloud);
  for (const key of new Set([...Object.keys(draft.base.profile), ...Object.keys(draft.state.profile)])) {
    if (key === 'ownerId' || key === 'ownerName' || key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    if (!equal(draft.base.profile[key], draft.state.profile[key])) {
      if (key in draft.state.profile) next.profile[key] = draft.state.profile[key];
      else delete next.profile[key];
    }
  }
  for (const key of ['services', 'stylists', 'loyaltyConfig', 'selectedTemplateId'] as const) {
    if (!equal(draft.base[key], draft.state[key])) (next as any)[key] = draft.state[key];
  }
  return next;
}
/** A slow save acknowledgement may not erase a newer keystroke's draft. */
export function acknowledgeWebsiteDraft(ownerId: string, siteId: string, saved: WebsiteSnapshot): void {
  const draft = read(ownerId, siteId);
  if (draft) writeWebsiteDraft(ownerId, siteId, websiteSnapshot(saved), draft.state);
}
