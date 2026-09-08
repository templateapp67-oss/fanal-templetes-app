import type { Request, Response } from 'express';
import { getYouTubeDetails, type YouTubeDetails } from '../src/utils/youtube.js';
import {
  createYouTubeMetadata,
  mergeYouTubeMetadata,
  withOptionalYouTubeMetadata,
  YOUTUBE_METADATA_TIMEOUT_MS,
  type YouTubeMetadata,
} from '../src/utils/youtubeMetadata.js';

interface ServerYouTubeMetadata extends YouTubeMetadata {
  source: 'local_fallback' | 'youtube_data_api' | 'oembed_fallback';
}

// Leave room for the round trip inside the browser's four-second deadline.
export const SERVER_YOUTUBE_METADATA_TIMEOUT_MS = YOUTUBE_METADATA_TIMEOUT_MS - 500;

export async function enrichServerYouTubeMetadata(
  video: YouTubeDetails,
  fallbackTitle: unknown,
  apiKey = '',
): Promise<ServerYouTubeMetadata> {
  const fallback: ServerYouTubeMetadata = {
    ...createYouTubeMetadata(video, fallbackTitle),
    source: 'local_fallback',
  };

  return withOptionalYouTubeMetadata<ServerYouTubeMetadata>(fallback, async (signal) => {
    if (apiKey && apiKey !== 'YOUR_YOUTUBE_DATA_API_KEY') {
      try {
        const params = new URLSearchParams({ id: video.videoId, part: 'snippet,statistics', key: apiKey });
        const response = await fetch(`https://www.googleapis.com/youtube/v3/videos?${params}`, { signal });
        if (response.ok) {
          const data = await response.json();
          const item = Array.isArray(data?.items) ? data.items[0] : null;
          const snippet = item?.snippet;
          if (typeof snippet?.title === 'string' && snippet.title.trim()) {
            const thumbnails = snippet.thumbnails;
            return {
              ...mergeYouTubeMetadata(fallback, {
                title: snippet.title,
                description: snippet.description,
                thumbnailUrl: [thumbnails?.maxres?.url, thumbnails?.high?.url, thumbnails?.default?.url]
                  .find((url) => typeof url === 'string' && url.trim()),
                likeCount: item.statistics?.likeCount,
                commentCount: item.statistics?.commentCount,
              }),
              source: 'youtube_data_api',
            };
          }
        }
      } catch {
        // A bad/missing API key, quota, network or JSON error can still use oEmbed.
      }
    }

    if (signal.aborted) return fallback;
    // Always ask oEmbed about the canonical watch URL, never a raw share/Shorts URL.
    const params = new URLSearchParams({ url: fallback.youtubeUrl, format: 'json' });
    const response = await fetch(`https://www.youtube.com/oembed?${params}`, { signal });
    if (!response.ok) return fallback;

    const data = await response.json();
    if (typeof data?.title !== 'string' || !data.title.trim()) return fallback;
    const author = typeof data.author_name === 'string' ? data.author_name.trim() : '';
    return {
      ...mergeYouTubeMetadata(fallback, {
        title: data.title,
        description: author ? `By ${author}` : '',
      }),
      source: 'oembed_fallback',
    };
  }, SERVER_YOUTUBE_METADATA_TIMEOUT_MS);
}

/** Shared by the Express dev server and the production/serverless API. */
export async function handleFetchYouTubeMetadata(req: Request, res: Response) {
  const { youtubeUrl, fallbackTitle } = req.body ?? {};
  if (typeof youtubeUrl !== 'string' || !youtubeUrl.trim()) {
    return res.status(400).json({ success: false, notice: 'youtubeUrl is required.' });
  }

  const video = getYouTubeDetails(youtubeUrl);
  if (!video) {
    return res.status(400).json({ success: false, notice: 'Invalid YouTube URL. Supported formats: youtube.com/watch?v=..., youtube.com/shorts/..., youtu.be/..., youtube.com/embed/...' });
  }

  const metadata = await enrichServerYouTubeMetadata(
    video,
    fallbackTitle,
    process.env.YOUTUBE_API_KEY || process.env.YOUTUBE_DATA_API_KEY || '',
  );
  return res.json({
    success: true,
    ...metadata,
    notice: metadata.source === 'local_fallback' ? 'YouTube metadata is unavailable; using fallback details.' : '',
  });
}
