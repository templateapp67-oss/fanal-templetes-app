import type { SalonProfile } from '../types';
import type { SaveStatus } from './autoSave';
import { normalizePublicSiteSlug } from './publicSiteUrl';
import { getSiteUrl } from './salonStore';

// ============================================================================
// "Open Site" is navigation, not a save.
//
// The button used to run a full publish first and refused to open the site when
// that publish failed ("Publish did not complete, so the live site was not
// opened"). An owner with one bad field — or a background auto-save that could
// not finish — could not even look at the website that was already live.
//
// Viewing and saving are now separate:
//
//   • Open Site is a plain link to the address that is live RIGHT NOW;
//   • Save & Update Website validates the draft and publishes it, and names the
//     exact fields that stop it (see websiteValidation.ts);
//   • when the draft is ahead of the live site a notice says so — next to the
//     link, never in front of it.
// ============================================================================

/** The address the public website is published at: what the cloud last accepted. */
export interface PublishedSiteAddress {
  subdomain: string;
  customDomain: string;
}

/**
 * The published address held by a profile the cloud has accepted or returned.
 * `null` when that profile has no address at all (nothing is published).
 */
export function publishedAddressOf(profile: Partial<SalonProfile> | null | undefined): PublishedSiteAddress | null {
  const subdomain = normalizePublicSiteSlug(profile?.subdomain);
  const customDomain = typeof profile?.customDomain === 'string' ? profile.customDomain.trim() : '';
  return subdomain || customDomain ? { subdomain, customDomain } : null;
}

/**
 * URL of the website as it is live now.
 *
 * The editor's profile may be ahead of the live site (a new address typed but
 * not saved yet, or a save that failed), and that draft address would open a
 * page that does not exist. When the cloud has confirmed an address, that one
 * wins; before the first confirmation the draft address is all there is.
 */
export function getLiveSiteUrl(profile: SalonProfile, published?: PublishedSiteAddress | null): string {
  if (!published) return getSiteUrl(profile);
  return getSiteUrl({ ...profile, subdomain: published.subdomain, customDomain: published.customDomain });
}

export const UNSAVED_CHANGES_TITLE = 'You have unsaved changes';

export type LiveSiteNoticeKind = 'failed' | 'address';

export interface LiveSiteNotice {
  kind: LiveSiteNoticeKind;
  /** Short headline of the badge. */
  title: string;
  /** What is and is not live, in plain words. */
  detail: string;
  /**
   * True when the address the editor shows is not the one Open Site opens (a new address that is not
   * live yet). The notice then names the live address so the link never seems to disagree with the card.
   */
  liveAddressDiffers: boolean;
}

export interface LiveSiteNoticeInput {
  saveStatus: SaveStatus;
  /**
   * A save is scheduled or running. That resolves by itself and the status
   * pill already says "Saving…", so a banner here would only flicker on every
   * keystroke.
   */
  busy: boolean;
  /** The address the editor currently shows (from the draft). */
  draftUrl: string;
  /** The address that is live right now. */
  liveUrl: string;
}

/**
 * What to tell the owner, next to the Open Site link, about the draft being
 * ahead of the live website. `null` when there is nothing to say. The notice
 * never disables or delays the link: it only explains what the link shows.
 */
export function getLiveSiteNotice(input: LiveSiteNoticeInput): LiveSiteNotice | null {
  if (input.busy) return null;
  const liveAddressDiffers = Boolean(input.draftUrl && input.liveUrl && input.draftUrl !== input.liveUrl);
  if (input.saveStatus === 'error') {
    return {
      kind: 'failed',
      title: UNSAVED_CHANGES_TITLE,
      detail:
        'Your last save did not go through, so your live website still shows the version you published before. '
        + 'Save again — if a field is the problem, it is marked in red.',
      liveAddressDiffers,
    };
  }
  if (liveAddressDiffers) {
    return {
      kind: 'address',
      title: UNSAVED_CHANGES_TITLE,
      detail:
        'Your new website address is not live yet — it goes live when you save. '
        + 'Open Site opens the address that is live now.',
      liveAddressDiffers,
    };
  }
  return null;
}
