import { describe, expect, it } from 'vitest';
import { groupStats, reminderState } from './insights';
import { tallyDates, tallyOptions } from './votes';
import { fromLocalInput, toLocalInput } from './format';
import type { Gathering, GroupSnapshot } from './types';

const NOW = Date.parse('2026-11-01T15:00:00Z');
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();
const g = (id: string, starts_at: string | null, status: Gathering['status'], created_by = 'u1'): Gathering => ({
  id, group_id: 'G', title: id, starts_at, status, location: null, description: null, notes: null,
  currency: 'ARS', created_by, created_at: daysAgo(400), confirmed_at: null
});
const snap = (gatherings: Gathering[], reminder_days = 30, enabled = true) => ({
  group: { id: 'G', name: 'Los pibes', description: null, image_url: null, created_by: 'u1', created_at: daysAgo(400) },
  settings: { group_id: 'G', reminder_days, reminders_enabled: enabled, last_reminder_at: null },
  gatherings
});

describe('recordatorios', () => {
  it('avisa cuando pasó la frecuencia elegida (35 días con frecuencia 30)', () => {
    const r = reminderState(snap([g('a', daysAgo(35), 'done'), g('b', daysAgo(90), 'done')]), NOW);
    expect(r).toMatchObject({ due: true, days: 35, threshold: 30 });
  });
  it('no avisa antes de tiempo', () => {
    expect(reminderState(snap([g('a', daysAgo(20), 'done')]), NOW).due).toBe(false);
  });
  it('no avisa si ya hay una juntada propuesta o confirmada a futuro', () => {
    expect(reminderState(snap([g('a', daysAgo(60), 'done'), g('p', null, 'proposed')]), NOW).due).toBe(false);
    expect(reminderState(snap([g('a', daysAgo(60), 'done'), g('c', daysAgo(-3), 'confirmed')]), NOW).due).toBe(false);
  });
  it('ignora juntadas canceladas y respeta si el grupo los desactivó', () => {
    expect(reminderState(snap([g('a', daysAgo(60), 'done'), g('x', daysAgo(5), 'cancelled')]), NOW).days).toBe(60);
    expect(reminderState(snap([g('a', daysAgo(60), 'done')], 30, false), NOW).due).toBe(false);
  });
});

describe('votación de fechas', () => {
  const props = ['2026-11-13T00:00:00Z', '2026-11-14T16:30:00Z', '2026-11-15T16:00:00Z'].map((starts_at, i) => ({
    id: `d${i + 1}`, gathering_id: 'g', starts_at, created_by: 'u1'
  }));
  it('destaca la fecha con más disponibles', () => {
    const t = tallyDates(props, [
      { proposal_id: 'd1', user_id: 'a', vote: 'yes' },
      { proposal_id: 'd2', user_id: 'a', vote: 'yes' },
      { proposal_id: 'd2', user_id: 'b', vote: 'yes' },
      { proposal_id: 'd3', user_id: 'b', vote: 'maybe' }
    ]);
    expect(t[0].proposal.id).toBe('d2');
    expect(t[0].isWinner).toBe(true);
    expect(t[0].isTied).toBe(false);
  });
  it('desempata por "tal vez", luego por menos "no puedo"', () => {
    const t = tallyDates(props, [
      { proposal_id: 'd1', user_id: 'a', vote: 'yes' },
      { proposal_id: 'd3', user_id: 'a', vote: 'yes' },
      { proposal_id: 'd3', user_id: 'b', vote: 'maybe' },
      { proposal_id: 'd1', user_id: 'b', vote: 'no' }
    ]);
    expect(t.map((x) => x.proposal.id)).toEqual(['d3', 'd1', 'd2']);
  });
  it('marca empate y sugiere la fecha más cercana', () => {
    const t = tallyDates(props, [
      { proposal_id: 'd3', user_id: 'a', vote: 'yes' },
      { proposal_id: 'd1', user_id: 'b', vote: 'yes' }
    ]);
    expect(t[0].proposal.id).toBe('d1');
    expect(t[0].isTied && t[1].isTied).toBe(true);
    expect(t[0].rank).toBe(t[1].rank);
  });
  it('sin votos no hay ganador', () => {
    expect(tallyDates(props, []).some((x) => x.isWinner)).toBe(false);
  });
  it('cuenta votos de menú', () => {
    const t = tallyOptions(
      [{ id: 'm1', gathering_id: 'g', kind: 'asado', label: 'Asado', created_by: null },
       { id: 'm2', gathering_id: 'g', kind: 'pizza', label: 'Pizza', created_by: null }],
      [{ gathering_id: 'g', user_id: 'a', proposal_id: 'm1' }, { gathering_id: 'g', user_id: 'b', proposal_id: 'm1' },
       { gathering_id: 'g', user_id: 'c', proposal_id: 'm2' }]
    );
    expect(t[0]).toMatchObject({ votes: 2, isWinner: true, isTied: false });
    expect(t[0].pct).toBeCloseTo(2 / 3);
  });
});

describe('estadísticas', () => {
  it('calcula totales, promedios y organizadores', () => {
    const gs = [g('a', daysAgo(10), 'done', 'u1'), g('b', daysAgo(40), 'done', 'u2'), g('c', daysAgo(70), 'done', 'u1'), g('p', null, 'proposed')];
    const s: GroupSnapshot = {
      ...snap(gs),
      members: ['u1', 'u2'].map((user_id) => ({ group_id: 'G', user_id, role: 'member', joined_at: daysAgo(400) })),
      profiles: {},
      participants: gs.flatMap((x) => [
        { id: `${x.id}-1`, gathering_id: x.id, user_id: 'u1', guest_name: null, rsvp: 'yes', added_by: null },
        { id: `${x.id}-2`, gathering_id: x.id, user_id: 'u2', guest_name: null, rsvp: x.id === 'c' ? 'no' : 'yes', added_by: null }
      ]),
      expenses: ['a', 'b'].map((gid) => ({
        id: `e-${gid}`, gathering_id: gid, description: 'x', category: 'carne', amount_cents: 1_000_000, currency: 'ARS',
        split_method: 'equal', spent_on: '2026-10-01', receipt_path: null, notes: null, created_by: 'u1', created_at: '', updated_at: '',
        payers: [{ expense_id: `e-${gid}`, participant_id: `${gid}-1`, amount_cents: 1_000_000 }],
        splits: [1, 2].map((n) => ({ expense_id: `e-${gid}`, participant_id: `${gid}-${n}`, share: 1, amount_cents: 500_000 }))
      })),
      settlements: [], dateProposals: [], dateVotes: [], menuProposals: [], menuVotes: [], venueProposals: [], venueVotes: [], photos: []
    };
    const st = groupStats(s, {}, NOW);
    expect(st.heldCount).toBe(3);
    expect(st.totalSpent).toBe(2_000_000);
    expect(st.avgPerGathering).toBe(666_667);
    expect(st.avgPerPerson).toBe(500_000);
    expect(st.daysSinceLast).toBe(10);
    expect(st.next?.id).toBe('p');
    expect(st.topOrganizers[0]).toEqual({ userId: 'u1', count: 2 });
    expect(st.attendance.find((x) => x.userId === 'u2')).toMatchObject({ attended: 2, invited: 3 });
    expect(groupStats(s, { from: NOW - 30 * 86_400_000 }, NOW).heldCount).toBe(1);
  });
});

describe('fechas en hora argentina', () => {
  it('convierte ida y vuelta datetime-local', () => {
    const iso = fromLocalInput('2026-11-14T13:30')!;
    expect(iso).toBe('2026-11-14T16:30:00.000Z');
    expect(toLocalInput(iso)).toBe('2026-11-14T13:30');
  });
});
