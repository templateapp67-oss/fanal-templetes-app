-- Migration: Add offers and discounts jsonb column to profiles table
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS offers jsonb DEFAULT '[]'::jsonb;
