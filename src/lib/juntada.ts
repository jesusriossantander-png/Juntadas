/**
 * La Juntada — modelo y cálculo.
 * Una juntada es una lista de personas con lo que puso cada una.
 * El total se divide en partes iguales entre quienes participan (al centavo exacto)
 * y se proponen las transferencias mínimas para quedar a mano.
 */
import { allocateByWeights } from './money';
import { simplifyDebts, type Transfer } from './balances';

export interface Persona {
  id: string;
  nombre: string;
  /** Lo que puso, en centavos */
  puso: number;
  /** Si entra en la división (alguien puede haber comprado y no venir) */
  participa: boolean;
}

export interface Juntada {
  id: string;
  fecha: string; // AAAA-MM-DD
  titulo: string;
  personas: Persona[];
  saldada: boolean;
  creada: string;
}

export interface Resultado {
  total: number;
  participantes: number;
  /** Lo que le toca poner a cada persona (centavos), por id */
  parte: Record<string, number>;
  /** Saldo: positivo = le deben, negativo = debe */
  saldo: Record<string, number>;
  transferencias: Transfer[];
  /** Importe "por cabeza" de referencia (puede variar en 1 centavo entre personas) */
  porCabeza: number;
}

export function calcular(personas: Persona[]): Resultado {
  const total = personas.reduce((a, p) => a + p.puso, 0);
  const part = personas.filter((p) => p.participa);
  const parte: Record<string, number> = {};
  personas.forEach((p) => (parte[p.id] = 0));
  if (total > 0 && part.length > 0) {
    const montos = allocateByWeights(total, part.map(() => 1n));
    part.forEach((p, i) => (parte[p.id] = montos[i]));
  }
  const saldo: Record<string, number> = {};
  personas.forEach((p) => (saldo[p.id] = p.puso - parte[p.id]));
  // Si nadie participa no hay nada que repartir.
  const transferencias = part.length ? simplifyDebts(personas.map((p) => ({ participantId: p.id, net: saldo[p.id] }))) : [];
  return {
    total,
    participantes: part.length,
    parte,
    saldo,
    transferencias,
    porCabeza: part.length ? Math.floor(total / part.length) : 0
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
          saldada: !!j.saldada,
          creada: String(j.creada ?? new Date().toISOString()),
          personas: j.personas
            .filter((p) => p && typeof p.nombre === 'string' && Number.isSafeInteger(p.puso) && p.puso >= 0)
            .map((p) => ({ id: String(p.id ?? crypto.randomUUID()), nombre: p.nombre.slice(0, 40), puso: p.puso, participa: p.participa !== false }))
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
