import { describe, expect, it } from 'vitest';
import { allocateByWeights, computeSplit, formatMoney, parseMoney, SplitError } from './money';
import { computeBalances, debtStatus, gatheringDebtStatus, simplifyDebts } from './balances';
import type { Expense, Settlement } from './types';

const exp = (payers: [string, number][], splits: [string, number][]): Pick<Expense, 'payers' | 'splits'> => ({
  payers: payers.map(([participant_id, amount_cents]) => ({ expense_id: 'e', participant_id, amount_cents })),
  splits: splits.map(([participant_id, amount_cents]) => ({ expense_id: 'e', participant_id, amount_cents, share: 1 }))
});
const set = (from: string, to: string, amount_cents: number, status: Settlement['status'] = 'confirmed') => ({
  from_participant: from, to_participant: to, amount_cents, status
});
const equal = (total: number, ids: string[]) => computeSplit(total, 'equal', ids.map((participantId) => ({ participantId, value: 1 })));

describe('formato y lectura de importes (es-AR)', () => {
  it('formatea en pesos argentinos', () => {
    expect(formatMoney(5_000_000)).toBe('$ 50.000');
    expect(formatMoney(123_456)).toBe('$ 1.234,56');
    expect(formatMoney(-2_500_000)).toBe('-$ 25.000');
  });
  it('interpreta lo que escribe la gente', () => {
    expect(parseMoney('50.000')).toBe(5_000_000);
    expect(parseMoney('50000')).toBe(5_000_000);
    expect(parseMoney('$ 1.234,56')).toBe(123_456);
    expect(parseMoney('10,5')).toBe(1_050);
    expect(parseMoney('10.50')).toBe(1_050);
    expect(parseMoney('1.500.000')).toBe(150_000_000);
    expect(parseMoney('0,01')).toBe(1);
    expect(parseMoney('abc')).toBeNull();
    expect(parseMoney('1,2,3')).toBeNull();
    expect(parseMoney('10,555')).toBeNull();
    expect(parseMoney('')).toBeNull();
  });
});

describe('reparto exacto (sin errores de redondeo)', () => {
  it('reparte en partes iguales y la suma da exacto', () => {
    const r = equal(10_000, ['a', 'b', 'c']);
    expect(r.map((x) => x.amountCents)).toEqual([3_334, 3_333, 3_333]);
    expect(r.reduce((a, x) => a + x.amountCents, 0)).toBe(10_000);
  });
  it('nunca pierde ni inventa centavos (prueba masiva)', () => {
    for (let total = 1; total < 3_000; total += 7) {
      for (let n = 1; n <= 9; n++) {
        const ids = Array.from({ length: n }, (_, i) => `p${i}`);
        const r = equal(total, ids);
        expect(r.reduce((a, x) => a + x.amountCents, 0)).toBe(total);
        const amounts = r.map((x) => x.amountCents);
        expect(Math.max(...amounts) - Math.min(...amounts)).toBeLessThanOrEqual(1);
      }
    }
  });
  it('reparte por porcentajes, incluso periódicos', () => {
    const r = computeSplit(100_000, 'percent', [
      { participantId: 'a', value: '33,3333' },
      { participantId: 'b', value: '33,3333' },
      { participantId: 'c', value: '33,3334' }
    ]);
    expect(r.reduce((a, x) => a + x.amountCents, 0)).toBe(100_000);
    expect(r.map((x) => x.amountCents)).toEqual([33_333, 33_333, 33_334]);
    const r2 = computeSplit(999, 'percent', [
      { participantId: 'a', value: 50 },
      { participantId: 'b', value: 25 },
      { participantId: 'c', value: 25 }
    ]);
    expect(r2.map((x) => x.amountCents)).toEqual([499, 250, 250]) // mayor resto: 499,5 · 249,75 · 249,75;
  });
  it('rechaza porcentajes que no suman 100', () => {
    expect(() => computeSplit(1_000, 'percent', [{ participantId: 'a', value: 60 }, { participantId: 'b', value: 30 }])).toThrow(SplitError);
  });
  it('reparte por montos personalizados y avisa diferencias', () => {
    const r = computeSplit(10_000, 'amount', [{ participantId: 'a', value: 7_000 }, { participantId: 'b', value: '30' }]);
    expect(r.map((x) => x.amountCents)).toEqual([7_000, 3_000]);
    expect(() => computeSplit(10_000, 'amount', [{ participantId: 'a', value: 7_000 }])).toThrow(/Faltan asignar \$ 30/);
    expect(() => computeSplit(10_000, 'amount', [{ participantId: 'a', value: 12_000 }])).toThrow(/Te pasaste/);
  });
  it('reparte por pesos o proporciones (un adulto 2, un chico 1)', () => {
    const r = computeSplit(90_000, 'weight', [
      { participantId: 'adulto', value: 2 },
      { participantId: 'chico', value: 1 }
    ]);
    expect(r.map((x) => x.amountCents)).toEqual([60_000, 30_000]);
    const r2 = computeSplit(100, 'weight', [{ participantId: 'a', value: '1,5' }, { participantId: 'b', value: 1 }, { participantId: 'c', value: 0 }]);
    expect(r2.map((x) => x.amountCents)).toEqual([60, 40, 0]);
  });
  it('valida entradas inválidas', () => {
    expect(() => computeSplit(100, 'equal', [])).toThrow(SplitError);
    expect(() => computeSplit(0, 'equal', [{ participantId: 'a', value: 1 }])).toThrow(SplitError);
    expect(() => computeSplit(100, 'weight', [{ participantId: 'a', value: 0 }])).toThrow(SplitError);
    expect(() => equal(100, ['a', 'a'])).toThrow(/repetidos/);
    expect(() => allocateByWeights(100, [-1n, 2n])).toThrow();
  });
  it('maneja importes grandes sin perder precisión', () => {
    const r = equal(99_999_999_999, ['a', 'b', 'c', 'd', 'e', 'f', 'g']);
    expect(r.reduce((a, x) => a + x.amountCents, 0)).toBe(99_999_999_999);
  });
});

describe('saldos y liquidación', () => {
  const ids = ['jesus', 'pablo', 'ricardo', 'nico'];
  const expenses = [
    exp([['jesus', 5_000_000]], equal(5_000_000, ids).map((s) => [s.participantId, s.amountCents])),
    exp([['pablo', 3_000_000]], equal(3_000_000, ids).map((s) => [s.participantId, s.amountCents])),
    exp([['ricardo', 2_000_000]], equal(2_000_000, ids).map((s) => [s.participantId, s.amountCents]))
  ];

  it('resuelve el ejemplo del enunciado: $100.000 entre 4 → $25.000 c/u', () => {
    const b = computeBalances(ids, expenses, []);
    const by = Object.fromEntries(b.map((x) => [x.participantId, x]));
    expect(b.reduce((a, x) => a + x.paid, 0)).toBe(10_000_000);
    expect(ids.map((i) => by[i].owed)).toEqual([2_500_000, 2_500_000, 2_500_000, 2_500_000]);
    expect(ids.map((i) => by[i].net)).toEqual([2_500_000, 500_000, -500_000, -2_500_000]);
    const t = simplifyDebts(b);
    expect(t).toEqual([
      { from: 'nico', to: 'jesus', amountCents: 2_500_000 },
      { from: 'ricardo', to: 'pablo', amountCents: 500_000 }
    ]);
  });

  it('los saldos siempre suman cero', () => {
    const b = computeBalances(ids, expenses, [set('nico', 'jesus', 1_000_000)]);
    expect(b.reduce((a, x) => a + x.net, 0)).toBe(0);
  });

  it('quien no consumió un gasto no lo paga (la cerveza)', () => {
    const beer = exp([['pablo', 1_200_000]], equal(1_200_000, ['jesus', 'pablo']).map((s) => [s.participantId, s.amountCents]));
    const b = computeBalances(ids, [...expenses, beer], []);
    const by = Object.fromEntries(b.map((x) => [x.participantId, x]));
    expect(by.ricardo.owed).toBe(2_500_000);
    expect(by.nico.owed).toBe(2_500_000);
    expect(by.jesus.owed).toBe(3_100_000);
  });

  it('admite varios pagadores en un mismo gasto', () => {
    const shared = exp([['jesus', 600_000], ['pablo', 400_000]], equal(1_000_000, ids).map((s) => [s.participantId, s.amountCents]));
    const b = computeBalances(ids, [shared], []);
    expect(b.map((x) => x.net)).toEqual([350_000, 150_000, -250_000, -250_000]);
    const t = simplifyDebts(b);
    expect(t.reduce((a, x) => a + x.amountCents, 0)).toBe(500_000);
  });

  it('pagos parciales: estados pendiente → parcial → saldado', () => {
    let b = computeBalances(ids, expenses, []);
    const nico = () => b.find((x) => x.participantId === 'nico')!;
    expect(debtStatus(nico())).toBe('pending');
    b = computeBalances(ids, expenses, [set('nico', 'jesus', 1_000_000)]);
    expect(debtStatus(nico())).toBe('partial');
    expect(nico().net).toBe(-1_500_000);
    expect(gatheringDebtStatus(b)).toBe('partial');
    expect(simplifyDebts(b)).toContainEqual({ from: 'nico', to: 'jesus', amountCents: 1_500_000 });
    b = computeBalances(ids, expenses, [set('nico', 'jesus', 2_500_000), set('ricardo', 'pablo', 500_000)]);
    expect(debtStatus(nico())).toBe('settled');
    expect(gatheringDebtStatus(b)).toBe('settled');
    expect(simplifyDebts(b)).toEqual([]);
  });

  it('pagos informados o rechazados no mueven el saldo', () => {
    const b = computeBalances(ids, expenses, [set('nico', 'jesus', 1_000_000, 'reported'), set('nico', 'jesus', 500_000, 'rejected')]);
    const n = b.find((x) => x.participantId === 'nico')!;
    expect(n.net).toBe(-2_500_000);
    expect(n.pendingSent).toBe(1_000_000);
  });

  it('las transferencias sugeridas saldan exactamente a todos (aleatorio)', () => {
    let seed = 42;
    const rnd = () => ((seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31) / 2 ** 31);
    for (let round = 0; round < 300; round++) {
      const n = 2 + Math.floor(rnd() * 8);
      const people = Array.from({ length: n }, (_, i) => `p${i}`);
      const list = Array.from({ length: 1 + Math.floor(rnd() * 6) }, () => {
        const total = 1 + Math.floor(rnd() * 5_000_000);
        const payer = people[Math.floor(rnd() * n)];
        const subset = people.filter(() => rnd() > 0.3);
        const parts = subset.length ? subset : [payer];
        return exp([[payer, total]], equal(total, parts).map((s) => [s.participantId, s.amountCents]));
      });
      const b = computeBalances(people, list, []);
      const t = simplifyDebts(b);
      expect(t.length).toBeLessThanOrEqual(n - 1);
      const after = computeBalances(people, list, t.map((x) => set(x.from, x.to, x.amountCents)));
      expect(after.every((x) => x.net === 0)).toBe(true);
    }
  });
});
