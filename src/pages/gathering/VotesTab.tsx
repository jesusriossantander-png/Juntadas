import { useState } from 'react';
import { Check, CheckCircle2, HelpCircle, Plus, Share2, Trash2, Trophy, X } from 'lucide-react';
import { useAction, useApp } from '../../app/AppContext';
import { Field, Sheet, Spinner } from '../../components/ui';
import { formatDateTime, fromLocalInput } from '../../lib/format';
import { daysBetween, lastHeld, profileName } from '../../lib/insights';
import { MENU_KINDS, VENUE_KINDS } from '../../lib/labels';
import type { Gathering, GroupSnapshot, VoteValue } from '../../lib/types';
import { tallyDates, tallyOptions } from '../../lib/votes';
import { appUrl, messages, whatsappUrl } from '../../lib/whatsapp';

export default function VotesTab({ snap, g, canManage, reload }: { snap: GroupSnapshot; g: Gathering; canManage: boolean; reload: () => void }) {
  const { backend, user } = useApp();
  const { run, busy } = useAction();
  const [newDate, setNewDate] = useState('');
  const [optSheet, setOptSheet] = useState<null | 'menu' | 'venue'>(null);
  const me = user!.id;
  const props = snap.dateProposals.filter((d) => d.gathering_id === g.id);
  const votes = snap.dateVotes.filter((v) => props.some((p) => p.id === v.proposal_id));
  const tally = tallyDates(props, votes);
  const winner = tally.find((t) => t.isWinner);
  const open = g.status === 'proposed' || g.status === 'confirmed';
  const voters = new Set(votes.map((v) => v.user_id)).size;
  const prev = lastHeld(snap.gatherings.filter((x) => x.id !== g.id));
  const nameOf = (uid: string) => profileName(snap.profiles[uid]);

  const menu = tallyOptions(snap.menuProposals.filter((m) => m.gathering_id === g.id), snap.menuVotes.filter((v) => v.gathering_id === g.id));
  const venue = tallyOptions(snap.venueProposals.filter((m) => m.gathering_id === g.id), snap.venueVotes.filter((v) => v.gathering_id === g.id));
  const myMenu = snap.menuVotes.find((v) => v.gathering_id === g.id && v.user_id === me)?.proposal_id;
  const myVenue = snap.venueVotes.find((v) => v.gathering_id === g.id && v.user_id === me)?.proposal_id;

  return (
    <div className="stack-lg">
      <section className="stack">
        <div className="section-title"><h2>📅 Fecha</h2><span className="faint small">{voters} {voters === 1 ? 'votó' : 'votaron'} de {snap.members.length}</span></div>
        {g.status === 'confirmed' && g.starts_at && (
          <div className="card alert row"><CheckCircle2 color="var(--green)" /><div className="grow"><div className="bold">Fecha confirmada</div><div className="small muted">{formatDateTime(g.starts_at)}</div></div></div>
        )}
        {tally.length === 0 && <p className="faint small">Todavía no hay fechas propuestas.</p>}
        {winner?.isTied && open && <p className="small" style={{ color: 'var(--amber)' }}>⚖️ Hay empate entre las más votadas. Sugerimos la más cercana; el organizador decide.</p>}
        {tally.map((t) => {
          const mine = votes.find((v) => v.proposal_id === t.proposal.id && v.user_id === me)?.vote;
          const isConfirmed = g.status === 'confirmed' && g.starts_at === t.proposal.starts_at;
          const who = votes.filter((v) => v.proposal_id === t.proposal.id);
          const set = (v: VoteValue) => run(() => backend.voteDate(t.proposal.id, mine === v ? null : v).then(reload));
          return (
            <div key={t.proposal.id} className={`card stack ${t.isWinner ? 'winner' : ''}`} style={{ gap: 10 }}>
              <div className="row-between" style={{ alignItems: 'flex-start' }}>
                <div>
                  <div className="bold">{formatDateTime(t.proposal.starts_at)}</div>
                  <div className="xsmall faint">✅ {t.yes} pueden · 🤔 {t.maybe} tal vez · ❌ {t.no} no</div>
                </div>
                {isConfirmed ? <span className="badge b-done"><Check />Elegida</span> : t.isWinner && <span className="badge b-done"><Trophy />{t.isTied ? 'Empatada' : 'Más votada'}</span>}
              </div>
              <div className="bar green"><i style={{ width: `${snap.members.length ? (t.yes / snap.members.length) * 100 : 0}%` }} /></div>
              {open && (
                <div className="vote-btns">
                  <button className={`vote-btn yes ${mine === 'yes' ? 'on' : ''}`} onClick={() => set('yes')} aria-pressed={mine === 'yes'}><Check />Puedo</button>
                  <button className={`vote-btn maybe ${mine === 'maybe' ? 'on' : ''}`} onClick={() => set('maybe')} aria-pressed={mine === 'maybe'}><HelpCircle />Tal vez</button>
                  <button className={`vote-btn no ${mine === 'no' ? 'on' : ''}`} onClick={() => set('no')} aria-pressed={mine === 'no'}><X />No puedo</button>
                </div>
              )}
              {who.length > 0 && <p className="xsmall faint">{who.map((v) => `${nameOf(v.user_id)} ${v.vote === 'yes' ? '✅' : v.vote === 'maybe' ? '🤔' : '❌'}`).join(' · ')}</p>}
              {canManage && open && (
                <div className="row">
                  {!isConfirmed && <button className="btn btn-sm btn-success grow" disabled={busy} onClick={() => confirm(`¿Confirmar ${formatDateTime(t.proposal.starts_at)}? Se avisará al grupo.`) && run(() => backend.confirmDate(t.proposal.id).then(reload), '¡Fecha confirmada! Avisá al grupo.')}><CheckCircle2 /> Confirmar esta fecha</button>}
                  {(t.proposal.created_by === me || canManage) && !isConfirmed && <button className="icon-btn" aria-label="Borrar opción" onClick={() => confirm('¿Borrar esta opción y sus votos?') && run(() => backend.deleteDateOption(t.proposal.id).then(reload))}><Trash2 size={18} /></button>}
                </div>
              )}
            </div>
          );
        })}
        {open && (
          <div className="row">
            <input className="input" type="datetime-local" value={newDate} onChange={(e) => setNewDate(e.target.value)} aria-label="Nueva opción de fecha" />
            <button className="btn" disabled={!newDate || busy} onClick={async () => { const iso = fromLocalInput(newDate); if (!iso) return; const ok = await run(() => backend.addDateOption(g.id, iso).then(() => true), 'Fecha agregada'); if (ok) { setNewDate(''); reload(); } }}><Plus /> Sumar</button>
          </div>
        )}
        <a className="btn btn-wa" href={whatsappUrl(g.status === 'confirmed' ? messages.confirmed(g.title, g.starts_at, g.location, appUrl(`/juntadas/${g.id}`)) : messages.proposal(prev?.starts_at ? daysBetween(prev.starts_at) : null, appUrl(`/juntadas/${g.id}/votos`)))} target="_blank" rel="noreferrer"><Share2 /> {g.status === 'confirmed' ? 'Avisar la fecha confirmada' : 'Pedir que voten por WhatsApp'}</a>
      </section>

      <OptionPoll title="🍽️ ¿Qué comemos?" rows={menu} mine={myMenu} kinds={MENU_KINDS} open={open} nameOf={nameOf}
        onVote={(id) => run(() => backend.voteOption('menu', g.id, id === myMenu ? null : id).then(reload))}
        onDelete={(id) => run(() => backend.deleteOption('menu', id).then(reload))} canDelete={(c) => c === me || canManage} onAdd={() => setOptSheet('menu')} />
      <OptionPoll title="📍 ¿Dónde?" rows={venue} mine={myVenue} kinds={VENUE_KINDS} open={open} nameOf={nameOf}
        onVote={(id) => run(() => backend.voteOption('venue', g.id, id === myVenue ? null : id).then(reload))}
        onDelete={(id) => run(() => backend.deleteOption('venue', id).then(reload))} canDelete={(c) => c === me || canManage} onAdd={() => setOptSheet('venue')} />

      <AddOptionSheet type={optSheet} onClose={() => setOptSheet(null)} gathering={g} reload={reload} />
    </div>
  );
}

function OptionPoll({ title, rows, mine, kinds, open, onVote, onAdd, onDelete, canDelete, nameOf }: {
  title: string; rows: ReturnType<typeof tallyOptions<string>>; mine?: string; kinds: { id: string; label: string; emoji: string }[]; open: boolean;
  onVote: (id: string) => void; onAdd: () => void; onDelete: (id: string) => void; canDelete: (createdBy: string | null) => boolean; nameOf: (uid: string) => string;
}) {
  return (
    <section className="stack">
      <div className="section-title"><h2>{title}</h2>{open && <button className="btn btn-sm" onClick={onAdd}><Plus /> Opción</button>}</div>
      {rows.length === 0 && <p className="faint small">Sin opciones todavía. ¡Proponé una!</p>}
      {rows.map((r) => {
        const k = kinds.find((x) => x.id === r.proposal.kind);
        return (
          <div key={r.proposal.id} className="row" style={{ alignItems: 'stretch' }}>
            <button className={`option-btn ${mine === r.proposal.id ? 'on' : ''} ${r.isWinner ? 'winner' : ''}`} disabled={!open} onClick={() => onVote(r.proposal.id)} aria-pressed={mine === r.proposal.id}>
              <div className="row-between" style={{ width: '100%' }}>
                <span className="bold">{k?.emoji} {r.proposal.label}</span>
                <span className="small num">{r.votes} {r.votes === 1 ? 'voto' : 'votos'}{r.isWinner && (r.isTied ? ' · empate' : ' · 🏆')}</span>
              </div>
              <div className="bar" style={{ width: '100%' }}><i style={{ width: `${r.pct * 100}%` }} /></div>
              {r.voters.length > 0 && <span className="xsmall faint">{r.voters.map(nameOf).join(', ')}</span>}
            </button>
            {open && canDelete(r.proposal.created_by) && <button className="icon-btn" style={{ alignSelf: 'center' }} aria-label="Borrar opción" onClick={() => confirm('¿Borrar esta opción?') && onDelete(r.proposal.id)}><Trash2 size={18} /></button>}
          </div>
        );
      })}
    </section>
  );
}

function AddOptionSheet({ type, onClose, gathering, reload }: { type: null | 'menu' | 'venue'; onClose: () => void; gathering: Gathering; reload: () => void }) {
  const { backend } = useApp();
  const { run, busy } = useAction();
  const kinds = type === 'venue' ? VENUE_KINDS : MENU_KINDS;
  const [kind, setKind] = useState<string>(kinds[0].id);
  const [label, setLabel] = useState('');
  return (
    <Sheet open={!!type} onClose={onClose} title={type === 'venue' ? 'Proponer lugar' : 'Proponer comida'}>
      <div className="stack">
        <div className="chips">
          {kinds.map((k) => (
            <button key={k.id} className={`chip ${kind === k.id ? 'on' : ''}`} onClick={() => { setKind(k.id); if (!label || kinds.some((x) => x.label === label)) setLabel(k.id === 'otro' ? '' : k.label); }}>{k.emoji} {k.label}</button>
          ))}
        </div>
        <Field label="Detalle" hint={type === 'venue' ? 'Ej: Casa de Jesús, Quincho del club, La Parrilla de Juan' : 'Ej: Asado con achuras, Pizza a la parrilla'}>
          <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={type === 'venue' ? 80 : 60} />
        </Field>
        <button className="btn btn-primary" disabled={busy || !label.trim()} onClick={async () => {
          const ok = await run(() => (type === 'venue' ? backend.addVenueOption(gathering.id, kind as never, label) : backend.addMenuOption(gathering.id, kind as never, label)).then(() => true), 'Opción agregada');
          if (ok) { setLabel(''); reload(); onClose(); }
        }}>{busy ? <Spinner /> : 'Agregar'}</button>
      </div>
    </Sheet>
  );
}
