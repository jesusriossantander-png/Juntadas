/**
 * Recordatorios y estadísticas derivadas de un GroupSnapshot. Funciones puras.
 */
import { computeBalances } from './balances';
import type { Gathering, GroupSnapshot, Participant, Profile } from './types';

const DAY = 86_400_000;

/** Una juntada "ya ocurrió" si está realizada, o confirmada con fecha pasada. */
export function isHeld(g: Gathering, now = Date.now()): boolean {
  return !!g.starts_at && Date.parse(g.starts_at) <= now && (g.status === 'done' || g.status === 'confirmed');
}

export function isUpcoming(g: Gathering, now = Date.now()): boolean {
  if (g.status === 'proposed') return true;
  return g.status === 'confirmed' && !!g.starts_at && Date.parse(g.starts_at) > now;
}

export function lastHeld(gatherings: Gathering[], now = Date.now()): Gathering | null {
  return (
    gatherings
      .filter((g) => isHeld(g, now))
      .sort((a, b) => Date.parse(b.starts_at!) - Date.parse(a.starts_at!))[0] ?? null
  );
}

export function nextUpcoming(gatherings: Gathering[], now = Date.now()): Gathering | null {
  const ups = gatherings.filter((g) => isUpcoming(g, now));
  return (
    ups.sort((a, b) => {
      const ta = a.starts_at ? Date.parse(a.starts_at) : Infinity;
      const tb = b.starts_at ? Date.parse(b.starts_at) : Infinity;
      return ta - tb;
    })[0] ?? null
  );
}

export function daysBetween(fromIso: string, now = Date.now()): number {
  return Math.floor((now - Date.parse(fromIso)) / DAY);
}

export interface ReminderState {
  due: boolean;
  days: number;
  threshold: number;
  hasUpcoming: boolean;
  neverMet: boolean;
}

/** Misma regla que la función SQL generate_due_reminders. */
export function reminderState(
  snap: Pick<GroupSnapshot, 'gatherings' | 'settings' | 'group'>,
  now = Date.now()
): ReminderState {
  const last = lastHeld(snap.gatherings, now);
  const ref = last?.starts_at ?? snap.group.created_at;
  const days = daysBetween(ref, now);
  const hasUpcoming = snap.gatherings.some((g) => isUpcoming(g, now));
  const threshold = snap.settings.reminder_days;
  return {
    due: snap.settings.reminders_enabled && !hasUpcoming && days >= threshold,
    days,
    threshold,
    hasUpcoming,
    neverMet: !last
  };
}

export function participantName(p: Participant | undefined, profiles: Record<string, Profile>): string {
  if (!p) return 'Alguien';
  if (p.guest_name) return p.guest_name;
  const prof = p.user_id ? profiles[p.user_id] : undefined;
  return profileName(prof);
}

export function profileName(p: Profile | undefined): string {
  if (!p) return 'Ex integrante';
  return p.display_name?.trim() || p.alias?.trim() || 'Sin nombre';
}

export interface GatheringTotals {
  total: number;
  pendingCents: number;
  attendees: number;
}

export function gatheringTotals(snap: GroupSnapshot, gatheringId: string): GatheringTotals {
  const parts = snap.participants.filter((p) => p.gathering_id === gatheringId);
  const exps = snap.expenses.filter((e) => e.gathering_id === gatheringId);
  const sets = snap.settlements.filter((s) => s.gathering_id === gatheringId);
  const balances = computeBalances(parts.map((p) => p.id), exps, sets);
  return {
    total: exps.reduce((a, e) => a + e.amount_cents, 0),
    pendingCents: balances.reduce((a, b) => a + Math.max(0, -b.net), 0),
    attendees: parts.filter((p) => p.rsvp === 'yes' || exps.some((e) => e.splits.some((s) => s.participant_id === p.id))).length
  };
}

export interface MonthPoint {
  key: string; // 2026-03
  label: string; // mar 26
  total: number;
  count: number;
}

export interface GroupStats {
  heldCount: number;
  totalSpent: number;
  avgPerGathering: number;
  avgPerPerson: number;
  last: Gathering | null;
  daysSinceLast: number | null;
  next: Gathering | null;
  topOrganizers: { userId: string; count: number }[];
  attendance: { userId: string; attended: number; invited: number; rate: number }[];
  byMonth: MonthPoint[];
  byCategory: { category: string; total: number }[];
}

export interface StatsFilter {
  from?: number;
  to?: number;
}

export function groupStats(snap: GroupSnapshot, filter: StatsFilter = {}, now = Date.now()): GroupStats {
  const inRange = (g: Gathering) => {
    if (!g.starts_at) return false;
    const t = Date.parse(g.starts_at);
    return (filter.from == null || t >= filter.from) && (filter.to == null || t <= filter.to);
  };
  const held = snap.gatherings.filter((g) => isHeld(g, now) && inRange(g));
  const heldIds = new Set(held.map((g) => g.id));
  const exps = snap.expenses.filter((e) => heldIds.has(e.gathering_id));
  const totalSpent = exps.reduce((a, e) => a + e.amount_cents, 0);

  // Promedio por persona: total de cada juntada / personas que participaron del reparto.
  let personSlots = 0;
  for (const g of held) {
    const ids = new Set<string>();
    exps.filter((e) => e.gathering_id === g.id).forEach((e) => e.splits.forEach((s) => s.amount_cents > 0 && ids.add(s.participant_id)));
    personSlots += ids.size;
  }

  const organizers = new Map<string, number>();
  held.forEach((g) => g.created_by && organizers.set(g.created_by, (organizers.get(g.created_by) ?? 0) + 1));

  const attendance = snap.members.map((m) => {
    let invited = 0;
    let attended = 0;
    for (const g of held) {
      const p = snap.participants.find((x) => x.gathering_id === g.id && x.user_id === m.user_id);
      if (!p) continue;
      invited++;
      if (p.rsvp === 'yes') attended++;
    }
    return { userId: m.user_id, attended, invited, rate: invited ? attended / invited : 0 };
  });

  const months = new Map<string, MonthPoint>();
  const monthFmt = new Intl.DateTimeFormat('es-AR', { month: 'short', year: '2-digit', timeZone: 'America/Argentina/Buenos_Aires' });
  for (const g of held) {
    const d = new Date(g.starts_at!);
    const key = d.toISOString().slice(0, 7);
    const pt = months.get(key) ?? { key, label: monthFmt.format(d).replace('.', ''), total: 0, count: 0 };
    pt.count++;
    pt.total += exps.filter((e) => e.gathering_id === g.id).reduce((a, e) => a + e.amount_cents, 0);
    months.set(key, pt);
  }

  const cats = new Map<string, number>();
  exps.forEach((e) => cats.set(e.category, (cats.get(e.category) ?? 0) + e.amount_cents));

  const last = lastHeld(snap.gatherings, now);
  return {
    heldCount: held.length,
    totalSpent,
    avgPerGathering: held.length ? Math.round(totalSpent / held.length) : 0,
    avgPerPerson: personSlots ? Math.round(totalSpent / personSlots) : 0,
    last,
    daysSinceLast: last ? daysBetween(last.starts_at!, now) : null,
    next: nextUpcoming(snap.gatherings, now),
    topOrganizers: [...organizers.entries()].map(([userId, count]) => ({ userId, count })).sort((a, b) => b.count - a.count),
    attendance: attendance.sort((a, b) => b.rate - a.rate || b.attended - a.attended),
    byMonth: [...months.values()].sort((a, b) => a.key.localeCompare(b.key)),
    byCategory: [...cats.entries()].map(([category, total]) => ({ category, total })).sort((a, b) => b.total - a.total)
  };
}
