/**
 * Datos de DEMOSTRACIÓN (ficticios). Se generan con fechas relativas a hoy.
 * Todo lleva la marca "DEMO" y vive solo en el almacenamiento local del navegador.
 */
import { computeSplit, type SplitMethod } from '../lib/money';
import type { DemoDB } from './demoBackend';
import type { Expense, ExpenseCategory, Gathering, Participant } from '../lib/types';

const DAY = 86_400_000;
const uuid = () => crypto.randomUUID();

export const DEMO_PASSWORD = 'demo1234';

/** Fecha a N días (negativo = pasado) a cierta hora argentina. */
function at(daysFromNow: number, hhmm: string): string {
  const d = new Date(Date.now() + daysFromNow * DAY);
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(d);
  return new Date(`${ymd}T${hhmm}:00-03:00`).toISOString();
}
function nextWeekday(target: number, minDays: number, hhmm: string) {
  for (let i = minDays; i < minDays + 8; i++) {
    const d = new Date(Date.now() + i * DAY);
    if (d.getUTCDay() === target) return at(i, hhmm);
  }
  return at(minDays, hhmm);
}

export function buildDemoDB(): DemoDB {
  const created = new Date(Date.now() - 400 * DAY).toISOString();
  const people = [
    { name: 'Jesús', alias: 'jesus.asador.mp', email: 'jesus@demo.lajuntada.app' },
    { name: 'Pablo', alias: 'pablo.quincho', email: 'pablo@demo.lajuntada.app' },
    { name: 'Ricardo', alias: null, email: 'ricardo@demo.lajuntada.app' },
    { name: 'Nico', alias: 'nico.bebidas', email: 'nico@demo.lajuntada.app' },
    { name: 'Martina', alias: null, email: 'martina@demo.lajuntada.app' }
  ].map((p) => ({ ...p, id: uuid() }));
  const [J, P, R, N, M] = people.map((p) => p.id);

  const db: DemoDB = {
    version: 1,
    users: people.map((p) => ({ id: p.id, email: p.email, password: DEMO_PASSWORD })),
    profiles: people.map((p) => ({ id: p.id, display_name: p.name, alias: p.alias, avatar_url: null })),
    groups: [],
    settings: [],
    members: [],
    invitations: [],
    gatherings: [],
    participants: [],
    expenses: [],
    settlements: [],
    dateProposals: [],
    dateVotes: [],
    menuProposals: [],
    menuVotes: [],
    venueProposals: [],
    venueVotes: [],
    photos: [],
    notifications: [],
    audit: []
  };

  // ---------------------------------------------------------------- grupos
  const G1 = uuid();
  const G2 = uuid();
  db.groups.push(
    { id: G1, name: 'Los del Asado (DEMO)', description: 'Grupo de demostración: amigos de toda la vida, un asado por mes.', image_url: null, created_by: J, created_at: created },
    { id: G2, name: 'Viernes de after (DEMO)', description: 'Grupo de demostración con recordatorio vencido.', image_url: null, created_by: J, created_at: created }
  );
  db.settings.push(
    { group_id: G1, reminder_days: 30, reminders_enabled: true, last_reminder_at: null },
    { group_id: G2, reminder_days: 30, reminders_enabled: true, last_reminder_at: null }
  );
  [J, P, R, N].forEach((u, i) => db.members.push({ group_id: G1, user_id: u, role: u === J ? 'admin' : 'member', joined_at: new Date(Date.parse(created) + i * 1000).toISOString() }));
  [J, P, M].forEach((u, i) => db.members.push({ group_id: G2, user_id: u, role: u === M ? 'admin' : 'member', joined_at: new Date(Date.parse(created) + i * 1000).toISOString() }));
  db.invitations.push({
    id: uuid(), group_id: G1, code: 'DEMO2026', created_by: J, created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 30 * DAY).toISOString(), max_uses: null, uses: 0, revoked_at: null
  });

  // ------------------------------------------------------------- helpers
  const gathering = (g: Partial<Gathering> & Pick<Gathering, 'group_id' | 'title' | 'status' | 'created_by'>, users: string[], guests: string[] = []) => {
    const id = uuid();
    db.gatherings.push({
      id, starts_at: null, location: null, description: null, notes: null, currency: 'ARS', created_at: created, confirmed_at: null, ...g
    });
    const parts: Record<string, Participant> = {};
    users.forEach((u) => {
      const p: Participant = { id: uuid(), gathering_id: id, user_id: u, guest_name: null, rsvp: 'yes', added_by: g.created_by };
      db.participants.push(p);
      parts[u] = p;
    });
    guests.forEach((name) => {
      const p: Participant = { id: uuid(), gathering_id: id, user_id: null, guest_name: name, rsvp: 'yes', added_by: g.created_by };
      db.participants.push(p);
      parts[name] = p;
    });
    return { id, parts };
  };
  const expense = (
    gid: string, by: string, description: string, category: ExpenseCategory, amount: number,
    payers: [Participant, number][], among: Participant[], method: SplitMethod = 'equal', values?: number[], spent?: string
  ) => {
    const id = uuid();
    const split = computeSplit(amount, method, among.map((p, i) => ({ participantId: p.id, value: values?.[i] ?? 1 })));
    const g = db.gatherings.find((x) => x.id === gid)!;
    const e: Expense & { deleted_at: null } = {
      id, gathering_id: gid, description, category, amount_cents: amount, currency: 'ARS', split_method: method,
      spent_on: (spent ?? g.starts_at ?? new Date().toISOString()).slice(0, 10), receipt_path: null, notes: null,
      created_by: by, created_at: g.starts_at ?? created, updated_at: g.starts_at ?? created, deleted_at: null,
      payers: payers.map(([p, a]) => ({ expense_id: id, participant_id: p.id, amount_cents: a })),
      splits: split.map((s) => ({ expense_id: id, participant_id: s.participantId, share: s.share, amount_cents: s.amountCents }))
    };
    db.expenses.push(e);
  };
  const settle = (gid: string, from: Participant, to: Participant, amount: number, status: 'confirmed' | 'reported', method: 'transferencia' | 'efectivo' | 'mercadopago', when: string) => {
    db.settlements.push({
      id: uuid(), gathering_id: gid, from_participant: from.id, to_participant: to.id, amount_cents: amount, method,
      paid_on: when.slice(0, 10), receipt_path: null, notes: null, status, created_by: from.user_id, created_at: when,
      confirmed_by: status === 'confirmed' ? to.user_id : null, confirmed_at: status === 'confirmed' ? when : null, client_ref: uuid()
    });
  };

  // ------------------------------------------- 1) cumple de Pablo (saldado)
  const g1 = gathering({ group_id: G1, title: 'Asado por el cumple de Pablo', status: 'done', created_by: P, starts_at: at(-95, '13:30'), location: 'Quincho de Pablo', description: 'Festejo con torta y todo.' }, [J, P, R, N]);
  const a = g1.parts;
  const all1 = [a[J], a[P], a[R], a[N]];
  expense(g1.id, J, 'Asado, vacío y chorizos', 'carne', 6_000_000, [[a[J], 6_000_000]], all1);
  expense(g1.id, R, 'Carbón y leña', 'carbon', 800_000, [[a[R], 800_000]], all1);
  expense(g1.id, P, 'Vinos y gaseosas', 'bebidas', 2_400_000, [[a[P], 2_400_000]], all1);
  expense(g1.id, N, 'Hielo', 'hielo', 300_000, [[a[N], 300_000]], all1);
  // saldos: J +3.625.000 · P +25.000 · R −1.575.000 · N −2.075.000  (en centavos)
  settle(g1.id, a[N], a[J], 2_075_000, 'confirmed', 'transferencia', at(-93, '10:00'));
  settle(g1.id, a[R], a[J], 1_550_000, 'confirmed', 'mercadopago', at(-92, '18:00'));
  settle(g1.id, a[R], a[P], 25_000, 'confirmed', 'efectivo', at(-92, '18:05'));

  // --------------------------- 2) pizzas en lo de Ricardo (parcialmente pagado)
  const g2 = gathering({ group_id: G1, title: 'Pizzas en lo de Ricardo', status: 'done', created_by: R, starts_at: at(-62, '21:00'), location: 'Casa de Ricardo' }, [J, P, R, N], ['Primo de Pablo']);
  const b = g2.parts;
  expense(g2.id, R, 'Pizzas (6 grandes)', 'otros', 3_200_000, [[b[R], 3_200_000]], [b[J], b[P], b[R], b[N], b['Primo de Pablo']]);
  // La cerveza: Pablo no toma → no la paga.
  expense(g2.id, N, 'Cerveza', 'bebidas', 1_800_000, [[b[N], 1_800_000]], [b[J], b[R], b[N], b['Primo de Pablo']]);
  expense(g2.id, J, 'Helado', 'postre', 900_000, [[b[J], 600_000], [b[P], 300_000]], [b[J], b[P], b[R], b[N], b['Primo de Pablo']]);
  settle(g2.id, b[P], b[R], 340_000, 'confirmed', 'transferencia', at(-60, '12:00'));
  settle(g2.id, b['Primo de Pablo'], b[R], 500_000, 'confirmed', 'efectivo', at(-62, '23:30'));

  // ------------------------- 3) el ejemplo del enunciado (cuentas pendientes)
  const g3 = gathering({ group_id: G1, title: 'Asado del mes', status: 'done', created_by: J, starts_at: at(-21, '13:00'), location: 'Casa de Jesús', notes: 'Nico se encargó de la música 🎶' }, [J, P, R, N]);
  const c = g3.parts;
  const all3 = [c[J], c[P], c[R], c[N]];
  expense(g3.id, J, 'Carne', 'carne', 5_000_000, [[c[J], 5_000_000]], all3);
  expense(g3.id, P, 'Bebidas', 'bebidas', 3_000_000, [[c[P], 3_000_000]], all3);
  expense(g3.id, R, 'Carbón, pan y verduras', 'carbon', 2_000_000, [[c[R], 2_000_000]], all3);
  settle(g3.id, c[N], c[J], 1_000_000, 'confirmed', 'transferencia', at(-19, '09:30'));
  settle(g3.id, c[R], c[P], 500_000, 'reported', 'mercadopago', at(-2, '20:00'));

  // ---------------------------------- 4) propuesta con votación en marcha
  const g4 = gathering({ group_id: G1, title: 'Asado de fin de año', status: 'proposed', created_by: P, description: '¿Quién se anima a hacer el asado? Votemos fecha, menú y lugar.' }, [J, P]);
  db.participants.push(
    { id: uuid(), gathering_id: g4.id, user_id: R, guest_name: null, rsvp: 'maybe', added_by: P },
    { id: uuid(), gathering_id: g4.id, user_id: N, guest_name: null, rsvp: 'pending', added_by: P }
  );
  const opts = [nextWeekday(5, 10, '21:00'), nextWeekday(6, 10, '13:30'), nextWeekday(0, 10, '13:00')].map((starts_at) => ({ id: uuid(), gathering_id: g4.id, starts_at, created_by: P }));
  db.dateProposals.push(...opts);
  const v = (o: number, user_id: string, vote: 'yes' | 'maybe' | 'no') => db.dateVotes.push({ proposal_id: opts[o].id, user_id, vote });
  v(0, J, 'no'); v(0, P, 'yes'); v(0, R, 'maybe');
  v(1, J, 'yes'); v(1, P, 'yes'); v(1, R, 'yes');
  v(2, J, 'yes'); v(2, P, 'maybe'); v(2, R, 'no');
  const menu = [
    { kind: 'asado' as const, label: 'Asado' },
    { kind: 'empanadas' as const, label: 'Empanadas' },
    { kind: 'pizza' as const, label: 'Pizza' }
  ].map((m) => ({ ...m, id: uuid(), gathering_id: g4.id, created_by: P }));
  db.menuProposals.push(...menu);
  db.menuVotes.push(
    { gathering_id: g4.id, user_id: J, proposal_id: menu[0].id },
    { gathering_id: g4.id, user_id: P, proposal_id: menu[0].id },
    { gathering_id: g4.id, user_id: R, proposal_id: menu[1].id }
  );
  const venues = [
    { kind: 'quincho' as const, label: 'Quincho de Pablo' },
    { kind: 'casa' as const, label: 'Casa de Jesús' }
  ].map((m) => ({ ...m, id: uuid(), gathering_id: g4.id, created_by: P }));
  db.venueProposals.push(...venues);
  db.venueVotes.push(
    { gathering_id: g4.id, user_id: J, proposal_id: venues[0].id },
    { gathering_id: g4.id, user_id: R, proposal_id: venues[0].id }
  );

  // ---------------------------------- grupo 2: hace 47 días que no se juntan
  const h = gathering({ group_id: G2, title: 'Birras del viernes', status: 'done', created_by: M, starts_at: at(-47, '19:30'), location: 'Cervecería del centro' }, [J, P, M]);
  expense(h.id, M, 'Ronda de pintas', 'bebidas', 2_700_000, [[h.parts[M], 2_700_000]], [h.parts[J], h.parts[P], h.parts[M]]);
  expense(h.id, J, 'Papas y picada', 'otros', 1_500_000, [[h.parts[J], 1_500_000]], [h.parts[J], h.parts[P], h.parts[M]], 'weight', [1, 2, 1]);

  // ---------------------------------------------------------- notificaciones
  const note = (user_id: string, title: string, body: string | null, link: string, hoursAgo: number, group_id = G1) =>
    db.notifications.push({
      id: uuid(), user_id, group_id, gathering_id: null, kind: 'info', title, body, link, read_at: null,
      created_at: new Date(Date.now() - hoursAgo * 3_600_000).toISOString(), dedupe_key: uuid()
    });
  [J, R, N].forEach((u) => note(u, '🍻 Pablo propuso: Asado de fin de año', 'Entrá a votar fecha, menú y lugar.', `/juntadas/${g4.id}`, 30));
  note(P, '💸 Te informaron un pago', 'Ricardo te informó $ 5.000 del "Asado del mes". Confirmá si lo recibiste.', `/juntadas/${g3.id}/cuentas`, 48);
  note(N, '💰 Ya están las cuentas del "Asado del mes"', 'Te quedan $ 15.000 por pagar a Jesús.', `/juntadas/${g3.id}/cuentas`, 20 * 24);

  return db;
}
