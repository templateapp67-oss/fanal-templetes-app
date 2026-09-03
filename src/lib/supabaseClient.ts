import { createClient } from '@supabase/supabase-js';

// Static references are required for Vite build-time AST replacement of import.meta.env.VITE_*
const getViteEnv = () => {
  try {
    return {
      // @ts-ignore
      url: import.meta.env ? import.meta.env.VITE_SUPABASE_URL : undefined,
      // @ts-ignore
      key: import.meta.env ? import.meta.env.VITE_SUPABASE_ANON_KEY : undefined,
    };
  } catch {
    return { url: undefined, key: undefined };
  }
};

const viteEnv = getViteEnv();

const supabaseUrl = 
  viteEnv.url ||
  (typeof process !== 'undefined' && process.env && (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL));

const supabaseAnonKey = 
  viteEnv.key ||
  (typeof process !== 'undefined' && process.env && (process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY));

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be defined in environment variables');
}

export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co', 
  supabaseAnonKey || 'placeholder-key'
);

export const isMockSupabase = !supabaseUrl || !supabaseAnonKey;
