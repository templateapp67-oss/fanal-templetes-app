import { buildYouTubeWatchUrl, extractYouTubeId } from '../utils/youtube.js';
import { fitSeoKeywords } from './seoKeywords.js';
import {
  DEFAULT_GALLERY_IMAGE_URL,
  blockingWebsiteIssues,
  cleanImageUrlInput,
  databaseYouTubeId,
  scheduleProblems,
  validateWebsiteContent,
  WEBSITE_LIMITS,
  type WebsiteFieldIssue,
} from './websiteValidation.js';

// ============================================================================
// Repairing website content before it is validated and saved.
//
// Owners paste links with stray spaces, leave "Add gallery image" rows empty,
// delete services their team members were assigned to, and so on. None of
// that should make the WHOLE save fail with an anonymous database error, so
// everything that has one obviously-correct repair is repaired here:
//
//   • image links are trimmed (and `cdn.example.com/a.jpg` gets `https://`);
//   • an empty gallery / lookbook slot gets the default image instead of
//     failing the save;
//   • missing or duplicate internal IDs are reassigned;
//   • YouTube links the database cannot read are rewritten to the canonical
//     watch URL;
//   • an SEO keyword list over the database limit loses its LAST keywords (whole
//     ones) — the list a new website used to start with was itself too long;
//   • team assignments are matched to real services (by ID, or by name) and
//     assignments to services that no longer exist are dropped;
//   • an invalid working day is saved as a day off.
//
// Everything is pure and idempotent: already-clean content is returned as the
// SAME object (no needless React state updates) with no changes reported.
// ============================================================================

export type WebsiteChangeKind =
  | 'cleaned_link'
  | 'default_image'
  | 'id_assigned'
  | 'video_link_standardised'
  | 'seo_keywords_shortened'
  | 'service_assignment_fixed'
  | 'service_assignment_removed'
  | 'schedule_day_off'
  | 'schedule_day_removed'
  | 'blank_team_member_skipped';

export interface WebsiteContentChange {
  kind: WebsiteChangeKind;
  path: string;
  /** One sentence describing the repair. */
  note: string;
  /** True when the owner should be told (the rest are invisible tidying). */
  notice: boolean;
}

const isObject = (value: unknown): value is Record<string, any> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const blank = (value: unknown) => typeof value !== 'string' || value.trim() === '';

const PROFILE_IMAGE_KEYS = ['ownerPhotoUrl', 'coverImageUrl', 'logoUrl', 'customFaviconUrl', 'socialShareImageUrl'] as const;
const SOCIAL_TEXT_KEYS = [
  'instagramHandle', 'facebookPage', 'youtubeChannel', 'tiktokProfile', 'tiktokHandle', 'tiktokUrl', 'googleBusinessUrl',
] as const;

/** Keep existing unique IDs; give every blank or repeated one a fresh `prefix-N`. */
function idAssigner(items: Array<Record<string, any>>, prefix: string) {
  const taken = new Set<string>();
  for (const item of items) if (typeof item.id === 'string' && item.id.trim()) taken.add(item.id);
  const seen = new Set<string>();
  let counter = 0;
  return (item: Record<string, any>): string | null => {
    if (typeof item.id === 'string' && item.id.trim() && !seen.has(item.id)) {
      seen.add(item.id);
      return null;
    }
    let next: string;
    do { counter += 1; next = `${prefix}${counter}`; } while (taken.has(next) || seen.has(next));
    taken.add(next);
    seen.add(next);
    return next;
  };
}

/** Trim a link field; `null` (an emptied field) becomes ''. Returns the item itself when nothing changes. */
function withCleanLink<T extends Record<string, any>>(item: T, key: string, path: string, changes: WebsiteContentChange[]): T {
  const value = item[key];
  if (value === null) {
    return { ...item, [key]: '' };
  }
  if (typeof value !== 'string') return item;
  const cleaned = cleanImageUrlInput(value);
  if (cleaned === value) return item;
  changes.push({ kind: 'cleaned_link', path, notice: false, note: 'Removed extra spaces from an image link.' });
  return { ...item, [key]: cleaned };
}

function healPhotoList(list: unknown[], key: 'gallery' | 'lookbookPhotos', changes: WebsiteContentChange[]): unknown[] {
  const path = `profile.${key}`;
  const noun = key === 'gallery' ? 'Gallery image' : 'Lookbook image';
  const objects = list.filter(isObject);
  const assign = idAssigner(objects, key === 'gallery' ? 'gallery-' : 'lookbook-');
  let changed = objects.length !== list.length;
  const next = objects.map((photo, index) => {
    let item: Record<string, any> = photo;
    const id = assign(photo);
    if (id) {
      item = { ...item, id };
      changes.push({ kind: 'id_assigned', path: `${path}[${index}].id`, notice: false, note: `${noun} ${index + 1} received a new internal ID.` });
    }
    if (blank(item.url)) {
      item = { ...item, url: DEFAULT_GALLERY_IMAGE_URL };
      changes.push({
        kind: 'default_image', path: `${path}[${index}].url`, notice: true,
        note: `${noun} ${index + 1} has no photo yet, so the default image is used.`,
      });
    } else {
      item = withCleanLink(item, 'url', `${path}[${index}].url`, changes);
    }
    if (item !== photo) changed = true;
    return item;
  });
  return changed ? next : list;
}

function healTestimonials(list: unknown[], changes: WebsiteContentChange[]): unknown[] {
  const objects = list.filter(isObject);
  const assign = idAssigner(objects, 'review-');
  let changed = objects.length !== list.length;
  const next = objects.map((review, index) => {
    let item: Record<string, any> = review;
    const id = assign(review);
    if (id) {
      item = { ...item, id };
      changes.push({ kind: 'id_assigned', path: `profile.testimonials[${index}].id`, notice: false, note: `Testimonial ${index + 1} received a new internal ID.` });
    }
    item = withCleanLink(item, 'avatarUrl', `profile.testimonials[${index}].avatarUrl`, changes);
    if (item !== review) changed = true;
    return item;
  });
  return changed ? next : list;
}

function healVideos(list: unknown[], changes: WebsiteContentChange[]): unknown[] {
  const objects = list.filter(isObject);
  const assign = idAssigner(objects, 'video-');
  let changed = objects.length !== list.length;
  const next = objects.map((video, index) => {
    let item: Record<string, any> = video;
    const id = assign(video);
    if (id) {
      item = { ...item, id };
      changes.push({ kind: 'id_assigned', path: `profile.socialVideos[${index}].id`, notice: false, note: `Video ${index + 1} received a new internal ID.` });
    }
    // The database only reads a few YouTube link shapes. Anything else the
    // editor accepted (scheme-less, music.youtube.com…) is rewritten.
    if (!databaseYouTubeId(blank(item.youtubeUrl) ? item.videoId : item.youtubeUrl)) {
      const videoId = extractYouTubeId(item.youtubeUrl) || extractYouTubeId(item.videoId);
      if (videoId) {
        item = { ...item, youtubeUrl: buildYouTubeWatchUrl(videoId), videoId };
        changes.push({ kind: 'video_link_standardised', path: `profile.socialVideos[${index}].youtubeUrl`, notice: false, note: `Video ${index + 1}'s YouTube link was standardised.` });
      }
    }
    if (item !== video) changed = true;
    return item;
  });
  return changed ? next : list;
}

function healProfile(profile: unknown, changes: WebsiteContentChange[]): unknown {
  if (!isObject(profile)) return profile;
  let next: Record<string, any> = profile;
  const set = (patch: Record<string, unknown>) => { next = next === profile ? { ...profile, ...patch } : { ...next, ...patch }; };

  for (const key of PROFILE_IMAGE_KEYS) {
    const cleaned = withCleanLink(next, key, `profile.${key}`, changes);
    if (cleaned !== next) set({ [key]: cleaned[key] });
  }
  for (const key of SOCIAL_TEXT_KEYS) {
    const value = next[key];
    if (typeof value === 'string' && value.trim() !== value) set({ [key]: value.trim() });
  }
  for (const [key, heal] of [
    ['gallery', (list: unknown[]) => healPhotoList(list, 'gallery', changes)],
    ['lookbookPhotos', (list: unknown[]) => healPhotoList(list, 'lookbookPhotos', changes)],
    ['testimonials', (list: unknown[]) => healTestimonials(list, changes)],
    ['socialVideos', (list: unknown[]) => healVideos(list, changes)],
  ] as const) {
    const list = next[key];
    if (!Array.isArray(list)) continue;
    const healed = heal(list);
    if (healed !== list) set({ [key]: healed });
  }

  // Too many keywords for the database: keep the first ones that fit. Only whole keywords
  // are dropped; a single keyword that is itself too long is left for the owner to fix.
  const keywords = next.seoKeywords;
  if (typeof keywords === 'string' && Array.from(keywords).length > WEBSITE_LIMITS.seoKeywords) {
    const fit = fitSeoKeywords(keywords, WEBSITE_LIMITS.seoKeywords);
    if (fit) {
      set({ seoKeywords: fit.value });
      changes.push({
        kind: 'seo_keywords_shortened', path: 'profile.seoKeywords', notice: fit.kept < fit.total,
        note: `SEO keywords: the first ${fit.kept} of ${fit.total} keywords are published — the rest did not fit the ${WEBSITE_LIMITS.seoKeywords}-character limit.`,
      });
    }
  }
  return next;
}

function healServices(list: unknown, changes: WebsiteContentChange[]): unknown {
  if (!Array.isArray(list)) return list;
  let changed = false;
  const next = list.map((service, index) => {
    if (!isObject(service)) return service;
    const healed = withCleanLink(service, 'imageUrl', `services[${index}].imageUrl`, changes);
    if (healed !== service) changed = true;
    return healed;
  });
  return changed ? next : list;
}

function healStylists(list: unknown, services: unknown, changes: WebsiteContentChange[]): unknown {
  if (!Array.isArray(list)) return list;
  // Assignments can only be checked when the service list is part of the state.
  const serviceIds = new Set<string>();
  const serviceByName = new Map<string, string>();
  const knowsServices = Array.isArray(services);
  if (knowsServices) {
    for (const service of services as unknown[]) {
      if (!isObject(service) || typeof service.id !== 'string') continue;
      serviceIds.add(service.id);
      const name = typeof service.name === 'string' ? service.name.trim().toLowerCase() : '';
      if (name && !serviceByName.has(name)) serviceByName.set(name, service.id);
    }
  }
  let changed = false;
  const next = list.map((stylist, index) => {
    if (!isObject(stylist)) return stylist;
    const base = `stylists[${index}]`;
    const who = typeof stylist.name === 'string' && stylist.name.trim() ? stylist.name.trim() : `Team member ${index + 1}`;
    let item: Record<string, any> = withCleanLink(stylist, 'avatarUrl', `${base}.avatarUrl`, changes);

    if (item.assignedServices !== undefined && item.assignedServices !== null) {
      if (!Array.isArray(item.assignedServices)) {
        item = { ...item, assignedServices: [] };
      } else if (knowsServices) {
        const kept: string[] = [];
        let fixed = 0;
        let removed = 0;
        for (const entry of item.assignedServices as unknown[]) {
          const asId = typeof entry === 'string' ? (serviceIds.has(entry) ? entry : serviceIds.has(entry.trim()) ? entry.trim() : undefined) : undefined;
          const byName = typeof entry === 'string' ? serviceByName.get(entry.trim().toLowerCase()) : undefined;
          const resolved = asId ?? byName;
          if (!resolved) { removed++; continue; }
          if (resolved !== entry) fixed++;
          if (!kept.includes(resolved)) kept.push(resolved);
        }
        const same = kept.length === item.assignedServices.length && kept.every((id, i) => id === item.assignedServices[i]);
        if (!same) {
          item = { ...item, assignedServices: kept };
          if (fixed) {
            changes.push({ kind: 'service_assignment_fixed', path: `${base}.assignedServices`, notice: false, note: `${who}: matched ${fixed} assigned service${fixed === 1 ? '' : 's'} to your service list.` });
          }
          if (removed) {
            changes.push({
              kind: 'service_assignment_removed', path: `${base}.assignedServices`, notice: true,
              note: `${who}: removed ${removed} assigned service${removed === 1 ? '' : 's'} that ${removed === 1 ? 'is' : 'are'} not on your service list.`,
            });
          }
        }
      }
    }

    if (item.schedule !== undefined && item.schedule !== null) {
      if (!Array.isArray(item.schedule)) {
        const { schedule: _dropped, ...rest } = item;
        item = rest;
      } else if (scheduleProblems(item.schedule).length) {
        const broken = new Map(scheduleProblems(item.schedule).map((problem) => [problem.index, problem]));
        const schedule: unknown[] = [];
        (item.schedule as unknown[]).forEach((entry, dayIndex) => {
          const problem = broken.get(dayIndex);
          if (!problem) { schedule.push(entry); return; }
          const knownDay = isObject(entry) && /^(sun|mon|tues|wednes|thurs|fri|satur)day$/i.test(String(entry.day).trim());
          if (!knownDay) {
            changes.push({ kind: 'schedule_day_removed', path: `${base}.schedule[${dayIndex}]`, notice: true, note: `${who}: ignored a schedule row with an unknown day.` });
            return;
          }
          schedule.push({ ...(entry as Record<string, unknown>), enabled: false });
          changes.push({
            kind: 'schedule_day_off', path: `${base}.schedule[${dayIndex}]`, notice: true,
            note: `${who}: ${problem.day} had invalid working hours, so it is saved as a day off.`,
          });
        });
        item = { ...item, schedule };
      }
    }
    if (item !== stylist) changed = true;
    return item;
  });
  return changed ? next : list;
}

export interface NormalizedWebsiteContent<T> {
  state: T;
  changes: WebsiteContentChange[];
}

/**
 * Repair profile / services / stylists (see the file header). Returns the very
 * same state object when there is nothing to repair. Team members without a
 * name are left in place here — they are only left out of the payload by
 * {@link prepareWebsiteStateForSave}, so an editor can apply the result back
 * without deleting a row the owner has just added.
 */
export function normalizeWebsiteContent<T>(state: T): NormalizedWebsiteContent<T> {
  const changes: WebsiteContentChange[] = [];
  if (!isObject(state)) return { state, changes };
  const source = state as Record<string, any>;
  const profile = healProfile(source.profile, changes);
  const services = healServices(source.services, changes);
  const stylists = healStylists(source.stylists, services, changes);
  if (profile === source.profile && services === source.services && stylists === source.stylists) {
    return { state, changes };
  }
  const next: Record<string, any> = { ...source };
  if (profile !== source.profile) next.profile = profile;
  if (services !== source.services) next.services = services;
  if (stylists !== source.stylists) next.stylists = stylists;
  return { state: next as T, changes };
}

export interface PreparedWebsiteSave<T> {
  /** Exactly what is written to the database: repaired, unnamed team drafts left out. */
  payload: T;
  /** Repaired copy that is safe to write back into editor state. */
  healed: T;
  /** Every repair that was made, in order. */
  changes: WebsiteContentChange[];
  /** Problems in `healed`: blocking errors and informational warnings. */
  issues: WebsiteFieldIssue[];
  /** The blocking subset of `issues`. */
  errors: WebsiteFieldIssue[];
  /** One sentence per kind of repair the owner should hear about. */
  notes: string[];
}

function summariseNotices(changes: WebsiteContentChange[]): string[] {
  const notes: string[] = [];
  const count = (kind: WebsiteChangeKind) => changes.filter((change) => change.kind === kind && change.notice).length;
  const emptyImages = count('default_image');
  if (emptyImages) {
    notes.push(`${emptyImages} gallery ${emptyImages === 1 ? 'slot has' : 'slots have'} no photo yet, so the default image is shown there.`);
  }
  const blankTeam = count('blank_team_member_skipped');
  if (blankTeam) {
    notes.push(`${blankTeam} team member${blankTeam === 1 ? '' : 's'} without a name ${blankTeam === 1 ? 'was' : 'were'} not published.`);
  }
  for (const change of changes) {
    if (change.notice && (change.kind === 'service_assignment_removed' || change.kind === 'schedule_day_off' || change.kind === 'schedule_day_removed' || change.kind === 'seo_keywords_shortened')) {
      notes.push(change.note);
    }
  }
  return notes;
}

/**
 * Everything a save needs, in one call: repair the content, work out what a
 * database write would reject, and build the payload. Used identically by the
 * editor (pre-flight check), the direct RPC save, the API fallback and the
 * server route, so they can never disagree about what is valid.
 */
export function prepareWebsiteStateForSave<T>(state: T): PreparedWebsiteSave<T> {
  const { state: healed, changes } = normalizeWebsiteContent(state);
  const issues = validateWebsiteContent(healed);
  let payload = healed;
  if (isObject(healed) && Array.isArray((healed as any).stylists)) {
    const stylists = (healed as any).stylists as unknown[];
    const named = stylists.filter((stylist) => !isObject(stylist) || !blank(stylist.name));
    if (named.length !== stylists.length) {
      payload = { ...(healed as Record<string, any>), stylists: named } as T;
      stylists.forEach((stylist, index) => {
        if (isObject(stylist) && blank(stylist.name)) {
          changes.push({
            kind: 'blank_team_member_skipped', path: `stylists[${index}].name`, notice: true,
            note: `Team member ${index + 1} has no name, so they are not published.`,
          });
        }
      });
    }
  }
  return {
    payload,
    healed,
    changes,
    issues,
    errors: blockingWebsiteIssues(issues),
    notes: summariseNotices(changes),
  };
}
