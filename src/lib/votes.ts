import type { DateProposal, DateVote, OptionProposal, OptionVote } from './types';

export interface DateTally {
  proposal: DateProposal;
  yes: number;
  maybe: number;
  no: number;
  /** Puntaje: "puedo" vale 1, "tal vez" medio punto. */
  score: number;
  rank: number;
  isWinner: boolean;
  isTied: boolean;
}

/**
 * Ordena las fechas propuestas. Criterio de desempate (claro y explicable):
 *  1) más "puedo"; 2) más "tal vez"; 3) menos "no puedo"; 4) la fecha más cercana.
 * Si dos opciones empatan en 1–3, se marcan como empate (isTied) y el
 * organizador decide; igual se sugiere la más cercana.
 */
export function tallyDates(proposals: DateProposal[], votes: DateVote[]): DateTally[] {
  const rows = proposals.map((p) => {
    const vs = votes.filter((v) => v.proposal_id === p.id);
    const yes = vs.filter((v) => v.vote === 'yes').length;
    const maybe = vs.filter((v) => v.vote === 'maybe').length;
    const no = vs.filter((v) => v.vote === 'no').length;
    return { proposal: p, yes, maybe, no, score: yes + maybe / 2, rank: 0, isWinner: false, isTied: false };
  });
  rows.sort(
    (a, b) =>
      b.yes - a.yes || b.maybe - a.maybe || a.no - b.no || a.proposal.starts_at.localeCompare(b.proposal.starts_at)
  );
  const same = (a: DateTally, b: DateTally) => a.yes === b.yes && a.maybe === b.maybe && a.no === b.no;
  rows.forEach((r, i) => {
    r.rank = i > 0 && same(r, rows[i - 1]) ? rows[i - 1].rank : i + 1;
  });
  const top = rows[0];
  if (top && top.yes + top.maybe > 0) {
    top.isWinner = true;
    rows.forEach((r) => {
      if (r !== top && same(r, top)) {
        r.isTied = true;
        top.isTied = true;
      }
    });
  }
  return rows;
}

export interface OptionTally<K extends string> {
  proposal: OptionProposal<K>;
  votes: number;
  voters: string[];
  pct: number;
  isWinner: boolean;
  isTied: boolean;
}

export function tallyOptions<K extends string>(proposals: OptionProposal<K>[], votes: OptionVote[]): OptionTally<K>[] {
  const total = votes.length;
  const rows = proposals.map((p) => {
    const voters = votes.filter((v) => v.proposal_id === p.id).map((v) => v.user_id);
    return { proposal: p, votes: voters.length, voters, pct: total ? voters.length / total : 0, isWinner: false, isTied: false };
  });
  rows.sort((a, b) => b.votes - a.votes || a.proposal.label.localeCompare(b.proposal.label, 'es'));
  if (rows[0] && rows[0].votes > 0) {
    rows[0].isWinner = true;
    rows.slice(1).forEach((r) => {
      if (r.votes === rows[0].votes) {
        r.isTied = true;
        rows[0].isTied = true;
      }
    });
  }
  return rows;
}
