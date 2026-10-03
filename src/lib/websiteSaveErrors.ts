import { prepareWebsiteStateForSave } from './websiteContentNormalize.js';
import { BOOKING_SETTINGS_REJECTION_MESSAGE } from './bookingSettingsErrors.js';
import { WEBSITE_LIMITS, formatWebsiteIssue, type WebsiteFieldIssue } from './websiteValidation.js';

// ============================================================================
// Turning a database rejection into "which field, and what to do".
//
// `save_owner_editor_state` answers every content problem with SQLSTATE 22023
// and a one-line message. The pipeline used to collapse all of them into one
// generic toast ("…could not be validated"). Each rule below recognises one of
// those messages (current and previous migrations) and names the part of the
// editor it is about. When the editor state is available the client validator
// is re-run to pinpoint the exact item as well (see describeWebsiteSaveFailure).
//
// Keep this file free of any import from autoSave.ts — autoSave imports it.
// ============================================================================

interface ErrorRule {
  test: RegExp;
  path: string;
  section: string;
  label: string;
  message: string;
}

const LINK_HELP = 'Paste a full https:// image link or upload a JPG, PNG or WebP.';

const RULES: readonly ErrorRule[] = [
  {
    test: /invalid profile image url/i,
    path: 'profile.images', section: 'Images', label: 'Profile images',
    message: `One of your profile images (owner portrait, cover, logo, favicon or social share image) has an invalid link. ${LINK_HELP}`,
  },
  {
    test: /invalid gallery(?: image)?\b|duplicate gallery ids/i,
    path: 'profile.gallery', section: 'Gallery', label: 'Gallery',
    message: `A gallery image has an invalid link. ${LINK_HELP} To use the default image, clear the link field.`,
  },
  {
    test: /invalid lookbook image|lookbook must be an array|too many lookbook photos|duplicate lookbook ids/i,
    path: 'profile.lookbookPhotos', section: 'Lookbook', label: 'Lookbook',
    message: `A lookbook image has an invalid link. ${LINK_HELP}`,
  },
  {
    test: /invalid testimonial(?: rating| image)?\b|testimonials must be an array|too many testimonials|duplicate testimonial ids/i,
    path: 'profile.testimonials', section: 'Testimonials', label: 'Testimonials',
    message: 'A testimonial is missing the client name or the review text, has a rating outside 1–5 stars, or has an invalid client photo link.',
  },
  {
    test: /use a valid youtube link|invalid youtube video details|video (?:placement )?limit exceeded|duplicate video ids|videos must be an array/i,
    path: 'profile.socialVideos', section: 'Videos', label: 'Videos',
    message: `A video has an invalid YouTube link or no title, or there are more than ${WEBSITE_LIMITS.videosPerPlacement} shorts or showcase videos. Check every video in the list.`,
  },
  {
    test: /invalid (?:brand|favicon) colou?r/i,
    path: 'profile.primaryColor', section: 'Brand', label: 'Brand › Colours',
    message: 'A brand colour is not a valid hex colour such as #C20E5A.',
  },
  {
    test: /invalid favicon letter/i,
    path: 'profile.faviconLetter', section: 'Brand', label: 'Brand › Favicon letter',
    message: `The favicon letter can be at most ${WEBSITE_LIMITS.faviconLetter} characters.`,
  },
  {
    test: /website text exceeds allowed length/i,
    path: 'profile.ownerBio', section: 'Text', label: 'Long text',
    message: `One of your texts is too long. Limits: owner biography ${WEBSITE_LIMITS.ownerBio.toLocaleString('en-US')} characters, about text ${WEBSITE_LIMITS.about.toLocaleString('en-US')}, SEO title ${WEBSITE_LIMITS.seoTitle}, SEO description ${WEBSITE_LIMITS.seoDescription}, SEO keywords ${WEBSITE_LIMITS.seoKeywords}.`,
  },
  {
    test: /invalid website subdomain|choose a website address|invalid_website_address|use 2.63 letters/i,
    path: 'profile.subdomain', section: 'Website address', label: 'Website address',
    message: 'Use 2–63 lowercase letters, numbers or hyphens, and do not start or end with a hyphen.',
  },
  {
    // SQLSTATE 23505 from `save_owner_editor_state` ("Subdomain already in use") or the save API's
    // WEBSITE_ADDRESS_CONFLICT: the address is valid, but another salon already has it.
    test: /subdomain already in use|website address is already in use|(?:address|subdomain) is already taken|website_address_conflict|salons_(?:slug|subdomain)_key/i,
    path: 'profile.subdomain', section: 'Website address', label: 'Website address',
    message: 'This website address is already used by another salon. Choose a different one — your other changes are kept.',
  },
  {
    test: /invalid service image url/i,
    path: 'services', section: 'Services', label: 'Services › Image',
    message: `A service image has an invalid link. ${LINK_HELP}`,
  },
  {
    test: /invalid service price or duration/i,
    path: 'services', section: 'Services', label: 'Services › Price / duration',
    message: 'A service has an invalid price or duration. Use a price of 0 or more and a whole number of minutes.',
  },
  {
    test: /service name is required|service id and name required|duplicate service id/i,
    path: 'services', section: 'Services', label: 'Services › Name',
    message: 'A service has no name or shares an ID with another service. Give every service a name.',
  },
  {
    test: /staff name is required|staff id and name required|duplicate staff id/i,
    path: 'stylists', section: 'Team', label: 'Team › Name',
    message: 'A team member has no name. Add a name or remove the row.',
  },
  {
    test: /invalid staff image url/i,
    path: 'stylists', section: 'Team', label: 'Team › Portrait image',
    message: `A team member's portrait link is invalid. ${LINK_HELP}`,
  },
  {
    test: /assigned service is not available|assignedservices must be an array/i,
    path: 'stylists', section: 'Team', label: 'Team › Assigned services',
    message: 'A team member is assigned to a service that is not on your service list. Remove the assignment or add that service.',
  },
  {
    test: /invalid staff schedule|unknown schedule day|schedule must be an array|invalid input syntax for type time/i,
    path: 'stylists', section: 'Team', label: 'Team › Weekly schedule',
    message: 'A team member has a working day whose closing time is not after the opening time. Fix the hours or switch that day off.',
  },
  {
    test: /invalid input syntax for type (?:integer|numeric)/i,
    path: 'services', section: 'Numbers', label: 'Numbers',
    message: 'A number field (service price or duration, or a testimonial rating) contains something that is not a whole number.',
  },
  {
    // SQLSTATE 23514 from `salon_booking_settings` — the advance-payment check.
    // Because the website save is ONE transaction, this rejection used to look
    // like a profile or a services failure, and the toast printed the raw
    // constraint name. Named here so the owner is told the one thing that
    // actually has to change.
    test: /salon_booking_settings(?:_[a-z0-9_]*)?_check|deposit_25_check/i,
    path: 'profile.bookingSettings', section: 'Booking settings', label: 'Booking settings › Advance payment',
    message: BOOKING_SETTINGS_REJECTION_MESSAGE,
  },
];

// Anything else that says "your content was rejected" without saying which.
const GENERIC_CONTENT_REJECTION =
  /22023|22p02|invalid_website_content|check your website content|invalid (?:gallery|profile image|service|staff)|invalid workspace payload/i;

export const GENERIC_CONTENT_MESSAGE =
  'The server rejected some website content but did not say which field. Check your newest services, team members, videos and images, then save again.';

function asIssue(rule: Pick<ErrorRule, 'path' | 'section' | 'label' | 'message'>): WebsiteFieldIssue {
  return { path: rule.path, section: rule.section, label: rule.label, message: rule.message, severity: 'error' };
}

/** The field-level meaning of a database/API rejection, or null when it is not a content problem. */
export function classifyWebsiteSaveError(detail: string): WebsiteFieldIssue | null {
  const text = String(detail || '');
  for (const rule of RULES) if (rule.test.test(text)) return asIssue(rule);
  return null;
}

/** True when the failure is the server saying "your content is invalid". */
export function isWebsiteContentRejection(detail: string): boolean {
  const text = String(detail || '');
  return classifyWebsiteSaveError(text) !== null || GENERIC_CONTENT_REJECTION.test(text);
}

/**
 * Issues to show for a rejected save. With the editor state this re-runs the
 * client validator so the exact item is named ("Team member 2 (“Asha”) ›
 * Portrait image"); without it, or when the client cannot see the problem, it
 * falls back to the section the database message is about.
 */
export function describeWebsiteSaveFailure(detail: string, state?: unknown): WebsiteFieldIssue[] {
  if (!isWebsiteContentRejection(detail)) return [];
  if (state && typeof state === 'object') {
    const pinpointed = prepareWebsiteStateForSave(state).errors;
    if (pinpointed.length) return pinpointed;
  }
  const rule = classifyWebsiteSaveError(detail);
  if (rule) return [rule];
  return [{ path: 'website', section: 'Website', label: 'Website content', message: GENERIC_CONTENT_MESSAGE, severity: 'error' }];
}

/** Toast text: the first problem, named, plus how many others there are. */
export function summarizeWebsiteIssues(issues: readonly WebsiteFieldIssue[]): string {
  const errors = issues.filter((issue) => issue.severity === 'error');
  const list = errors.length ? errors : [...issues];
  if (!list.length) return '';
  const more = list.length - 1;
  return `${formatWebsiteIssue(list[0])}${more > 0 ? ` (+${more} more)` : ''}`;
}
