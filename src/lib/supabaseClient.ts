import { createClient } from '@supabase/supabase-js';

// Access environment variables safely in both Vite (client) and Node.js (server)
const supabaseUrl = 
  // @ts-ignore
  (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_SUPABASE_URL) || 
  (typeof process !== 'undefined' && process.env && (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL));

const supabaseAnonKey = 
  // @ts-ignore
  (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_SUPABASE_ANON_KEY) || 
  (typeof process !== 'undefined' && process.env && (process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY));

const isRealSupabase = supabaseUrl && supabaseUrl.trim() !== '' && !supabaseUrl.includes('placeholder');

export const supabase = createClient(
  isRealSupabase ? supabaseUrl : 'https://placeholder-project.supabase.co', 
  isRealSupabase ? supabaseAnonKey : 'placeholder-key',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
    }
  }
);

// Helper to check if we should even attempt a real database call
export const isMockSupabase = !isRealSupabase;

if (isMockSupabase) {
  console.warn('Supabase keys are missing or using placeholders. App will run in mock mode with limited persistence.');
}
