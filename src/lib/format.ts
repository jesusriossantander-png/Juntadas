// Formatos en español de Argentina.
const TZ = 'America/Argentina/Buenos_Aires';

const dtLong = new Intl.DateTimeFormat('es-AR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: TZ });
const dtShort = new Intl.DateTimeFormat('es-AR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: TZ });
const dOnly = new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: TZ });
const tOnly = new Intl.DateTimeFormat('es-AR', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
const rel = new Intl.RelativeTimeFormat('es-AR', { numeric: 'auto' });

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "Sábado 14 de noviembre, 13:30" */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return 'Fecha a definir';
  return cap(dtLong.format(new Date(iso)).replace(/, (\d)/, ', $1')).replace(' a las ', ', ');
}
/** "sáb 14 nov" */
export function formatShortDate(iso: string | null | undefined): string {
  if (!iso) return 'A definir';
  return dtShort.format(new Date(iso)).replace(/\./g, '');
}
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return dOnly.format(new Date(iso.length === 10 ? iso + 'T12:00:00Z' : iso)).replace(/\./g, '');
}
export function formatTime(iso: string | null | undefined): string {
  if (!iso) return '';
  return tOnly.format(new Date(iso));
}
export function formatRelative(iso: string, now = Date.now()): string {
  const diff = Date.parse(iso) - now;
  const abs = Math.abs(diff);
  if (abs < 60_000) return 'recién';
  if (abs < 3_600_000) return rel.format(Math.round(diff / 60_000), 'minute');
  if (abs < 86_400_000) return rel.format(Math.round(diff / 3_600_000), 'hour');
  if (abs < 30 * 86_400_000) return rel.format(Math.round(diff / 86_400_000), 'day');
  return formatDate(iso);
}

/** Valor para <input type="datetime-local"> en hora argentina. */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false
  }).formatToParts(d);
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return `${g('year')}-${g('month')}-${g('day')}T${g('hour') === '24' ? '00' : g('hour')}:${g('minute')}`;
}
/** Interpreta un datetime-local como hora argentina (UTC−3, sin horario de verano). */
export function fromLocalInput(v: string): string | null {
  if (!v) return null;
  const d = new Date(`${v}:00-03:00`);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

export function todayISODate(): string {
  return toLocalInput(new Date().toISOString()).slice(0, 10);
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('') || '?';
}

export function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}
