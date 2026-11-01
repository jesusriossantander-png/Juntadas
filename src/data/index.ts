import type { Backend } from './backend';
import { DemoBackend } from './demoBackend';
import { SupabaseBackend } from './supabaseBackend';

const MODE_KEY = 'la-juntada:mode';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** ¿La app fue publicada con un proyecto de Supabase configurado? */
export const supabaseConfigured = !!(SUPABASE_URL && SUPABASE_ANON_KEY && /^https?:\/\//.test(SUPABASE_URL));

export type Mode = 'supabase' | 'demo';

export function currentMode(): Mode {
  if (!supabaseConfigured) return 'demo';
  return localStorage.getItem(MODE_KEY) === 'demo' ? 'demo' : 'supabase';
}

let instance: Backend | null = null;
export function getBackend(): Backend {
  if (!instance) {
    instance = currentMode() === 'supabase' ? new SupabaseBackend(SUPABASE_URL!, SUPABASE_ANON_KEY!) : new DemoBackend();
  }
  return instance;
}

/** Cambia de modo y recarga (cada modo tiene su propia sesión y datos). */
export function switchMode(mode: Mode) {
  localStorage.setItem(MODE_KEY, mode);
  location.hash = '#/';
  location.reload();
}
