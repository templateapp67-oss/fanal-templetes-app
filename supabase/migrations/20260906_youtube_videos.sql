-- Create table for storing salon/user YouTube videos
CREATE TABLE IF NOT EXISTS public.salon_youtube_videos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    salon_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    video_type VARCHAR(10) CHECK (video_type IN ('short', 'long')) NOT NULL,
    youtube_url TEXT NOT NULL,
    youtube_video_id VARCHAR(50) NOT NULL,
    title TEXT,
    thumbnail_url TEXT,
    description TEXT,
    like_count BIGINT DEFAULT 0,
    comment_count BIGINT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast lookup by salon_id and video_type
CREATE INDEX idx_salon_youtube_videos_salon ON public.salon_youtube_videos(salon_id, video_type);

-- RLS Policies
ALTER TABLE public.salon_youtube_videos ENABLE ROW LEVEL SECURITY;

-- Allow public read access (for template display)
CREATE POLICY "Public videos are viewable by everyone"
ON public.salon_youtube_videos FOR SELECT USING (true);

-- Allow salon owners to manage their own videos
CREATE POLICY "Owners can manage their youtube videos"
ON public.salon_youtube_videos FOR ALL
USING (auth.uid() = salon_id);
