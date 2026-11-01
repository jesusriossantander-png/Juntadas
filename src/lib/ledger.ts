import { computeBalances, gatheringDebtStatus, simplifyDebts, type Balance, type DebtStatus, type Transfer } from './balances';
import { participantName } from './insights';
import type { Gathering, GroupSnapshot, Participant } from './types';

export interface Ledger {
  gathering: Gathering;
  participants: Participant[];
  balances: Balance[];
  byId: Record<string, Balance>;
  transfers: Transfer[];
  total: number;
  status: DebtStatus;
  name: (participantId: string) => string;
  participant: (participantId: string) => Participant | undefined;
  me: Participant | undefined;
}

export function buildLedger(snap: GroupSnapshot, gatheringId: string, userId: string | undefined): Ledger | null {
  const gathering = snap.gatherings.find((g) => g.id === gatheringId);
  if (!gathering) return null;
  const participants = snap.participants.filter((p) => p.gathering_id === gatheringId);
  const expenses = snap.expenses.filter((e) => e.gathering_id === gatheringId);
  const settlements = snap.settlements.filter((s) => s.gathering_id === gatheringId);
  const balances = computeBalances(participants.map((p) => p.id), expenses, settlements);
  const byId = Object.fromEntries(balances.map((b) => [b.participantId, b]));
  const pmap = Object.fromEntries(participants.map((p) => [p.id, p]));
  return {
    gathering,
    participants,
    balances,
    byId,
    transfers: simplifyDebts(balances),
    total: expenses.reduce((a, e) => a + e.amount_cents, 0),
    status: gatheringDebtStatus(balances),
    name: (id) => participantName(pmap[id], snap.profiles),
    participant: (id) => pmap[id],
    me: participants.find((p) => p.user_id === userId)
  };
}

export interface MyDebt {
  gathering: Gathering;
  transfer: Transfer;
  direction: 'pay' | 'receive';
  otherName: string;
}

/** Transferencias pendientes que involucran al usuario en todo el grupo. */
export function myOpenTransfers(snap: GroupSnapshot, userId: string): { items: MyDebt[]; owe: number; owed: number } {
  const items: MyDebt[] = [];
  for (const g of snap.gatherings) {
    if (g.status === 'cancelled') continue;
    const l = buildLedger(snap, g.id, userId);
    if (!l?.me) continue;
    for (const t of l.transfers) {
      if (t.from === l.me.id) items.push({ gathering: g, transfer: t, direction: 'pay', otherName: l.name(t.to) });
      else if (t.to === l.me.id) items.push({ gathering: g, transfer: t, direction: 'receive', otherName: l.name(t.from) });
    }
  }
  return {
    items,
    owe: items.filter((i) => i.direction === 'pay').reduce((a, i) => a + i.transfer.amountCents, 0),
    owed: items.filter((i) => i.direction === 'receive').reduce((a, i) => a + i.transfer.amountCents, 0)
  };
}

/** Pagos informados que esperan que el usuario (o un admin) los confirme. */
export function pendingConfirmations(snap: GroupSnapshot, userId: string) {
  const isAdmin = snap.members.some((m) => m.user_id === userId && m.role === 'admin');
  return snap.settlements.filter((s) => {
    if (s.status !== 'reported') return false;
    const to = snap.participants.find((p) => p.id === s.to_participant);
    const from = snap.participants.find((p) => p.id === s.from_participant);
    return to?.user_id === userId || (isAdmin && from?.user_id !== userId);
  });
}
