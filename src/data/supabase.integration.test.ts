/**
 * Prueba de integración del SupabaseBackend REAL contra un Supabase local
 * (`npx supabase start`). Se ejecuta solo si están definidas:
 *   SUPABASE_TEST_URL y SUPABASE_TEST_ANON_KEY
 * Ejemplo: SUPABASE_TEST_URL=http://127.0.0.1:54321 SUPABASE_TEST_ANON_KEY=... npx vitest run src/data/supabase.integration.test.ts
 */
import { describe, expect, it } from 'vitest';
import { SupabaseBackend } from './supabaseBackend';
import { computeSplit } from '../lib/money';
import { computeBalances, simplifyDebts } from '../lib/balances';

declare const process: { env: Record<string, string | undefined> };
const URL = process.env.SUPABASE_TEST_URL;
const KEY = process.env.SUPABASE_TEST_ANON_KEY;
const run = URL && KEY ? describe : describe.skip;
const stamp = Date.now();

// Entorno mínimo de navegador para Node (WebSocket nativo para Realtime).
const g = globalThis as unknown as Record<string, unknown>;
if (!g.location) g.location = { origin: 'http://localhost:4173', pathname: '/', search: '' };
if (!g.localStorage) {
  const m = new Map<string, string>();
  g.localStorage = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
}

async function user(name: string) {
  const b = new SupabaseBackend(URL!, KEY!, { storageKey: `lj-test-${name}-${stamp}` });
  const r = await b.signUp(`${name.toLowerCase()}.${stamp}@test.lajuntada.app`, 'clave-segura-123', name);
  expect(r.needsConfirmation).toBe(false);
  return b;
}
const waitFor = async (cond: () => boolean, ms = 8000) => {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('timeout esperando condición');
    await new Promise((r) => setTimeout(r, 100));
  }
};

run('SupabaseBackend contra Supabase real', () => {
  it('flujo completo: grupo, invitación, gastos, liquidación, votos, archivos, permisos y tiempo real', async () => {
    const [A, B, C, D, E] = await Promise.all(['Jesus', 'Pablo', 'Ricardo', 'Nico', 'Intruso'].map(user));
    const uid = async (b: SupabaseBackend) => (await b.getUser())!.id;

    // Grupo e invitaciones
    const gid = await A.createGroup('Los del Asado (test)', 'Integración', null);
    const inv = await A.createInvitation(gid, 7, null);
    expect(inv.code).toMatch(/^[A-Z0-9]{8}$/);
    const prev = await B.previewInvitation(inv.code);
    expect(prev).toMatchObject({ group_name: 'Los del Asado (test)', is_valid: true, already_member: false });
    for (const x of [B, C, D]) expect(await x.acceptInvitation(inv.code)).toBe(gid);
    await expect(E.getSnapshot(gid)).rejects.toThrow();
    await expect(E.acceptInvitation('ZZZZZZZZ')).rejects.toThrow(/no existe/);
    await expect(B.updateGroup(gid, { name: 'hack' })).rejects.toThrow(/administrador/);
    expect((await B.listGroups()).map((g) => g.group.id)).toContain(gid);

    // Juntada con todos
    const g = await A.createGathering({ group_id: gid, title: 'Asado del mes', starts_at: new Date(Date.now() - 86400000).toISOString(),
      location: 'Casa', description: null, notes: null, status: 'confirmed', invite_all: true, date_options: [] });
    let snap = await B.getSnapshot(gid);
    const parts = snap.participants.filter((p) => p.gathering_id === g);
    expect(parts).toHaveLength(4);
    const pid = async (b: SupabaseBackend) => { const id = await uid(b); return parts.find((p) => p.user_id === id)!.id; };
    const [pa, pb, pc, pd] = await Promise.all([A, B, C, D].map(pid));

    // Realtime: B escucha, A carga un gasto
    let changes = 0;
    const off = B.subscribeGroup(gid, () => changes++);
    await new Promise((r) => setTimeout(r, 4000)); // dar tiempo a que el canal quede suscripto
    const add = (b: SupabaseBackend, payer: string, amount: number, among: string[], desc: string) =>
      b.saveExpense({ gathering_id: g, description: desc, category: 'carne', amount_cents: amount, split_method: 'equal', spent_on: '2026-10-10',
        payers: [{ participant_id: payer, amount_cents: amount }],
        splits: computeSplit(amount, 'equal', among.map((participantId) => ({ participantId, value: 1 }))).map((s) => ({ participant_id: s.participantId, share: s.share, amount_cents: s.amountCents })) });
    const e1 = await add(A, pa, 5_000_000, [pa, pb, pc, pd], 'Carne');
    await waitFor(() => changes > 0);
    off();
    await add(B, pb, 3_000_000, [pa, pb, pc, pd], 'Bebidas');
    await add(C, pc, 2_000_000, [pa, pb, pc, pd], 'Carbón');
    await expect(add(B, pb, 100, [pa], 'mal').then(() => B.deleteExpense(e1))).rejects.toThrow(/Solo quien cargó/);
    await expect(B.saveExpense({ gathering_id: g, description: 'x', category: 'otros', amount_cents: 1000, split_method: 'equal', spent_on: '2026-10-10',
      payers: [{ participant_id: pb, amount_cents: 1000 }], splits: [{ participant_id: pa, share: 1, amount_cents: 999 }] })).rejects.toThrow(/no coincide/);

    snap = await D.getSnapshot(gid);
    const ex = snap.expenses.filter((e) => e.gathering_id === g && e.description !== 'mal');
    const bal = computeBalances([pa, pb, pc, pd], ex, []);
    expect(bal.map((b) => b.net)).toEqual([2_500_000, 500_000, -500_000, -2_500_000]);
    expect(simplifyDebts(bal)).toEqual(expect.arrayContaining([{ from: pd, to: pa, amountCents: 2_500_000 }]));

    // Liquidación: pago parcial informado por el deudor, confirmado por el acreedor
    const ref = crypto.randomUUID();
    const s1 = await D.reportSettlement({ gathering_id: g, from: pd, to: pa, amount_cents: 1_000_000, method: 'transferencia', paid_on: '2026-10-11', client_ref: ref });
    expect(await D.reportSettlement({ gathering_id: g, from: pd, to: pa, amount_cents: 1_000_000, method: 'transferencia', paid_on: '2026-10-11', client_ref: ref })).toBe(s1);
    await expect(D.reviewSettlement(s1, true)).rejects.toThrow();
    await expect(D.reportSettlement({ gathering_id: g, from: pd, to: pa, amount_cents: 2_000_000, method: 'efectivo', paid_on: '2026-10-11', client_ref: crypto.randomUUID() })).rejects.toThrow(/supera/);
    expect((await A.listNotifications()).some((n) => n.kind === 'settlement_reported')).toBe(true);
    await A.reviewSettlement(s1, true);
    snap = await A.getSnapshot(gid);
    const nico = computeBalances([pa, pb, pc, pd], snap.expenses.filter((e) => e.gathering_id === g), snap.settlements).find((b) => b.participantId === pd)!;
    expect(nico.net).toBe(-1_500_000);

    // Votación
    const prop = await B.createGathering({ group_id: gid, title: 'Próximo', starts_at: null, location: null, description: null, notes: null,
      status: 'proposed', invite_all: true, date_options: ['2026-11-13T00:00:00.000Z', '2026-11-14T16:30:00.000Z'] });
    snap = await C.getSnapshot(gid);
    const opts = snap.dateProposals.filter((d) => d.gathering_id === prop).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    await C.voteDate(opts[1].id, 'yes');
    await C.voteDate(opts[1].id, 'maybe');
    await D.voteDate(opts[1].id, 'yes');
    await A.addMenuOption(prop, 'asado', 'Asado');
    snap = await C.getSnapshot(gid);
    const menu = snap.menuProposals.find((m) => m.gathering_id === prop)!;
    await C.voteOption('menu', prop, menu.id);
    await expect(C.confirmDate(opts[1].id)).rejects.toThrow(/organizador/);
    await B.confirmDate(opts[1].id);
    snap = await A.getSnapshot(gid);
    expect(snap.dateVotes.filter((v) => v.proposal_id === opts[1].id).map((v) => v.vote).sort()).toEqual(['maybe', 'yes']);
    expect(snap.menuVotes.filter((v) => v.gathering_id === prop)).toHaveLength(1);
    expect(snap.gatherings.find((x) => x.id === prop)).toMatchObject({ status: 'confirmed', starts_at: expect.stringMatching(/2026-11-14T16:30/) });
    const notes = await D.listNotifications();
    expect(notes.some((n) => n.kind === 'gathering_confirmed')).toBe(true);
    await D.markNotificationsRead('all');
    expect((await D.listNotifications()).every((n) => n.read_at)).toBe(true);

    // Storage: comprobante privado del grupo
    const path = await A.uploadFile('receipts', `${gid}/${g}`, new Blob(['%PDF-1.4 test'], { type: 'application/pdf' }));
    expect(await B.fileUrl(path)).toMatch(/^http/);
    expect(await E.fileUrl(path)).toBeNull();
    await expect(E.uploadFile('receipts', `${gid}/${g}`, new Blob(['x'], { type: 'application/pdf' }))).rejects.toThrow();

    // Perfil y salida del grupo
    await B.updateProfile({ alias: 'pablo.mp' });
    expect((await A.getProfile(await uid(B)))?.alias).toBe('pablo.mp');
    expect(await E.getProfile(await uid(B))).toBeNull();
    await D.leaveGroup(gid);
    expect((await D.listGroups()).some((x) => x.group.id === gid)).toBe(false);
  }, 60_000);
});
