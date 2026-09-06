/**
 * Shared YouTube URL helpers for the Nexora website builder.
 *
 * These helpers are isomorphic (no DOM / window / process.env access) so they
 * can be imported safely from browser components AND from the Node API routes
 * (server.ts / api/index.ts).
 *
 * The goal is one robust source of truth for turning any supported YouTube
 * link into a clean 11-character video id, plus builders for the canonical
 * watch / shorts / embed / thumbnail URLs used across the editor, preview,
 * and public site.
 */

/** Regex for a bare, valid 11-character YouTube video id. */
export const YOUTUBE_VIDEO_ID_REGEX = /^[A-Za-z0-9_-]{11}$/;

// Precise extraction patterns. Each capture group (1) is guaranteed to be an
// 11-character video id by construction ({11} + a non-id boundary lookahead),
// so no post-filtering is required for these matches.
const YOUTUBE_ID_PATTERNS: RegExp[] = [
  // Standard watch URL with v anywhere in the query string:
  //   https://www.youtube.com/watch?v=VIDEO_ID
  //   https://youtube.com/watch?si=abc&feature=shared&v=VIDEO_ID
  /(?:www\.|m\.|music\.|gaming\.)?(?:youtube\.com|youtube-nocookie\.com)\/watch\?(?:[^#\s]*&)?v=([A-Za-z0-9_-]{11})(?=$|[?#&/])/i,
  // Path-style URLs:
  //   https://youtube.com/shorts/VIDEO_ID
  //   https://www.youtube.com/embed/VIDEO_ID
  //   https://www.youtube.com/v/VIDEO_ID | /live/VIDEO_ID | /e/VIDEO_ID
  /(?:www\.|m\.|music\.|gaming\.)?(?:youtube\.com|youtube-nocookie\.com)\/(?:shorts|embed|live|v|e)\/([A-Za-z0-9_-]{11})(?=$|[?#/])/i,
  // Shortened share URL:
  //   https://youtu.be/VIDEO_ID
  //   https://youtu.be/VIDEO_ID?si=...
  /(?:^|[^A-Za-z0-9_-])(?:www\.|m\.)?youtu\.be\/([A-Za-z0-9_-]{11})(?=$|[?#/])/i,
];

// Loose fallback inspired by the canonical YouTube regex:
//   /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|shorts\/|watch\?v=|\&v=)([^#\&\?]*).*/
// It intentionally still requires the 11-char token to end on a delimiter so a
// longer run of [A-Za-z0-9_-] never produces a wrong "id".
const LOOSE_YOUTUBE_ID_PATTERN =
  /^.*(?:youtu\.be\/|v\/|u\/\w+\/|embed\/|shorts\/|live\/|watch\?v=|&v=|\bv=)([A-Za-z0-9_-]{11})(?:[^A-Za-z0-9_-].*)?$/i;

/**
 * Extracts the 11-character YouTube video id from any supported link format:
 *
 *   Standard:  https://www.youtube.com/watch?v=VIDEO_ID
 *   Shortened: https://youtu.be/VIDEO_ID
 *   Shorts:    https://youtube.com/shorts/VIDEO_ID
 *   Embed:     https://www.youtube.com/embed/VIDEO_ID
 *   Path:      https://www.youtube.com/v/VIDEO_ID, /live/VIDEO_ID ...
 *
 * Extra query parameters (?si=..., &feature=shared, &t=..., #fragment, ...)
 * are handled and ignored. Returns null when the URL is not a valid YouTube
 * link (or does not contain an exactly 11-character video id).
 */
export function extractYouTubeId(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const url = input.trim();
  if (!url) return null;

  for (const pattern of YOUTUBE_ID_PATTERNS) {
    const match = url.match(pattern);
    if (match && match[1]) return match[1];
  }

  // The loose fallback only runs for URLs that clearly belong to YouTube,
  // otherwise a random "watch?v=..." on another site would be misread.
  const belongsToYouTube =
    /(?:^|[^A-Za-z0-9-])(?:youtu\.be|youtube(?:-nocookie)?\.com)/i.test(url);
  if (belongsToYouTube) {
    const looseMatch = url.match(LOOSE_YOUTUBE_ID_PATTERN);
    if (looseMatch && looseMatch[1]) return looseMatch[1];
  }

  return null;
}

/** True when the value is a YouTube link that yields an 11-char video id. */
export function isValidYouTubeUrl(input: unknown): boolean {
  return extractYouTubeId(input) !== null;
}

/** True when the value is already a bare 11-char video id. */
export function isYouTubeVideoId(value: unknown): value is string {
  return typeof value === 'string' && YOUTUBE_VIDEO_ID_REGEX.test(value);
}

/**
 * Resolves the video id to use for playback. Prefers a clean stored video id
 * and falls back to extracting one from the original URL — useful for older
 * rows that were saved before URL normalization existed.
 */
export function resolveYouTubeVideoId(videoId: unknown, youtubeUrl?: unknown): string | null {
  if (isYouTubeVideoId(videoId)) return videoId;
  return extractYouTubeId(youtubeUrl);
}

/** Canonical clean watch URL: https://www.youtube.com/watch?v=VIDEO_ID */
export function buildYouTubeWatchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

/** Canonical clean Shorts URL: https://www.youtube.com/shorts/VIDEO_ID */
export function buildYouTubeShortsUrl(videoId: string): string {
  return `https://www.youtube.com/shorts/${videoId}`;
}

export interface YouTubeEmbedOptions {
  /** autoplay=1 — plays immediately when the player loads. */
  autoplay?: boolean;
  /** mute=1 — required by browsers for autoplay to be allowed. */
  mute?: boolean;
  /** loop=1 (+ playlist so YouTube actually honors it). */
  loop?: boolean;
  /** controls=1/0 — show or hide the player controls. */
  controls?: boolean;
  /** rel=0/1 — related video behavior. */
  rel?: 0 | 1;
  /** start seconds — begin playback at a timestamp. */
  start?: number;
  /** playsinline=1 — inline playback on mobile instead of fullscreen. */
  playsinline?: boolean;
}

/**
 * Builds the iframe-friendly embed URL used for live preview and the public
 * site: https://www.youtube.com/embed/VIDEO_ID?...
 *
 * Returns an empty string when no usable video id is given so callers can skip
 * rendering a broken player.
 */
export function buildYouTubeEmbedUrl(videoId: string, options: YouTubeEmbedOptions = {}): string {
  const id = (videoId || '').trim();
  if (!id || !YOUTUBE_VIDEO_ID_REGEX.test(id)) return '';

  const query = new URLSearchParams();
  if (typeof options.autoplay === 'boolean') query.set('autoplay', options.autoplay ? '1' : '0');
  if (options.mute) query.set('mute', '1');
  if (options.controls !== undefined) query.set('controls', options.controls ? '1' : '0');
  if (options.rel !== undefined) query.set('rel', String(options.rel));
  if (options.start !== undefined) query.set('start', String(Math.max(0, Math.floor(options.start))));
  if (options.playsinline) query.set('playsinline', '1');
  if (options.loop) {
    query.set('loop', '1');
    // YouTube only honours loop=1 when a playlist is supplied.
    query.set('playlist', id);
  }

  const qs = query.toString();
  return qs ? `https://www.youtube.com/embed/${id}?${qs}` : `https://www.youtube.com/embed/${id}`;
}

export type YouTubeThumbnailQuality =
  | 'default'
  | 'mqdefault'
  | 'hqdefault'
  | 'sddefault'
  | 'maxresdefault';

/** img.youtube.com thumbnail URL for a clean video id. */
export function buildYouTubeThumbnailUrl(
  videoId: string,
  quality: YouTubeThumbnailQuality = 'hqdefault'
): string {
  return `https://img.youtube.com/vi/${videoId}/${quality}.jpg`;
}

/** Standard iframe `allow` attribute value for YouTube embeds. */
export const YOUTUBE_IFRAME_ALLOW =
  'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture';
