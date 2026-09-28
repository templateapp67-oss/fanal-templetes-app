import React, { useState } from 'react';
import { Play, X, ExternalLink } from 'lucide-react';
import type { SocialVideo } from '../types';
import { buildYouTubeEmbedUrl, buildYouTubeWatchUrl, resolveYouTubeVideoId } from '../utils/youtube';

export function WebsiteVideoShowcase({ videos, dark = false }: { videos: SocialVideo[]; dark?: boolean }) {
  const [playing, setPlaying] = useState<string | null>(null);
  const groups = [
    { title: 'Featured Shorts', items: videos.filter(v => v.categoryTag === 'SHORT'), short: true },
    { title: 'Featured Showcases', items: videos.filter(v => v.categoryTag !== 'SHORT'), short: false },
  ];
  return <div className="space-y-10">
    {groups.map(group => group.items.length > 0 && <div key={group.title}>
      <div className="mb-5 flex items-center gap-3"><span className="h-2 w-2 rounded-full bg-rose-500" /><h3 className="text-xl font-bold">{group.title}</h3><span className="text-xs opacity-60">{group.items.length} videos</span></div>
      <div className={`grid gap-5 ${group.short ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3' : 'grid-cols-1 md:grid-cols-2'}`}>
        {group.items.map(video => {
          const id = resolveYouTubeVideoId(video.videoId, video.youtubeUrl);
          return <article key={video.id} className={`overflow-hidden rounded-2xl border ${dark ? 'border-neutral-700 bg-neutral-950' : 'border-slate-200 bg-slate-50'}`}>
            <div className={`relative overflow-hidden bg-slate-950 ${group.short ? 'min-h-[320px] aspect-[9/16]' : 'aspect-video'}`}>
              {playing === video.id && id ? <>
                <iframe title={video.title} src={buildYouTubeEmbedUrl(id, { autoplay: true, playsinline: true })} className="absolute inset-0 h-full w-full" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" />
                <button type="button" aria-label={`Close ${video.title}`} onClick={() => setPlaying(null)} className="absolute right-2 top-2 rounded-full bg-black p-2 text-white"><X size={16} /></button>
              </> : <button type="button" disabled={!id} aria-label={`Play ${video.title}`} onClick={() => setPlaying(video.id)} className="group absolute inset-0 h-full w-full text-left">
                <img src={video.thumbnailUrl} alt={video.title} loading="lazy" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent" />
                <span className="absolute inset-0 flex items-center justify-center"><span className="rounded-full border border-white/60 bg-white/20 p-5 text-white backdrop-blur-sm"><Play className="h-7 w-7 fill-current" /></span></span>
                <span className="absolute bottom-4 left-4 rounded-full bg-black/60 px-3 py-1 text-xs font-bold text-white">{video.isDemo ? 'DEMO · Sample player' : 'Watch on YouTube'}</span>
              </button>}
            </div>
            <div className="space-y-2 p-5"><h4 className="font-bold leading-snug">{video.title}</h4>{video.description && <p className="text-sm leading-relaxed opacity-70">{video.description}</p>}
              {id && <a href={buildYouTubeWatchUrl(id)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold underline">Open on YouTube <ExternalLink size={12} /></a>}
            </div>
          </article>;
        })}
      </div>
    </div>)}
  </div>;
}
