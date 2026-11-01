import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { getBackend } from '../data';
import { friendlyError, type Backend, type SessionUser } from '../data/backend';
import type { GroupSnapshot, GroupSummary, Profile } from '../lib/types';

type ToastKind = 'info' | 'success' | 'error';
interface Toast { id: number; text: string; kind: ToastKind }

interface AppCtx {
  backend: Backend;
  user: SessionUser | null;
  profile: Profile | null;
  ready: boolean;
  groups: GroupSummary[] | null;
  activeGroupId: string | null;
  setActiveGroupId: (id: string | null) => void;
  refreshGroups: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  toast: (text: string, kind?: ToastKind) => void;
  toasts: Toast[];
  unread: number;
  setUnread: (n: number) => void;
  online: boolean;
  recoveryMode: boolean;
}

const Ctx = createContext<AppCtx | null>(null);
const ACTIVE_KEY = 'la-juntada:active-group';
const CACHE_PREFIX = 'la-juntada:cache:';

export function cacheKey(...parts: string[]) {
  return CACHE_PREFIX + parts.join(':');
}
export function clearCaches() {
  Object.keys(localStorage).filter((k) => k.startsWith(CACHE_PREFIX)).forEach((k) => localStorage.removeItem(k));
}

export function AppProvider({ children }: { children: ReactNode }) {
  const backend = useMemo(() => getBackend(), []);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [ready, setReady] = useState(false);
  const [groups, setGroups] = useState<GroupSummary[] | null>(null);
  const [activeGroupId, setActive] = useState<string | null>(() => localStorage.getItem(ACTIVE_KEY));
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [unread, setUnread] = useState(0);
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  const [recoveryMode, setRecovery] = useState(() => typeof location !== 'undefined' && new URLSearchParams(location.search).has('reset'));
  const tid = useRef(0);

  const toast = useCallback((text: string, kind: ToastKind = 'info') => {
    const id = ++tid.current;
    setToasts((t) => [...t.slice(-2), { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 5200 : 3200);
  }, []);

  const setActiveGroupId = useCallback((id: string | null) => {
    setActive(id);
    if (id) localStorage.setItem(ACTIVE_KEY, id);
    else localStorage.removeItem(ACTIVE_KEY);
  }, []);

  const refreshProfile = useCallback(async () => {
    const u = await backend.getUser();
    if (!u) return setProfile(null);
    const key = cacheKey(backend.mode, u.id, 'profile');
    try {
      const p = await backend.getProfile(u.id);
      setProfile(p);
      if (p) localStorage.setItem(key, JSON.stringify(p));
    } catch {
      const c = localStorage.getItem(key);
      if (c) setProfile(JSON.parse(c));
    }
  }, [backend]);

  const refreshGroups = useCallback(async () => {
    const u = await backend.getUser();
    if (!u) return setGroups(null);
    const key = cacheKey(backend.mode, u.id, 'groups');
    try {
      const gs = await backend.listGroups();
      setGroups(gs);
      localStorage.setItem(key, JSON.stringify(gs));
    } catch (e) {
      const c = localStorage.getItem(key);
      if (c) setGroups(JSON.parse(c));
      else {
        setGroups([]);
        toast(friendlyError(e), 'error');
      }
    }
  }, [backend, toast]);

  useEffect(() => {
    let alive = true;
    backend.getUser().then((u) => {
      if (!alive) return;
      setUser(u);
      setReady(true);
    });
    const off = backend.onAuthChange((u, event) => {
      if (event === 'PASSWORD_RECOVERY') setRecovery(true);
      if (event === 'SIGNED_OUT') {
        clearCaches();
        setGroups(null);
        setProfile(null);
      }
      setUser(u);
      setReady(true);
    });
    return () => {
      alive = false;
      off();
    };
  }, [backend]);

  useEffect(() => {
    if (!user) return;
    refreshProfile();
    refreshGroups();
  }, [user, refreshGroups, refreshProfile]);

  // Si el grupo activo ya no existe, elegimos el primero.
  useEffect(() => {
    if (!groups) return;
    if (!groups.length) setActiveGroupId(null);
    else if (!activeGroupId || !groups.some((g) => g.group.id === activeGroupId)) setActiveGroupId(groups[0].group.id);
  }, [groups, activeGroupId, setActiveGroupId]);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  // Notificaciones no leídas (en tiempo real)
  useEffect(() => {
    if (!user) return;
    const load = () =>
      backend.listNotifications().then((ns) => setUnread(ns.filter((n) => !n.read_at).length)).catch(() => undefined);
    load();
    const off = backend.subscribeNotifications(user.id, load);
    return off;
  }, [backend, user]);

  const value: AppCtx = {
    backend, user, profile, ready, groups, activeGroupId, setActiveGroupId, refreshGroups, refreshProfile,
    toast, toasts, unread, setUnread, online, recoveryMode
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useApp fuera de AppProvider');
  return c;
}

/** Ejecuta una acción mostrando errores amigables. Devuelve el resultado o undefined si falló. */
export function useAction() {
  const { toast } = useApp();
  const [busy, setBusy] = useState(false);
  const run = useCallback(
    async <T,>(fn: () => Promise<T>, success?: string): Promise<T | undefined> => {
      setBusy(true);
      try {
        const r = await fn();
        if (success) toast(success, 'success');
        return r;
      } catch (e) {
        toast(friendlyError(e), 'error');
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [toast]
  );
  return { run, busy };
}

/**
 * Carga el "snapshot" de un grupo, lo mantiene sincronizado en tiempo real
 * y guarda una copia local para poder consultarlo sin conexión (solo lectura).
 */
export function useSnapshot(groupId: string | null | undefined) {
  const { backend, user } = useApp();
  const [snap, setSnap] = useState<GroupSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const key = groupId && user ? cacheKey(backend.mode, user.id, 'snap', groupId) : null;

  const reload = useCallback(async () => {
    if (!groupId || !key) return;
    try {
      const s = await backend.getSnapshot(groupId);
      setSnap(s);
      setStale(false);
      setError(null);
      try {
        localStorage.setItem(key, JSON.stringify(s));
      } catch {
        /* sin espacio: no pasa nada, solo no hay copia offline */
      }
    } catch (e) {
      const cached = localStorage.getItem(key);
      if (cached) {
        setSnap(JSON.parse(cached));
        setStale(true);
      } else setError(friendlyError(e));
    }
  }, [backend, groupId, key]);

  useEffect(() => {
    setSnap(null);
    setError(null);
    if (!groupId || !key) return;
    const cached = localStorage.getItem(key);
    if (cached) setSnap(JSON.parse(cached));
    reload();
    const off = backend.subscribeGroup(groupId, reload);
    const onFocus = () => document.visibilityState === 'visible' && reload();
    document.addEventListener('visibilitychange', onFocus);
    window.addEventListener('online', reload);
    return () => {
      off();
      document.removeEventListener('visibilitychange', onFocus);
      window.removeEventListener('online', reload);
    };
  }, [backend, groupId, key, reload]);

  return { snap, error, stale, reload };
}

/** Encuentra el grupo de una juntada (con caché) y devuelve su snapshot. */
export function useGatheringSnapshot(gatheringId: string | undefined) {
  const { backend, user } = useApp();
  const mapKey = user ? cacheKey(backend.mode, user.id, 'g2g') : null;
  const [groupId, setGroupId] = useState<string | null>(() => {
    if (!gatheringId || !mapKey) return null;
    return (JSON.parse(localStorage.getItem(mapKey) || '{}') as Record<string, string>)[gatheringId] ?? null;
  });
  const [notFound, setNotFound] = useState(false);
  useEffect(() => {
    if (!gatheringId || !mapKey) return;
    backend
      .findGroupOfGathering(gatheringId)
      .then((g) => {
        if (!g) return setNotFound(true);
        setGroupId(g);
        const m = JSON.parse(localStorage.getItem(mapKey) || '{}');
        m[gatheringId] = g;
        localStorage.setItem(mapKey, JSON.stringify(m));
      })
      .catch(() => undefined);
  }, [backend, gatheringId, mapKey]);
  const s = useSnapshot(groupId);
  const gathering = s.snap?.gatherings.find((g) => g.id === gatheringId) ?? null;
  return { ...s, gathering, notFound: notFound || (!!s.snap && !gathering) };
}
