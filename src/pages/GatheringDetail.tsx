import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  CalendarClock, Camera, CheckCircle2, MapPin, MoreVertical, Pencil, Receipt, Share2, Trash2, UserPlus, Vote, Wallet, XCircle,
  RotateCcw, StickyNote, Info, X
} from 'lucide-react';
import { useAction, useApp, useGatheringSnapshot } from '../app/AppContext';
import { ask, ConfirmSheet, EmptyState, Field, LoadError, Money, Page, ProfileAvatar, Segmented, Sheet, Skeleton, Spinner, StatusBadge, Avatar } from '../components/ui';
import { DateChip } from '../components/common';
import { formatDateTime, fromLocalInput, toLocalInput } from '../lib/format';
import { daysBetween, lastHeld, participantName, profileName } from '../lib/insights';
import { RSVP_LABEL } from '../lib/labels';
import { buildLedger } from '../lib/ledger';
import type { Gathering, GroupSnapshot, Rsvp } from '../lib/types';
import { appUrl, messages, whatsappUrl } from '../lib/whatsapp';
import ExpensesTab from './gathering/ExpensesTab';
import AccountsTab from './gathering/AccountsTab';
import VotesTab from './gathering/VotesTab';
import PhotosTab from './gathering/PhotosTab';

const TABS = [
  { id: 'resumen', label: 'Resumen', icon: Info },
  { id: 'gastos', label: 'Gastos', icon: Receipt },
  { id: 'cuentas', label: 'Cuentas', icon: Wallet },
  { id: 'votos', label: 'Votación', icon: Vote },
  { id: 'fotos', label: 'Fotos', icon: Camera }
] as const;
type TabId = (typeof TABS)[number]['id'];

export default function GatheringDetail() {
  const { id, tab: tabParam } = useParams();
  const nav = useNavigate();
  const { user } = useApp();
  const { snap, gathering, error, reload, notFound } = useGatheringSnapshot(id);
  const tab: TabId = (TABS.some((t) => t.id === tabParam) ? tabParam : 'resumen') as TabId;
  const [menuOpen, setMenuOpen] = useState(false);

  if (notFound) return <Page title="Juntada" back="/juntadas"><EmptyState icon={<XCircle />} title="No encontramos esta juntada" text="Puede que se haya eliminado o que no tengas acceso." /></Page>;
  if (error && !snap) return <Page title="Juntada" back="/juntadas"><LoadError text={error} onRetry={reload} /></Page>;
  if (!snap || !gathering || !user) return <Page title="Juntada" back="/juntadas"><Skeleton h={160} /><div style={{ height: 12 }} /><Skeleton h={70} n={3} /></Page>;

  const isAdmin = snap.members.some((m) => m.user_id === user.id && m.role === 'admin');
  const canManage = isAdmin || gathering.created_by === user.id;
  const visibleTabs = TABS.filter((t) => t.id !== 'votos' || gathering.status === 'proposed' || snap.dateProposals.some((d) => d.gathering_id === gathering.id) || snap.menuProposals.some((d) => d.gathering_id === gathering.id));

  return (
    <Page title={gathering.title} back="/juntadas"
      actions={canManage && <button className="icon-btn" aria-label="Opciones de la juntada" onClick={() => setMenuOpen(true)}><MoreVertical /></button>}>
      <div className="tabs" role="tablist" style={{ marginTop: -8 }}>
        {visibleTabs.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={`tab ${tab === t.id ? 'on' : ''}`} onClick={() => nav(`/juntadas/${gathering.id}/${t.id}`, { replace: true })}>
            <t.icon size={16} />{t.label}
          </button>
        ))}
      </div>
      <div style={{ marginTop: 10 }}>
        {tab === 'resumen' && <Summary snap={snap} g={gathering} canManage={canManage} reload={reload} />}
        {tab === 'gastos' && <ExpensesTab snap={snap} g={gathering} canManage={canManage} />}
        {tab === 'cuentas' && <AccountsTab snap={snap} g={gathering} isAdmin={isAdmin} canManage={canManage} reload={reload} />}
        {tab === 'votos' && <VotesTab snap={snap} g={gathering} canManage={canManage} reload={reload} />}
        {tab === 'fotos' && <PhotosTab snap={snap} g={gathering} canManage={canManage} reload={reload} />}
      </div>
      <ManageSheet open={menuOpen} onClose={() => setMenuOpen(false)} g={gathering} isAdmin={isAdmin} reload={reload} />
    </Page>
  );
}

function Summary({ snap, g, canManage, reload }: { snap: GroupSnapshot; g: Gathering; canManage: boolean; reload: () => void }) {
  const { backend, user } = useApp();
  const { run, busy } = useAction();
  const [addOpen, setAddOpen] = useState(false);
  const ledger = buildLedger(snap, g.id, user!.id)!;
  const parts = ledger.participants;
  const me = ledger.me;
  const counts = { yes: 0, maybe: 0, no: 0, pending: 0 } as Record<Rsvp, number>;
  parts.forEach((p) => counts[p.rsvp]++);
  const link = appUrl(`/juntadas/${g.id}`);
  const prevHeld = lastHeld(snap.gatherings.filter((x) => x.id !== g.id));
  const shareText =
    g.status === 'proposed' ? messages.proposal(prevHeld?.starts_at ? daysBetween(prevHeld.starts_at) : null, `${link}/votos`)
    : g.status === 'confirmed' ? messages.confirmed(g.title, g.starts_at, g.location, link)
    : messages.accounts(g.title, `${link}/cuentas`);
  const order: Rsvp[] = ['yes', 'maybe', 'pending', 'no'];

  return (
    <div className="stack-lg">
      <div className="card stack">
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <DateChip iso={g.starts_at} />
          <div className="grow stack" style={{ gap: 4 }}>
            <div className="row-between" style={{ alignItems: 'flex-start' }}><h2>{g.title}</h2><StatusBadge status={g.status} /></div>
            <div className="row small muted" style={{ gap: 6 }}><CalendarClock size={15} />{g.starts_at ? formatDateTime(g.starts_at) : 'Fecha en votación'}</div>
            {g.location && (
              <a className="row small link" style={{ gap: 6 }} href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(g.location)}`} target="_blank" rel="noreferrer"><MapPin size={15} />{g.location}</a>
            )}
          </div>
        </div>
        {g.description && <p className="muted">{g.description}</p>}
        {g.notes && <p className="small row" style={{ gap: 6, alignItems: 'flex-start' }}><StickyNote size={15} style={{ marginTop: 2, flexShrink: 0 }} /><span>{g.notes}</span></p>}
        <p className="faint xsmall">Organiza {profileName(snap.profiles[g.created_by ?? ''])}</p>
        <a className="btn btn-wa" href={whatsappUrl(shareText)} target="_blank" rel="noreferrer"><Share2 /> Compartir por WhatsApp</a>
      </div>

      {g.status !== 'cancelled' && g.status !== 'done' && (
        <section className="stack">
          <div className="section-title"><h2>¿Vas?</h2></div>
          <Segmented ariaLabel="Mi asistencia" value={me?.rsvp ?? 'pending'} onChange={(v) => run(() => backend.setRsvp(g.id, v).then(reload))}
            options={[{ value: 'yes', label: '🙌 Voy' }, { value: 'maybe', label: '🤔 Tal vez' }, { value: 'no', label: '😕 No voy' }]} />
        </section>
      )}

      <div className="grid-2">
        <Link to={`/juntadas/${g.id}/gastos`} className="stat card-link"><div className="stat-label">Gastado</div><div className="stat-value"><Money cents={ledger.total} /></div><div className="stat-sub">{snap.expenses.filter((e) => e.gathering_id === g.id).length} gastos</div></Link>
        <Link to={`/juntadas/${g.id}/cuentas`} className="stat card-link"><div className="stat-label">Tu saldo</div><div className="stat-value">{me ? <Money cents={ledger.byId[me.id]?.net ?? 0} signed /> : '—'}</div><div className="stat-sub">Ver cuentas</div></Link>
      </div>

      <section className="stack">
        <div className="section-title">
          <h2>Asistentes ({counts.yes} van)</h2>
          {canManage && <button className="btn btn-sm" onClick={() => setAddOpen(true)}><UserPlus /> Sumar</button>}
        </div>
        <p className="faint small">{counts.yes} van · {counts.maybe} tal vez · {counts.no} no van · {counts.pending} sin responder</p>
        <div className="card flush list">
          {[...parts].sort((a, b) => order.indexOf(a.rsvp) - order.indexOf(b.rsvp)).map((p) => {
            const name = participantName(p, snap.profiles);
            return (
              <div key={p.id} className="list-item">
                {p.user_id ? <ProfileAvatar profile={snap.profiles[p.user_id]} name={name} size="sm" /> : <Avatar name={name} size="sm" />}
                <div className="grow">
                  <div className="bold small">{name}{p.user_id === user!.id ? ' (vos)' : ''}</div>
                  {!p.user_id && <div className="faint xsmall">Invitado externo</div>}
                </div>
                <span className={`badge ${p.rsvp === 'yes' ? 'b-done' : p.rsvp === 'no' ? 'b-pending' : p.rsvp === 'maybe' ? 'b-partial' : 'b-none'}`}>{RSVP_LABEL[p.rsvp]}</span>
                {canManage && p.user_id !== user!.id && (
                  <button className="icon-btn" aria-label={`Quitar a ${name}`} disabled={busy} onClick={async () => (await ask(`¿Quitar a ${name} de la juntada?`, { danger: true, confirmLabel: 'Quitar' })) && run(() => backend.removeParticipant(p.id).then(reload), 'Asistente quitado')}><X size={18} /></button>
                )}
              </div>
            );
          })}
        </div>
      </section>
      <AddParticipantSheet open={addOpen} onClose={() => setAddOpen(false)} snap={snap} g={g} reload={reload} />
    </div>
  );
}

function AddParticipantSheet({ open, onClose, snap, g, reload }: { open: boolean; onClose: () => void; snap: GroupSnapshot; g: Gathering; reload: () => void }) {
  const { backend } = useApp();
  const { run, busy } = useAction();
  const [guest, setGuest] = useState('');
  const inList = new Set(snap.participants.filter((p) => p.gathering_id === g.id).map((p) => p.user_id));
  const missing = snap.members.filter((m) => !inList.has(m.user_id));
  return (
    <Sheet open={open} onClose={onClose} title="Sumar asistentes">
      <div className="stack">
        {missing.length > 0 && (
          <div className="card flush list">
            {missing.map((m) => {
              const name = profileName(snap.profiles[m.user_id]);
              return (
                <button key={m.user_id} className="list-item" disabled={busy} onClick={() => run(() => backend.addParticipant(g.id, { userId: m.user_id }).then(reload), `${name} sumado`)}>
                  <ProfileAvatar profile={snap.profiles[m.user_id]} name={name} size="sm" /><span className="grow bold">{name}</span><UserPlus size={18} />
                </button>
              );
            })}
          </div>
        )}
        <Field label="Invitado que no es del grupo" hint="Por ejemplo, un primo o un amigo de un amigo. Puede participar de los gastos.">
          <div className="row">
            <input className="input" value={guest} onChange={(e) => setGuest(e.target.value)} placeholder="Nombre" maxLength={60} />
            <button className="btn btn-primary" disabled={busy || !guest.trim()} onClick={async () => { const ok = await run(() => backend.addParticipant(g.id, { guestName: guest.trim() }), 'Invitado agregado'); if (ok) { setGuest(''); reload(); } }}>Sumar</button>
          </div>
        </Field>
      </div>
    </Sheet>
  );
}

function ManageSheet({ open, onClose, g, isAdmin, reload }: { open: boolean; onClose: () => void; g: Gathering; isAdmin: boolean; reload: () => void }) {
  const { backend } = useApp();
  const { run, busy } = useAction();
  const nav = useNavigate();
  const [edit, setEdit] = useState(false);
  const [del, setDel] = useState(false);
  const [title, setTitle] = useState(g.title);
  const [when, setWhen] = useState(toLocalInput(g.starts_at));
  const [location, setLocation] = useState(g.location ?? '');
  const [description, setDescription] = useState(g.description ?? '');
  const [notes, setNotes] = useState(g.notes ?? '');
  const setStatus = (status: Gathering['status'], msg: string) => run(async () => {
    if (status === 'confirmed' && !g.starts_at) throw new Error('Primero confirmá una fecha (en Votación) o editá la juntada.');
    await backend.updateGathering(g.id, { status });
    reload();
    onClose();
  }, msg);
  return (
    <>
      <Sheet open={open && !edit} onClose={onClose} title="Opciones">
        <div className="stack">
          <button className="btn" onClick={() => { setTitle(g.title); setWhen(toLocalInput(g.starts_at)); setLocation(g.location ?? ''); setDescription(g.description ?? ''); setNotes(g.notes ?? ''); setEdit(true); }}><Pencil /> Editar datos</button>
          {g.status !== 'done' && <button className="btn btn-success" disabled={busy} onClick={() => setStatus('done', 'Marcada como realizada')}><CheckCircle2 /> Marcar como realizada</button>}
          {g.status === 'proposed' && g.starts_at && <button className="btn" disabled={busy} onClick={() => setStatus('confirmed', 'Juntada confirmada')}><CheckCircle2 /> Confirmar</button>}
          {(g.status === 'done' || g.status === 'cancelled') && <button className="btn" disabled={busy} onClick={() => setStatus(g.starts_at ? 'confirmed' : 'proposed', 'Juntada reabierta')}><RotateCcw /> Reabrir</button>}
          {g.status !== 'cancelled' && <button className="btn btn-danger" disabled={busy} onClick={() => setStatus('cancelled', 'Juntada cancelada')}><XCircle /> Cancelar juntada</button>}
          {isAdmin && <button className="btn btn-ghost" style={{ color: 'var(--red)' }} onClick={() => setDel(true)}><Trash2 /> Eliminar definitivamente</button>}
        </div>
      </Sheet>
      <Sheet open={open && edit} onClose={() => { setEdit(false); onClose(); }} title="Editar juntada">
        <div className="stack">
          <Field label="Nombre"><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={100} /></Field>
          <Field label="Fecha y hora"><input className="input" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} /></Field>
          <Field label="Lugar"><input className="input" value={location} onChange={(e) => setLocation(e.target.value)} maxLength={200} /></Field>
          <Field label="Descripción"><textarea className="textarea" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} /></Field>
          <Field label="Notas"><input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} /></Field>
          <button className="btn btn-primary" disabled={busy} onClick={async () => {
            const ok = await run(async () => {
              if (!title.trim()) throw new Error('El nombre no puede quedar vacío');
              await backend.updateGathering(g.id, { title: title.trim(), starts_at: fromLocalInput(when), location: location.trim() || null, description: description.trim() || null, notes: notes.trim() || null });
              return true;
            }, 'Cambios guardados');
            if (ok) { reload(); setEdit(false); onClose(); }
          }}>{busy ? <Spinner /> : 'Guardar'}</button>
        </div>
      </Sheet>
      <ConfirmSheet open={del} onClose={() => setDel(false)} danger busy={busy} title="¿Eliminar la juntada?" confirmLabel="Eliminar"
        text="Se borran sus gastos, pagos, votos y fotos. Esta acción no se puede deshacer. Si solo no se hizo, mejor cancelala: queda en el historial."
        onConfirm={async () => { const ok = await run(() => backend.deleteGathering(g.id).then(() => true), 'Juntada eliminada'); if (ok) nav('/juntadas', { replace: true }); }} />
    </>
  );
}
