/**
 * Cálculo de saldos y transferencias sugeridas (todo en centavos enteros).
 * Misma fórmula que la función SQL public.gathering_balances:
 *   net = pagado − consumido + enviado − recibido      (>0 le deben · <0 debe)
 * Solo los pagos CONFIRMADOS mueven el saldo; los informados se muestran aparte.
 */
import type { Expense, Settlement } from './types';

export interface Balance {
  participantId: string;
  paid: number;
  owed: number;
  sent: number;
  received: number;
  pendingSent: number;
  pendingReceived: number;
  /** Saldo antes de cualquier pago entre amigos */
  initialNet: number;
  /** Saldo actual (con pagos confirmados) */
  net: number;
}

export type DebtStatus = 'none' | 'pending' | 'partial' | 'settled';

export interface Transfer {
  from: string;
  to: string;
  amountCents: number;
}

export function computeBalances(
  participantIds: string[],
  expenses: Pick<Expense, 'payers' | 'splits'>[],
  settlements: Pick<Settlement, 'from_participant' | 'to_participant' | 'amount_cents' | 'status'>[]
): Balance[] {
  const map = new Map<string, Balance>();
  const get = (id: string) => {
    let b = map.get(id);
    if (!b) {
      b = { participantId: id, paid: 0, owed: 0, sent: 0, received: 0, pendingSent: 0, pendingReceived: 0, initialNet: 0, net: 0 };
      map.set(id, b);
    }
    return b;
  };
  participantIds.forEach(get);
  for (const e of expenses) {
    for (const p of e.payers) get(p.participant_id).paid += p.amount_cents;
    for (const s of e.splits) get(s.participant_id).owed += s.amount_cents;
  }
  for (const s of settlements) {
    if (s.status === 'confirmed') {
      get(s.from_participant).sent += s.amount_cents;
      get(s.to_participant).received += s.amount_cents;
    } else if (s.status === 'reported') {
      get(s.from_participant).pendingSent += s.amount_cents;
      get(s.to_participant).pendingReceived += s.amount_cents;
    }
  }
  for (const b of map.values()) {
    b.initialNet = b.paid - b.owed;
    b.net = b.initialNet + b.sent - b.received;
  }
  return [...map.values()];
}

/**
 * Propone el mínimo práctico de transferencias: empareja al que más debe con
 * al que más le deben (algoritmo voraz, a lo sumo n−1 transferencias).
 * Determinístico: a igual monto ordena por id.
 */
export function simplifyDebts(balances: { participantId: string; net: number }[]): Transfer[] {
  const debtors = balances.filter((b) => b.net < 0).map((b) => ({ id: b.participantId, amt: -b.net }));
  const creditors = balances.filter((b) => b.net > 0).map((b) => ({ id: b.participantId, amt: b.net }));
  const order = (a: { id: string; amt: number }, b: { id: string; amt: number }) => b.amt - a.amt || a.id.localeCompare(b.id);
  debtors.sort(order);
  creditors.sort(order);

  // Primero, coincidencias exactas (una sola transferencia salda a ambos).
  const out: Transfer[] = [];
  for (const d of debtors) {
    const c = creditors.find((c) => c.amt === d.amt && c.amt > 0);
    if (c && d.amt > 0) {
      out.push({ from: d.id, to: c.id, amountCents: d.amt });
      c.amt = 0;
      d.amt = 0;
    }
  }
  let i = 0;
  let j = 0;
  const ds = debtors.filter((d) => d.amt > 0);
  const cs = creditors.filter((c) => c.amt > 0);
  while (i < ds.length && j < cs.length) {
    const amt = Math.min(ds[i].amt, cs[j].amt);
    if (amt > 0) out.push({ from: ds[i].id, to: cs[j].id, amountCents: amt });
    ds[i].amt -= amt;
    cs[j].amt -= amt;
    if (ds[i].amt === 0) i++;
    if (cs[j].amt === 0) j++;
  }
  return out;
}

/** Estado de la deuda (o del crédito) de un participante. */
export function debtStatus(b: Balance): DebtStatus {
  const original = Math.abs(b.initialNet);
  const remaining = Math.abs(b.net);
  if (original === 0 && remaining === 0) return 'none';
  if (remaining === 0) return 'settled';
  if (remaining < original) return 'partial';
  return 'pending';
}

/** Estado global de la juntada. */
export function gatheringDebtStatus(balances: Balance[]): DebtStatus {
  const original = balances.reduce((a, b) => a + Math.max(0, -b.initialNet), 0);
  const remaining = balances.reduce((a, b) => a + Math.max(0, -b.net), 0);
  if (original === 0 && remaining === 0) return 'none';
  if (remaining === 0) return 'settled';
  if (remaining < original) return 'partial';
  return 'pending';
}

export const DEBT_STATUS_LABEL: Record<DebtStatus, string> = {
  none: 'Sin deudas',
  pending: 'Pendiente',
  partial: 'Parcialmente pagado',
  settled: 'Saldado'
};
