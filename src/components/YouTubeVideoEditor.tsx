import React, { useState } from 'react';
import type { SalonProfile, SocialVideo, VideoCategoryTag } from '../types';
import { getDefaultVideosForTemplate } from '../templateSocialVideos';
import { extractYouTubeId, buildYouTubeThumbnailUrl, buildYouTubeWatchUrl, buildYouTubeShortsUrl } from '../utils/youtube';

export const VIDEO_SHOWCASE_AI_PROMPT = 'Generate engaging titles and descriptions for salon video showcases (Hair Transformations, Balayage Color Process, and Keratin Treatments). Format them with active demo YouTube links or placeholder video embeds so they render directly in the Featured Showcases section of the Hair Salon template.';

export function YouTubeVideoEditor({ profile, setProfile, templateId }: {
  templateId?: SalonProfile['businessType'];
  profile: SalonProfile; setProfile: React.Dispatch<React.SetStateAction<SalonProfile>>;
}) {
  const videos = profile.socialVideos ?? [];
  const [draft, setDraft] = useState<Partial<SocialVideo> | null>(null);
  const [error, setError] = useState('');
  const [promptStatus, setPromptStatus] = useState('');
  const demoVideos = getDefaultVideosForTemplate(templateId || profile.businessType);
  const input = 'w-full rounded-lg border border-slate-300 bg-white p-2 text-sm text-slate-900';
  const addDemoVideos = () => {
    const knownIds = new Set(videos.map(video => video.id));
    const counts = { SHORT: videos.filter(video => video.categoryTag === 'SHORT').length, SHOWCASE: videos.filter(video => video.categoryTag !== 'SHORT').length };
    const additions: SocialVideo[] = [];
    for (const video of demoVideos) {
      if (knownIds.has(video.id)) continue;
      const group = video.categoryTag === 'SHORT' ? 'SHORT' : 'SHOWCASE';
      if (counts[group] >= 14) continue;
      additions.push(video);
      counts[group]++;
    }
    if (!additions.length) {
      setPromptStatus(demoVideos.some(video => !knownIds.has(video.id)) ? 'Video placement limit reached. Delete a video before adding demos.' : 'Editable demo videos are already added.');
      return;
    }
    setProfile(p => ({ ...p, socialVideos: [...(p.socialVideos ?? []), ...additions] }));
    setPromptStatus(`${additions.length} editable demo video${additions.length === 1 ? '' : 's'} added. Save & Update Website to publish.`);
  };
  const copyPrompt = async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard is not available');
      await navigator.clipboard.writeText(VIDEO_SHOWCASE_AI_PROMPT);
      setPromptStatus('AI prompt copied. Paste it into your AI Assistant or editor.');
    } catch {
      setPromptStatus('Copy is unavailable here. Select the prompt text and copy it manually.');
    }
  };
  const save = () => {
    if (draft?.id && !videos.some(v => v.id === draft.id)) { setError('This video was removed. Cancel and add a new video.'); return; }
    const videoId = extractYouTubeId(draft?.youtubeUrl);
    if (!videoId) { setError('Use a valid YouTube, Shorts or youtu.be link. File uploads and other video hosts are not supported.'); return; }
    if (!draft?.title?.trim()) { setError('Enter a video title.'); return; }
    if (videos.some(v => v.id !== draft.id && !v.isDemo && v.videoId === videoId)) { setError('This YouTube video is already added.'); return; }
    const categoryTag = draft.categoryTag || 'SHORT';
    const group = (v: Partial<SocialVideo>) => v.categoryTag === 'SHORT' ? 'SHORT' : 'SHOWCASE';
    if (videos.filter(v => v.id !== draft.id && group(v) === group(draft)).length >= 14) { setError('You can add up to 14 shorts and 14 showcases.'); return; }
    const isDemo = draft.isDemo === true && videos.find(v => v.id === draft.id)?.videoId === videoId;
    const video: SocialVideo = {
      id: draft.id || `video-${crypto.randomUUID()}`, videoId,
      youtubeUrl: categoryTag === 'SHORT' ? buildYouTubeShortsUrl(videoId) : buildYouTubeWatchUrl(videoId),
      title: draft.title.trim(), description: draft.description?.trim() || '', categoryTag,
      thumbnailUrl: isDemo ? draft.thumbnailUrl || buildYouTubeThumbnailUrl(videoId) : buildYouTubeThumbnailUrl(videoId), isOwnerVideo: !isDemo, isDemo,
    };
    setProfile(p => ({ ...p, socialVideos: draft.id
      ? (p.socialVideos ?? []).map(v => v.id === draft.id ? video : v)
      : [...(p.socialVideos ?? []), video] }));
    setDraft(null); setError('');
  };
  return <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 text-slate-900">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h3 className="font-bold">Featured Videos, Reels & Showcases</h3><p className="mt-1 text-xs text-slate-500">Add the same website videos here or from your SaaS Dashboard.</p></div>
      <button type="button" onClick={() => { setError(''); setDraft({ title: '', youtubeUrl: '', categoryTag: 'SHORT', description: '' }); }} className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white">+ Add YouTube video</button>
    </div>
    <p className="text-xs text-slate-500">YouTube links only. Use youtube.com/watch?v=…, youtube.com/shorts/… or youtu.be/…; choose Showcase or Shorts/Reels placement. Save &amp; Update Website to publish changes.</p>
    <div className="flex flex-wrap items-center gap-3 rounded-xl bg-slate-50 p-3">
      <button type="button" disabled={!demoVideos.length} onClick={addDemoVideos} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-800 disabled:opacity-50">Add editable demo videos</button>
      <span className="text-xs text-slate-500">Adds sample YouTube content without replacing your existing videos.</span>
    </div>
    <details className="rounded-xl border border-slate-200 p-3">
      <summary className="cursor-pointer text-sm font-semibold">AI content generator prompt</summary>
      <p className="mt-2 text-xs text-slate-500">Copy this into your AI Assistant or editor to generate showcase metadata.</p>
      <textarea aria-label="AI video content prompt" readOnly rows={4} className={`${input} mt-2`} value={VIDEO_SHOWCASE_AI_PROMPT} />
      <button type="button" onClick={copyPrompt} className="mt-2 rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white">Copy AI prompt</button>
    </details>
    {promptStatus && <p role="status" className="text-xs text-emerald-700">{promptStatus}</p>}
    {videos.length === 0 && <p className="text-sm text-slate-500">No videos yet. Add demo videos or use “+ Add YouTube video” to add your own.</p>}
    {draft && <div className="space-y-3 rounded-xl bg-slate-50 p-3">
      <label className="block text-xs font-bold">Video title<input aria-label="Video title" className={input} maxLength={200} value={draft.title || ''} onChange={e => setDraft({ ...draft, title: e.target.value })} /></label>
      <label className="block text-xs font-bold">YouTube link<input aria-label="YouTube link" className={input} value={draft.youtubeUrl || ''} onChange={e => setDraft({ ...draft, youtubeUrl: e.target.value })} placeholder="https://www.youtube.com/watch?v=…" /></label>
      <label className="block text-xs font-bold">Description<textarea aria-label="Video description" className={input} maxLength={2000} value={draft.description || ''} onChange={e => setDraft({ ...draft, description: e.target.value })} /></label>
      <label className="block text-xs font-bold">Placement<select aria-label="Video placement" className={input} value={draft.categoryTag} onChange={e => setDraft({ ...draft, categoryTag: e.target.value as VideoCategoryTag })}><option value="SHORT">Featured Shorts / Reels</option><option value="SHOWCASE">Featured Showcases</option><option value="LONG">Long video</option></select></label>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <div className="flex gap-3"><button type="button" onClick={save} className="rounded-lg bg-emerald-700 px-4 py-2 text-xs font-bold text-white">Apply video</button><button type="button" onClick={() => setDraft(null)} className="text-xs">Cancel</button></div>
    </div>}
    <div className="space-y-2">{videos.map(video => <div key={video.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 p-3">
      <img src={video.thumbnailUrl} alt="" className="h-14 w-20 rounded-lg object-cover" loading="lazy" />
      <div className="min-w-0 flex-1"><p className="break-words text-sm font-semibold">{video.title}</p><p className="text-xs text-slate-500">{video.categoryTag}{video.isDemo ? ' · Sample player, replace before publishing' : ''}</p></div>
      <button type="button" aria-label={`Edit ${video.title}`} onClick={() => { setDraft({ ...video }); setError(''); }} className="text-xs font-bold text-blue-700">Edit</button>
      <button type="button" aria-label={`Delete ${video.title}`} onClick={() => { setProfile(p => ({ ...p, socialVideos: (p.socialVideos ?? []).filter(v => v.id !== video.id) })); if (draft?.id === video.id) setDraft(null); }} className="text-xs font-bold text-rose-700">Delete</button>
    </div>)}</div>
  </section>;
}
