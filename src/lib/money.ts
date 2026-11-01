/**
 * Dinero con precisión exacta.
 * Todos los importes se manejan como enteros de CENTAVOS (number seguro hasta 2^53).
 * Los repartos usan aritmética BigInt y el método del "mayor resto",
 * de modo que la suma de las partes es SIEMPRE exactamente el total.
 */

export type SplitMethod = 'equal' | 'percent' | 'amount' | 'weight';

const SHARE_SCALE = 10_000n; // las participaciones admiten hasta 4 decimales (numeric(14,4))

const formatters = new Map<string, Intl.NumberFormat>();
function fmt(currency: string, decimals: boolean) {
  const key = `${currency}-${decimals}`;
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.NumberFormat('es-AR', {
      style: 'currency',
      currency,
      minimumFractionDigits: decimals ? 2 : 0,
      maximumFractionDigits: decimals ? 2 : 0
    });
    formatters.set(key, f);
  }
  return f;
}

/** 5000000 → "$ 50.000" ; 1050 → "$ 10,50" */
export function formatMoney(cents: number, currency = 'ARS', opts: { forceDecimals?: boolean } = {}): string {
  const hasCents = cents % 100 !== 0;
  return fmt(currency, opts.forceDecimals || hasCents).format(cents / 100).replace(/ /g, ' ');
}

/**
 * Interpreta lo que escribe una persona en Argentina:
 * "50.000" → 5000000 · "50000" → 5000000 · "1.234,56" → 123456 · "10,5" → 1050 · "$ 2.500" → 250000
 * Devuelve null si no es un importe válido.
 */
export function parseMoney(input: string): number | null {
  if (input == null) return null;
  let s = String(input).trim().replace(/\s|\$|ARS/gi, '');
  if (!s) return null;
  if (!/^[\d.,]+$/.test(s)) return null;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  let intPart: string;
  let decPart = '';
  if (lastComma >= 0) {
    // La coma es el separador decimal argentino; los puntos son de miles.
    intPart = s.slice(0, lastComma).replace(/\./g, '');
    decPart = s.slice(lastComma + 1);
    if (decPart.includes('.') || intPart.includes(',')) return null;
  } else if (lastDot >= 0) {
    const groups = s.split('.');
    const tail = groups[groups.length - 1];
    // "1.500" o "1.500.000" → miles. "10.5" / "10.50" → decimal (teclado numérico de algunos celulares).
    if (groups.length > 1 && groups.slice(1).every((g) => g.length === 3)) {
      intPart = groups.join('');
    } else if (groups.length === 2 && tail.length <= 2) {
      intPart = groups[0];
      decPart = tail;
    } else {
      return null;
    }
  } else {
    intPart = s;
  }
  if (!/^\d*$/.test(intPart) || !/^\d{0,2}$/.test(decPart)) return null;
  if (intPart === '' && decPart === '') return null;
  const cents = Number(intPart || '0') * 100 + Number((decPart + '00').slice(0, 2));
  if (!Number.isSafeInteger(cents)) return null;
  return cents;
}

/** Convierte "33,3333" o 33.3333 en un entero escalado ×10.000 (sin pasar por float para strings). */
export function toScaledShare(value: number | string): bigint {
  const s = typeof value === 'number' ? value.toFixed(4) : value.trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error('Valor de participación inválido');
  const [i, d = ''] = s.split('.');
  return BigInt(i) * SHARE_SCALE + BigInt((d + '0000').slice(0, 4));
}

/**
 * Reparte `totalCents` en proporción a `weights` (enteros escalados) por mayor resto.
 * Desempata por orden de aparición, así el resultado es determinístico.
 */
export function allocateByWeights(totalCents: number, weights: bigint[]): number[] {
  if (!Number.isSafeInteger(totalCents) || totalCents < 0) throw new Error('Total inválido');
  const W = weights.reduce((a, b) => a + b, 0n);
  if (weights.some((w) => w < 0n)) throw new Error('Las participaciones no pueden ser negativas');
  if (W === 0n) throw new Error('Tiene que participar al menos una persona');
  const T = BigInt(totalCents);
  const base = weights.map((w) => (T * w) / W);
  const rema = weights.map((w, i) => ({ i, r: (T * w) % W }));
  let left = T - base.reduce((a, b) => a + b, 0n);
  rema.sort((a, b) => (a.r === b.r ? a.i - b.i : a.r > b.r ? -1 : 1));
  for (let k = 0; left > 0n; k++, left--) base[rema[k].i] += 1n;
  return base.map(Number);
}

export interface SplitInput {
  participantId: string;
  /** equal: ignorado (incluido = participa) · percent: % · weight: proporción · amount: centavos */
  value: number | string;
}

export interface SplitResult {
  participantId: string;
  share: number;
  amountCents: number;
}

export class SplitError extends Error {}

/** Calcula el reparto exacto de un gasto según el método elegido. */
export function computeSplit(totalCents: number, method: SplitMethod, items: SplitInput[]): SplitResult[] {
  if (items.length === 0) throw new SplitError('Elegí entre quiénes se divide el gasto');
  if (new Set(items.map((i) => i.participantId)).size !== items.length) {
    throw new SplitError('Hay participantes repetidos');
  }
  if (!Number.isSafeInteger(totalCents) || totalCents <= 0) throw new SplitError('El importe debe ser mayor a cero');

  switch (method) {
    case 'equal': {
      const amounts = allocateByWeights(totalCents, items.map(() => 1n));
      return items.map((it, k) => ({ participantId: it.participantId, share: 1, amountCents: amounts[k] }));
    }
    case 'percent': {
      const w = items.map((it) => toScaledShare(it.value));
      const sum = w.reduce((a, b) => a + b, 0n);
      if (sum < 100n * SHARE_SCALE - 100n || sum > 100n * SHARE_SCALE + 100n) {
        throw new SplitError(`Los porcentajes suman ${(Number(sum) / 10000).toLocaleString('es-AR')}% y deben sumar 100%`);
      }
      const amounts = allocateByWeights(totalCents, w);
      return items.map((it, k) => ({ participantId: it.participantId, share: Number(w[k]) / 10000, amountCents: amounts[k] }));
    }
    case 'weight': {
      const w = items.map((it) => toScaledShare(it.value));
      if (w.every((x) => x === 0n)) throw new SplitError('Las proporciones deben ser mayores a cero');
      const amounts = allocateByWeights(totalCents, w);
      return items.map((it, k) => ({ participantId: it.participantId, share: Number(w[k]) / 10000, amountCents: amounts[k] }));
    }
    case 'amount': {
      const amounts = items.map((it) => {
        const v = typeof it.value === 'number' ? it.value : parseMoney(it.value);
        if (v == null || !Number.isSafeInteger(v) || v < 0) throw new SplitError('Hay montos inválidos');
        return v;
      });
      const sum = amounts.reduce((a, b) => a + b, 0);
      if (sum !== totalCents) {
        const diff = totalCents - sum;
        throw new SplitError(
          diff > 0 ? `Faltan asignar ${formatMoney(diff)}` : `Te pasaste por ${formatMoney(-diff)}`
        );
      }
      return items.map((it, k) => ({ participantId: it.participantId, share: amounts[k], amountCents: amounts[k] }));
    }
  }
}

export const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
