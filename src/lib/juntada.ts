/**
 * La Juntada — modelo y cálculo.
 * Cada persona carga lo que puso. Se reparte entre quienes participan:
 *  - según el tiempo que estuvo (porcentaje: 100% todo, 50% la mitad, etc.);
 *  - si se separa el alcohol, lo que se gastó en alcohol lo pagan solo los que toman
 *    (también proporcional a su porcentaje) y el resto, todos.
 * Todo al centavo exacto, con las transferencias mínimas para quedar a mano.
 */
import { allocateByWeights } from './money';
import { simplifyDebts, type Transfer } from './balances';

export interface Persona {
  id: string;
  nombre: string;
  /** Lo que puso en total, en centavos */
  puso: number;
  /** De lo que puso, cuánto fue alcohol (centavos). Solo cuenta si la juntada separa el alcohol. */
  alcohol?: number;
  /** Si toma alcohol (por defecto sí) */
  toma?: boolean;
  /** Qué parte de la juntada estuvo: 100 = toda, 50 = la mitad... (por defecto 100) */
  porcentaje?: number;
  /** Si entra en la división (alguien puede haber comprado y no venir) */
  participa: boolean;
}

export interface Juntada {
  id: string;
  fecha: string; // AAAA-MM-DD
  titulo: string;
  personas: Persona[];
  /** Si el alcohol lo pagan solo los que toman */
  separarAlcohol?: boolean;
  /** En un grupo: si este celular puede editarla (la cargó él o es administrador) */
  editable?: boolean;
  saldada: boolean;
  creada: string;
}

export interface Resultado {
  total: number;
  /** Total gastado en alcohol (0 si no se separa) */
  alcohol: number;
  participantes: number;
  /** Lo que le toca poner a cada persona (centavos), por id */
  parte: Record<string, number>;
  /** Saldo: positivo = le deben, negativo = debe */
  saldo: Record<string, number>;
  transferencias: Transfer[];
  /** Si todos pagan lo mismo, ese importe; si no, null */
  porCabeza: number | null;
  /** Advertencias para mostrar (ej. alcohol cargado pero nadie toma) */
  avisos: string[];
}

export const pct = (p: Persona) => Math.min(100, Math.max(1, Math.round(p.porcentaje ?? 100)));
export const tomaAlcohol = (p: Persona) => p.toma !== false;
/** Alcohol que puso la persona, nunca más que lo que puso en total. */
export const alcoholDe = (p: Persona) => Math.min(Math.max(0, p.alcohol ?? 0), p.puso);

function repartir(monto: number, personas: Persona[], peso: (p: Persona) => number, parte: Record<string, number>) {
  const pesos = personas.map((p) => BigInt(peso(p)));
  if (monto <= 0 || pesos.every((w) => w === 0n)) return false;
  allocateByWeights(monto, pesos).forEach((m, i) => (parte[personas[i].id] += m));
  return true;
}

export function calcular(personas: Persona[], separarAlcohol = false): Resultado {
  const avisos: string[] = [];
  const total = personas.reduce((a, p) => a + p.puso, 0);
  const part = personas.filter((p) => p.participa);
  const parte: Record<string, number> = {};
  personas.forEach((p) => (parte[p.id] = 0));

  let alcohol = separarAlcohol ? personas.reduce((a, p) => a + alcoholDe(p), 0) : 0;
  if (alcohol > 0 && !part.some(tomaAlcohol)) {
    avisos.push('Hay alcohol cargado pero nadie toma: se reparte entre todos.');
    alcohol = 0;
  }
  if (part.length) {
    repartir(total - alcohol, part, pct, parte);
    repartir(alcohol, part, (p) => (tomaAlcohol(p) ? pct(p) : 0), parte);
  }

  const saldo: Record<string, number> = {};
  personas.forEach((p) => (saldo[p.id] = p.puso - parte[p.id]));
  const transferencias = part.length ? simplifyDebts(personas.map((p) => ({ participantId: p.id, net: saldo[p.id] }))) : [];
  const partes = part.map((p) => parte[p.id]);
  const iguales = partes.length > 0 && Math.max(...partes) - Math.min(...partes) <= 1;
  return {
    total,
    alcohol,
    participantes: part.length,
    parte,
    saldo,
    transferencias,
    porCabeza: iguales ? Math.floor(total / part.length) : null,
    avisos
  };
}

// ------------------------------------------------------------- registro local
export interface Datos {
  version: 1;
  juntadas: Juntada[];
  amigos: string[];
  avisoDias: number;
}

const KEY = 'la-juntada:datos:v1';
export const DATOS_VACIOS: Datos = { version: 1, juntadas: [], amigos: [], avisoDias: 30 };

export function cargar(): Datos {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DATOS_VACIOS };
    return validar(JSON.parse(raw));
  } catch {
    return { ...DATOS_VACIOS };
  }
}

export function guardar(d: Datos) {
  try {
    localStorage.setItem(KEY, JSON.stringify(d));
  } catch {
    /* sin espacio o bloqueado: se mantiene en memoria */
  }
}

/** Valida un respaldo importado (o lo guardado) y descarta lo que no tenga forma correcta. */
export function validar(x: unknown): Datos {
  const o = (x ?? {}) as Partial<Datos>;
  const juntadas = Array.isArray(o.juntadas)
    ? o.juntadas
        .filter((j) => j && typeof j.id === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(j.fecha) && Array.isArray(j.personas))
        .map((j) => ({
          id: j.id,
          fecha: j.fecha,
          titulo: String(j.titulo ?? '').slice(0, 80),
          separarAlcohol: !!j.separarAlcohol,
          ...(typeof j.editable === 'boolean' ? { editable: j.editable } : {}),
          saldada: !!j.saldada,
          creada: String(j.creada ?? new Date().toISOString()),
          personas: j.personas
            .filter((p) => p && typeof p.nombre === 'string' && Number.isSafeInteger(p.puso) && p.puso >= 0)
            .map((p) => ({
              id: String(p.id ?? crypto.randomUUID()), nombre: p.nombre.slice(0, 40), puso: p.puso, participa: p.participa !== false,
              alcohol: Number.isSafeInteger(p.alcohol) && p.alcohol! > 0 ? Math.min(p.alcohol!, p.puso) : 0,
              toma: p.toma !== false,
              porcentaje: Number.isFinite(p.porcentaje) ? Math.min(100, Math.max(1, Math.round(p.porcentaje!))) : 100
            }))
        }))
    : [];
  const amigos = Array.isArray(o.amigos) ? o.amigos.filter((a) => typeof a === 'string').map((a) => a.slice(0, 40)) : [];
  const avisoDias = Number.isInteger(o.avisoDias) && o.avisoDias! >= 1 && o.avisoDias! <= 365 ? o.avisoDias! : 30;
  return { version: 1, juntadas, amigos: [...new Set(amigos)], avisoDias };
}

// ------------------------------------------------------------- recordatorio
const DIA = 86_400_000;

/** Días desde la última juntada registrada (null si no hay ninguna). */
export function diasSinJuntarse(juntadas: Juntada[], hoy = new Date()): number | null {
  if (!juntadas.length) return null;
  const fechas = juntadas.map((j) => j.fecha).sort();
  const ultima = fechas[fechas.length - 1];
  const desde = Date.parse(`${ultima}T12:00:00Z`);
  const ahora = Date.parse(`${fechaLocal(hoy)}T12:00:00Z`);
  return Math.max(0, Math.round((ahora - desde) / DIA));
}

export function tocaJuntarse(d: Datos, hoy = new Date()): number | null {
  const dias = diasSinJuntarse(d.juntadas, hoy);
  return dias != null && dias >= d.avisoDias ? dias : null;
}

/** Fecha AAAA-MM-DD en la zona horaria del dispositivo. */
export function fechaLocal(d = new Date()): string {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60_000);
  return z.toISOString().slice(0, 10);
}

/** Recuerda nombres para cargarlos rápido la próxima vez. */
export function sumarAmigos(amigos: string[], nombres: string[]): string[] {
  const set = new Map(amigos.map((a) => [a.toLowerCase(), a]));
  nombres.map((n) => n.trim()).filter(Boolean).forEach((n) => set.has(n.toLowerCase()) || set.set(n.toLowerCase(), n));
  return [...set.values()];
}
