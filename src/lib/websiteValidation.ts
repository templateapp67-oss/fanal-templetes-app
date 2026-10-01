import type { SalonProfile } from '../types.js';
import { extractYouTubeId } from '../utils/youtube.js';
import { formatFacebookUrl, formatInstagramUrl, formatTikTokUrl } from '../utils/social.js';

// ============================================================================
// Website content validation shared by the editor, the auto-save pipeline and
// POST /api/website/save (imported by server code: keep `.js` import suffixes).
//
// Every rule below mirrors what the `save_owner_editor_state` RPC enforces in
// Postgres (see supabase/migrations/20261031000000_fix_website_save_and_public_site.sql).
// Checking the same rules BEFORE the request is what lets the editor say
// "Service 3 › Price: enter a price of 0 or more" instead of the database's
// anonymous 22023 "invalid content" rejection.
// ============================================================================

export function isValidContactPhone(value: unknown): boolean {
  return typeof value === 'string' && /^[+\d\s().-]+$/.test(value.trim()) && /^\d{7,15}$/.test(value.replace(/\D/g, ''));
}

/** Shared by the editor and its HTTP save path; owner bio/email are optional. */
export function hasRequiredWebsiteProfile(profile: Partial<SalonProfile> | null | undefined): boolean {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) return false;
  const text = (key: keyof SalonProfile) => typeof profile[key] === 'string' && String(profile[key]).trim().length > 0;
  return text('businessName') && text('businessType') && text('address') && text('city') &&
    isValidContactPhone(profile.phone || (profile as any).phone_number);
}

/**
 * Same-origin picture (public/gallery-placeholder.svg) that stands in for any
 * gallery or lookbook slot the owner left without a photo. It is a relative
 * path, so it passes both this validator and the database image check.
 */
export const DEFAULT_GALLERY_IMAGE_URL = '/gallery-placeholder.svg';

/** Limits enforced by the database; the editor shows them before saving. */
export const WEBSITE_LIMITS = {
  services: 500,
  gallery: 100,
  testimonials: 100,
  videosPerPlacement: 14,
  ownerBio: 2000,
  about: 4000,
  seoTitle: 120,
  seoDescription: 320,
  seoKeywords: 500,
  videoTitle: 200,
  videoDescription: 2000,
  faviconLetter: 2,
} as const;

// `https://host/path` exactly as the database accepts it: a non-empty host
// without credentials or whitespace. (`new URL` alone also accepts
// `https:///x`, which Postgres rejects.)
const HTTP_IMAGE_URL = /^https?:\/\/[^/@\s]+(?:[/?#].*)?$/i;
// `cdn.example.com/photo.jpg` pasted without the scheme. A path is required:
// a bare `photo.jpg` or `example.com` is not something we can safely guess.
const SCHEMELESS_IMAGE_URL = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,24}\/\S+$/i;

/**
 * Image links must be http(s), a same-origin path or a raster data URL. Leading
 * and trailing whitespace is ignored (pasted links often carry a trailing
 * space or newline), and an empty value means "no image".
 */
export function isSafeImageUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const v = value.trim();
  if (v === '') return true;
  if (/^\/(?!\/)/.test(v)) return !/[\r\n\\]/.test(v);
  if (/^data:image\/(?:png|jpeg|jpg|webp);base64,[A-Za-z0-9+/]+=*$/.test(v)) return true;
  if (!HTTP_IMAGE_URL.test(v)) return false;
  try {
    const url = new URL(v);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
  } catch { return false; }
}

/** Trimmed copy of a safe image URL (empty string allowed), otherwise undefined. */
export function trimmedSafeImageUrl(value: unknown): string | undefined {
  return isSafeImageUrl(value) ? value.trim() : undefined;
}

/**
 * Clean what an owner typed or pasted into an image-link field: trim it and
 * add `https://` to a scheme-less `host.tld/path` link. Anything else is
 * returned trimmed but otherwise untouched so validation can explain it.
 */
export function cleanImageUrlInput(value: string): string {
  const v = value.trim();
  return v && SCHEMELESS_IMAGE_URL.test(v) ? `https://${v}` : v;
}

/**
 * The YouTube video id the DATABASE can read from a link. The editor's own
 * parser (`extractYouTubeId`) is more forgiving — it also takes scheme-less
 * links and music.youtube.com — but only these four forms survive
 * `nexora_website_youtube_id` in Postgres, so anything else must be rewritten
 * to a canonical link before saving.
 */
export function databaseYouTubeId(input: unknown): string | null {
  const v = typeof input === 'string' ? input.trim() : '';
  if (/^[A-Za-z0-9_-]{11}$/.test(v)) return v;
  const patterns = [
    /^https?:\/\/(?:www\.|m\.)?youtu\.be\/([A-Za-z0-9_-]{11})(?:[/?#&]|$)/,
    /^https?:\/\/(?:www\.|m\.)?youtube(?:-nocookie)?\.com\/(?:shorts|embed|live)\/([A-Za-z0-9_-]{11})(?:[/?#&]|$)/,
    /^https?:\/\/(?:www\.|m\.)?youtube(?:-nocookie)?\.com\/watch\/?\?(?:[^#]*&)?v=([A-Za-z0-9_-]{11})(?:[&#]|$)/,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(v);
    if (match) return match[1];
  }
  return null;
}

/** `09:00`, `9:00:30`, `09:00 AM` and `6:15 pm` → seconds since midnight (null when unreadable). */
export function clockToSeconds(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const match = /^\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap])\.?m\.?\s*$|^\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*$/i.exec(value);
  if (!match) return null;
  const meridiem = match[4]?.toLowerCase();
  let hours = Number(match[1] ?? match[5]);
  const minutes = Number(match[2] ?? match[6]);
  const seconds = Number(match[3] ?? match[7] ?? 0);
  if (minutes > 59 || seconds > 59) return null;
  if (meridiem) {
    if (hours < 1 || hours > 12) return null;
    hours = (hours % 12) + (meridiem === 'p' ? 12 : 0);
  } else if (hours > 24 || (hours === 24 && (minutes > 0 || seconds > 0))) {
    return null;
  }
  return hours * 3600 + minutes * 60 + seconds;
}

export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

export interface ScheduleProblem {
  index: number;
  day: string;
  message: string;
}

/**
 * Problems in a team member's weekly schedule — the same two the database
 * raises as "Invalid staff schedule day" / "Invalid staff schedule time range".
 */
export function scheduleProblems(schedule: unknown): ScheduleProblem[] {
  if (!Array.isArray(schedule)) return [];
  const problems: ScheduleProblem[] = [];
  schedule.forEach((entry: any, index) => {
    const rawDay = entry && typeof entry.day === 'string' ? entry.day.trim() : '';
    const day = WEEKDAY_NAMES.find((name) => name.toLowerCase() === rawDay.toLowerCase());
    if (!day) {
      problems.push({ index, day: rawDay || `Day ${index + 1}`, message: `“${rawDay || 'blank'}” is not a weekday name. Use Monday to Sunday.` });
      return;
    }
    if (!entry.enabled) return;
    const from = clockToSeconds(entry.fromTime);
    const to = clockToSeconds(entry.toTime);
    if (from === null || to === null) {
      problems.push({ index, day, message: `${day}: choose both an opening and a closing time, or switch the day off.` });
    } else if (to <= from) {
      problems.push({ index, day, message: `${day}: the closing time must be after the opening time.` });
    }
  });
  return problems;
}

// ----------------------------------------------------------------------------
// Structured issues
// ----------------------------------------------------------------------------

export type WebsiteIssueSeverity = 'error' | 'warning';

export interface WebsiteFieldIssue {
  /**
   * Stable machine path of the failing input, e.g. `services[2].price`,
   * `profile.gallery[0].url` or `stylists[1].avatarUrl`. The editor tags the
   * matching input with `data-field-path` so the error can sit next to it.
   */
  path: string;
  /** The part of the editor the field lives in: "Services", "Gallery"… */
  section: string;
  /** Human location, item included: `Service 3 (“Hair Spa”) › Price`. */
  label: string;
  /** What is wrong and how to fix it. */
  message: string;
  /** `error` blocks the save; `warning` is information only. */
  severity: WebsiteIssueSeverity;
}

/** `Service 3 (“Hair Spa”) › Price: Enter a price…` — for toasts and lists. */
export function formatWebsiteIssue(issue: Pick<WebsiteFieldIssue, 'label' | 'message'>): string {
  return issue.label ? `${issue.label}: ${issue.message}` : issue.message;
}

export function blockingWebsiteIssues(issues: readonly WebsiteFieldIssue[]): WebsiteFieldIssue[] {
  return issues.filter((issue) => issue.severity === 'error');
}

const isObject = (value: unknown): value is Record<string, any> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
/** "Provided" = present and not null. Null/undefined mean "leave empty". */
const provided = (value: unknown) => value !== undefined && value !== null;
const asText = (value: unknown) => (typeof value === 'string' ? value : '');
/** Postgres counts characters, JavaScript counts UTF-16 units. */
const charCount = (value: unknown) => (typeof value === 'string' ? Array.from(value).length : 0);

function quoted(value: unknown, max = 34): string {
  const text = asText(value).trim().replace(/\s+/g, ' ');
  if (!text) return '';
  return ` (“${text.length > max ? `${text.slice(0, max - 1)}…` : text}”)`;
}

const IMAGE_LINK_HELP =
  'Paste a full image link that starts with https://, upload a JPG, PNG or WebP, or leave it empty.';
const GALLERY_LINK_HELP =
  'Paste a full image link that starts with https://, upload a JPG, PNG or WebP, or clear it to use the default image.';
const HEX_COLOR = /^#[0-9A-Fa-f]{3,8}$/;
const WEBSITE_SUBDOMAIN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

const PROFILE_IMAGE_FIELDS: ReadonlyArray<readonly [string, string, string]> = [
  ['ownerPhotoUrl', 'Owner details', 'Owner details › Portrait image'],
  ['coverImageUrl', 'Website hero', 'Website hero › Cover image'],
  ['logoUrl', 'Brand', 'Brand › Logo image'],
  ['customFaviconUrl', 'Brand', 'Brand › Favicon image'],
  ['socialShareImageUrl', 'SEO & sharing', 'SEO & sharing › Social share image'],
];

const COLOR_FIELDS: ReadonlyArray<readonly [string, string]> = [
  ['primaryColor', 'Primary colour'],
  ['secondaryColor', 'Secondary colour'],
  ['customAccentColor', 'Accent colour'],
  ['backgroundColor', 'Background colour'],
  ['faviconColor', 'Favicon colour'],
];

const TEXT_LIMIT_FIELDS: ReadonlyArray<readonly [string, number, string, string]> = [
  ['ownerBio', WEBSITE_LIMITS.ownerBio, 'Owner details', 'Owner details › Professional biography'],
  ['about', WEBSITE_LIMITS.about, 'Website hero', 'About text'],
  ['seoTitle', WEBSITE_LIMITS.seoTitle, 'SEO & sharing', 'SEO & sharing › Page title'],
  ['seoDescription', WEBSITE_LIMITS.seoDescription, 'SEO & sharing', 'SEO & sharing › Page description'],
  ['seoKeywords', WEBSITE_LIMITS.seoKeywords, 'SEO & sharing', 'SEO & sharing › Keywords'],
];

/**
 * Every problem that would stop this state being saved (`error`), plus notes
 * about things that will not show up on the website (`warning`). Never mutates
 * the state. Run {@link normalizeWebsiteContent} first to get exactly what a
 * save would send — empty gallery slots, padded links and stale team
 * assignments are repaired there instead of being reported here.
 */
export function validateWebsiteContent(state: any): WebsiteFieldIssue[] {
  const issues: WebsiteFieldIssue[] = [];
  const error = (path: string, section: string, label: string, message: string) => {
    issues.push({ path, section, label, message, severity: 'error' });
  };
  const warning = (path: string, section: string, label: string, message: string) => {
    issues.push({ path, section, label, message, severity: 'warning' });
  };

  if (!isObject(state)) {
    error('state', 'Website', 'Website', 'Website data must be an object.');
    return issues;
  }
  const profile = state.profile;
  if (!isObject(profile)) {
    error('profile', 'Profile', 'Profile', 'A profile object is required.');
    return issues;
  }
  for (const key of ['services', 'stylists', 'appointments', 'clients']) {
    if (state[key] !== undefined && !Array.isArray(state[key])) {
      const section = key === 'services' ? 'Services' : key === 'stylists' ? 'Team' : 'Website';
      error(key, section, section, `${key} must be an array.`);
    }
  }

  // ---- Website address -----------------------------------------------------
  if (typeof profile.subdomain === 'string' && profile.subdomain.trim() !== '') {
    const address = profile.subdomain.trim().toLowerCase();
    if (!WEBSITE_SUBDOMAIN.test(address)) {
      error('profile.subdomain', 'Website address', 'Website address',
        'Use only lowercase letters, numbers and hyphens, and do not start or end with a hyphen.');
    }
  }

  // ---- Profile images ------------------------------------------------------
  for (const [key, section, label] of PROFILE_IMAGE_FIELDS) {
    if (provided(profile[key]) && !isSafeImageUrl(profile[key])) {
      error(`profile.${key}`, section, label, `This image link is not valid. ${IMAGE_LINK_HELP}`);
    }
  }

  // ---- Brand colours & favicon letter -------------------------------------
  for (const [key, name] of COLOR_FIELDS) {
    const value = profile[key];
    if (!provided(value) || value === '') continue;
    if (typeof value !== 'string' || (value.trim() !== '' && !HEX_COLOR.test(value.trim()))) {
      error(`profile.${key}`, 'Brand', `Brand › ${name}`, 'Use a hex colour such as #C20E5A.');
    }
  }
  if (typeof profile.faviconLetter === 'string' && charCount(profile.faviconLetter.trim()) > WEBSITE_LIMITS.faviconLetter) {
    error('profile.faviconLetter', 'Brand', 'Brand › Favicon letter', `Use at most ${WEBSITE_LIMITS.faviconLetter} characters.`);
  }

  // ---- Long text -----------------------------------------------------------
  for (const [key, max, section, label] of TEXT_LIMIT_FIELDS) {
    const length = charCount(profile[key]);
    if (length > max) {
      error(`profile.${key}`, section, label,
        `Keep this under ${max.toLocaleString('en-US')} characters (it is ${length.toLocaleString('en-US')} now).`);
    }
  }

  // ---- Social links (never block a save, but say what will not show) ------
  const socialChecks: ReadonlyArray<readonly [string, string, unknown, (input: string) => string]> = [
    ['profile.instagramHandle', 'Instagram', profile.instagramHandle, formatInstagramUrl],
    ['profile.facebookPage', 'Facebook', profile.facebookPage, formatFacebookUrl],
    ['profile.tiktokHandle', 'TikTok', profile.tiktokHandle || profile.tiktokProfile || profile.tiktokUrl, formatTikTokUrl],
  ];
  for (const [path, name, value, format] of socialChecks) {
    if (typeof value === 'string' && value.trim() !== '' && !format(value)) {
      warning(path, 'Social links', `Social links › ${name}`,
        `“${value.trim().slice(0, 60)}” is not a ${name} handle or link, so it will not appear on your website. Use @yourname or a full ${name.toLowerCase()}.com link.`);
    }
  }
  for (const [path, name, value] of [
    ['profile.youtubeChannel', 'YouTube channel', profile.youtubeChannel],
    ['profile.googleBusinessUrl', 'Google Business link', profile.googleBusinessUrl],
  ] as const) {
    if (typeof value === 'string' && value.trim() !== '' && !HTTP_IMAGE_URL.test(value.trim())) {
      warning(path, 'Social links', `Social links › ${name}`, 'Enter a full link that starts with https://.');
    }
  }

  // ---- Videos --------------------------------------------------------------
  if (profile.socialVideos !== undefined) {
    if (!Array.isArray(profile.socialVideos)) {
      error('profile.socialVideos', 'Videos', 'Videos', 'Videos must be a list.');
    } else {
      const ids = new Set<string>();
      let shorts = 0;
      let showcases = 0;
      profile.socialVideos.forEach((video: any, index: number) => {
        const base = `profile.socialVideos[${index}]`;
        const label = `Video ${index + 1}${quoted(video?.title)}`;
        if (!isObject(video)) {
          error(base, 'Videos', label, 'This video entry is damaged. Remove it and add it again.');
          return;
        }
        if (typeof video.id !== 'string' || !video.id.trim()) {
          error(`${base}.id`, 'Videos', label, 'This video has no internal ID. Remove it and add it again.');
        } else if (ids.has(video.id)) {
          error(`${base}.id`, 'Videos', label, 'Another video uses the same internal ID. Remove one of them and add it again.');
        } else {
          ids.add(video.id);
        }
        const hasLink = !!extractYouTubeId(video.youtubeUrl) || (!asText(video.youtubeUrl).trim() && !!extractYouTubeId(video.videoId));
        if (!hasLink) {
          error(`${base}.youtubeUrl`, 'Videos', `${label} › YouTube link`,
            'Paste a valid YouTube, YouTube Shorts or youtu.be link.');
        }
        if (typeof video.title !== 'string' || !video.title.trim()) {
          error(`${base}.title`, 'Videos', `${label} › Title`, 'Enter a video title.');
        } else if (charCount(video.title.trim()) > WEBSITE_LIMITS.videoTitle) {
          error(`${base}.title`, 'Videos', `${label} › Title`, `Keep the title under ${WEBSITE_LIMITS.videoTitle} characters.`);
        }
        if (charCount(video.description) > WEBSITE_LIMITS.videoDescription) {
          error(`${base}.description`, 'Videos', `${label} › Description`, `Keep the description under ${WEBSITE_LIMITS.videoDescription.toLocaleString('en-US')} characters.`);
        }
        if (!['SHORT', 'LONG', 'SHOWCASE'].includes(video.categoryTag)) {
          error(`${base}.categoryTag`, 'Videos', `${label} › Placement`, 'Choose where this video should appear.');
        }
        video.categoryTag === 'SHORT' ? shorts++ : showcases++;
      });
      if (shorts > WEBSITE_LIMITS.videosPerPlacement || showcases > WEBSITE_LIMITS.videosPerPlacement) {
        error('profile.socialVideos', 'Videos', 'Videos',
          `Add up to ${WEBSITE_LIMITS.videosPerPlacement} shorts and ${WEBSITE_LIMITS.videosPerPlacement} showcase videos.`);
      }
    }
  }

  // ---- Gallery & lookbook --------------------------------------------------
  const photoList = (key: 'gallery' | 'lookbookPhotos', section: string, noun: string) => {
    const list = profile[key];
    if (list === undefined) return;
    const listPath = `profile.${key}`;
    if (!Array.isArray(list) || list.length > WEBSITE_LIMITS.gallery) {
      error(listPath, section, section, `${section} must be a list of at most ${WEBSITE_LIMITS.gallery} images.`);
      return;
    }
    const ids = new Set<string>();
    list.forEach((photo: any, index: number) => {
      const base = `${listPath}[${index}]`;
      const label = `${noun} ${index + 1}${quoted(photo?.title)}`;
      if (!isObject(photo)) {
        error(base, section, label, 'This image entry is damaged. Delete it and add it again.');
        return;
      }
      if (typeof photo.id !== 'string' || !photo.id.trim()) {
        error(`${base}.id`, section, label, 'This image has no internal ID. Delete it and add it again.');
      } else if (ids.has(photo.id)) {
        error(`${base}.id`, section, label, 'Another image uses the same internal ID. Delete one of them and add it again.');
      } else {
        ids.add(photo.id);
      }
      if (!isSafeImageUrl(photo.url)) {
        error(`${base}.url`, section, `${label} › Image link`, `This image link is not valid. ${GALLERY_LINK_HELP}`);
      }
    });
  };
  photoList('gallery', 'Gallery', 'Gallery image');
  photoList('lookbookPhotos', 'Lookbook', 'Lookbook image');

  // ---- Testimonials --------------------------------------------------------
  if (profile.testimonials !== undefined) {
    const reviews = profile.testimonials;
    if (!Array.isArray(reviews) || reviews.length > WEBSITE_LIMITS.testimonials) {
      error('profile.testimonials', 'Testimonials', 'Testimonials', `Add up to ${WEBSITE_LIMITS.testimonials} testimonials.`);
    } else {
      const ids = new Set<string>();
      reviews.forEach((review: any, index: number) => {
        const base = `profile.testimonials[${index}]`;
        const label = `Testimonial ${index + 1}${quoted(review?.name)}`;
        if (!isObject(review)) {
          error(base, 'Testimonials', label, 'This testimonial is damaged. Delete it and add it again.');
          return;
        }
        if (typeof review.id !== 'string' || !review.id.trim()) {
          error(`${base}.id`, 'Testimonials', label, 'This testimonial has no internal ID. Delete it and add it again.');
        } else if (ids.has(review.id)) {
          error(`${base}.id`, 'Testimonials', label, 'Another testimonial uses the same internal ID. Delete one of them and add it again.');
        } else {
          ids.add(review.id);
        }
        if (typeof review.name !== 'string' || !review.name.trim()) {
          error(`${base}.name`, 'Testimonials', `${label} › Client name`, 'Enter the client’s name.');
        }
        if (typeof review.comment !== 'string' || !review.comment.trim()) {
          error(`${base}.comment`, 'Testimonials', `${label} › Review`, 'Enter the review text.');
        }
        if (!Number.isInteger(review.rating) || review.rating < 1 || review.rating > 5) {
          error(`${base}.rating`, 'Testimonials', `${label} › Rating`, 'Choose a whole-number rating from 1 to 5 stars.');
        }
        if (provided(review.avatarUrl) && !isSafeImageUrl(review.avatarUrl)) {
          error(`${base}.avatarUrl`, 'Testimonials', `${label} › Client photo`, `This image link is not valid. ${IMAGE_LINK_HELP}`);
        }
      });
    }
  }

  // ---- Team ----------------------------------------------------------------
  if (Array.isArray(state.stylists)) {
    const serviceIds = Array.isArray(state.services)
      ? new Set(state.services.filter(isObject).map((service: any) => service.id))
      : null;
    state.stylists.forEach((stylist: any, index: number) => {
      const base = `stylists[${index}]`;
      if (!isObject(stylist)) {
        error(base, 'Team', `Team member ${index + 1}`, 'This team member entry is damaged. Remove it and add them again.');
        return;
      }
      const label = `Team member ${index + 1}${quoted(stylist.name)}`;
      if (typeof stylist.name !== 'string' || !stylist.name.trim()) {
        // Blank drafts are simply not published (see prepareWebsiteStateForSave).
        warning(`${base}.name`, 'Team', label, 'Add a name. Team members without a name are not published on your website.');
        return;
      }
      if (provided(stylist.avatarUrl) && !isSafeImageUrl(stylist.avatarUrl)) {
        error(`${base}.avatarUrl`, 'Team', `${label} › Portrait image`, `This image link is not valid. ${IMAGE_LINK_HELP}`);
      }
      if (stylist.assignedServices !== undefined) {
        if (!Array.isArray(stylist.assignedServices)) {
          error(`${base}.assignedServices`, 'Team', `${label} › Assigned services`, 'Assigned services must be a list of your services.');
        } else if (serviceIds) {
          const unknown = stylist.assignedServices.filter((id: unknown) => !serviceIds.has(id));
          if (unknown.length) {
            error(`${base}.assignedServices`, 'Team', `${label} › Assigned services`,
              `${unknown.length === 1 ? 'One assigned service is' : `${unknown.length} assigned services are`} not on your service list (${unknown.slice(0, 3).map((id: unknown) => `“${String(id)}”`).join(', ')}). Remove the assignment or add that service.`);
          }
        }
      }
      if (stylist.schedule !== undefined && !Array.isArray(stylist.schedule)) {
        error(`${base}.schedule`, 'Team', `${label} › Weekly schedule`, 'The weekly schedule must be a list of days.');
      }
      for (const problem of scheduleProblems(stylist.schedule)) {
        error(`${base}.schedule[${problem.index}]`, 'Team', `${label} › Weekly schedule`, problem.message);
      }
    });
  }

  // ---- Services ------------------------------------------------------------
  if (Array.isArray(state.services)) {
    if (state.services.length > WEBSITE_LIMITS.services) {
      error('services', 'Services', 'Services', `A website can have up to ${WEBSITE_LIMITS.services} services.`);
    }
    const ids = new Set<string>();
    state.services.forEach((service: any, index: number) => {
      const base = `services[${index}]`;
      if (!isObject(service)) {
        error(base, 'Services', `Service ${index + 1}`, 'This service entry is damaged. Delete it and add it again.');
        return;
      }
      const label = `Service ${index + 1}${quoted(service.name)}`;
      if (typeof service.id !== 'string' || !service.id.trim()) {
        error(`${base}.id`, 'Services', label, 'This service has no internal ID. Delete it and add it again.');
      } else if (ids.has(service.id)) {
        error(`${base}.id`, 'Services', label, 'Another service uses the same internal ID. Delete one of them and add it again.');
      } else {
        ids.add(service.id);
      }
      if (typeof service.name !== 'string' || !service.name.trim()) {
        error(`${base}.name`, 'Services', `${label} › Name`, 'Enter a service name.');
      }
      const priceOk = typeof service.price === 'number' && Number.isFinite(service.price) && service.price >= 0;
      if (!priceOk) {
        error(`${base}.price`, 'Services', `${label} › Price`, 'Enter a price of 0 or more, using numbers only.');
      }
      if (provided(service.originalPrice) &&
        (typeof service.originalPrice !== 'number' || !Number.isFinite(service.originalPrice) || (priceOk && service.originalPrice < service.price))) {
        error(`${base}.originalPrice`, 'Services', `${label} › Regular price`, 'The regular price must be a number that is not lower than the sale price.');
      }
      if (!Number.isInteger(service.durationMinutes) || service.durationMinutes <= 0) {
        error(`${base}.durationMinutes`, 'Services', `${label} › Duration`, 'Enter the duration as a whole number of minutes, for example 45.');
      }
      if (provided(service.imageUrl) && !isSafeImageUrl(service.imageUrl)) {
        error(`${base}.imageUrl`, 'Services', `${label} › Image`, `This image link is not valid. ${IMAGE_LINK_HELP}`);
      }
    });
  }

  return issues;
}

/**
 * Reject invalid content before a save claims success. Returns the first
 * blocking problem as one sentence that names the field, or null. Never
 * mutates the draft.
 */
export function websiteContentError(state: any): string | null {
  const first = validateWebsiteContent(state).find((issue) => issue.severity === 'error');
  return first ? formatWebsiteIssue(first) : null;
}
