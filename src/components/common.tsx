import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Bell, Check, ChevronDown, MapPin, Users } from 'lucide-react';
import { useApp } from '../app/AppContext';
import type { Gathering, GroupSnapshot } from '../lib/types';
import { formatShortDate, formatTime } from '../lib/format';
import { gatheringTotals } from '../lib/insights';
import { GroupIcon, Money, Sheet, StatusBadge } from './ui';

export function NotificationsButton() {
  const { unread } = useApp();
  return (
    <Link to="/notificaciones" className="icon-btn" aria-label={`Notificaciones${unread ? `, ${unread} sin leer` : ''}`}>
      <Bell />
      {unread > 0 && <span className="dot">{unread > 9 ? '9+' : unread}</span>}
    </Link>
  );
}

export function GroupSwitcher() {
  const { groups, activeGroupId, setActiveGroupId } = useApp();
  const [open, setOpen] = useState(false);
  const active = groups?.find((g) => g.group.id === activeGroupId);
  if (!groups?.length || !active) return <span className="brand">La Juntada</span>;
  return (
    <>
      <button className="btn btn-ghost btn-sm" style={{ paddingLeft: 4, maxWidth: '100%' }} onClick={() => setOpen(true)} aria-label="Cambiar de grupo">
        <span className="ellipsis" style={{ fontSize: '1.02rem' }}>{active.group.name}</span>
        <ChevronDown />
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Tus grupos">
        <div className="card flush list">
          {groups.map((g) => (
            <button key={g.group.id} className="list-item" onClick={() => { setActiveGroupId(g.group.id); setOpen(false); }}>
              <GroupIcon name={g.group.name} id={g.group.id} url={g.group.image_url} size={40} />
              <div className="grow">
                <div className="bold ellipsis">{g.group.name}</div>
                <div className="faint xsmall">{g.member_count} integrantes</div>
              </div>
              {g.group.id === activeGroupId && <Check color="var(--ember)" />}
            </button>
          ))}
        </div>
        <div className="grid-2" style={{ marginTop: 12 }}>
          <Link to="/grupos?crear=1" className="btn" onClick={() => setOpen(false)}>Crear grupo</Link>
          <Link to="/unirse" className="btn" onClick={() => setOpen(false)}>Unirme con código</Link>
        </div>
      </Sheet>
    </>
  );
}

export function DateChip({ iso }: { iso: string | null }) {
  if (!iso) return <div className="date-chip"><div className="m">?</div><div className="d">—</div></div>;
  const d = new Date(iso);
  const tz = 'America/Argentina/Buenos_Aires';
  const m = new Intl.DateTimeFormat('es-AR', { month: 'short', timeZone: tz }).format(d).replace('.', '');
  const day = new Intl.DateTimeFormat('es-AR', { day: 'numeric', timeZone: tz }).format(d);
  return <div className="date-chip"><div className="m">{m}</div><div className="d">{day}</div></div>;
}

export function GatheringCard({ g, snap, showTotals = true }: { g: Gathering; snap: GroupSnapshot; showTotals?: boolean }) {
  const t = gatheringTotals(snap, g.id);
  const going = snap.participants.filter((p) => p.gathering_id === g.id && p.rsvp === 'yes').length;
  return (
    <Link to={`/juntadas/${g.id}`} className="card card-link tight">
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <DateChip iso={g.starts_at} />
        <div className="grow stack" style={{ gap: 4 }}>
          <div className="row-between" style={{ alignItems: 'flex-start' }}>
            <h3 className="ellipsis">{g.title}</h3>
            <StatusBadge status={g.status} />
          </div>
          <div className="faint small row wrap" style={{ gap: 10 }}>
            <span>{g.starts_at ? `${formatShortDate(g.starts_at)} · ${formatTime(g.starts_at)} hs` : 'Fecha en votación'}</span>
            {g.location && <span className="row" style={{ gap: 3 }}><MapPin size={13} />{g.location}</span>}
            <span className="row" style={{ gap: 3 }}><Users size={13} />{going}</span>
          </div>
          {showTotals && t.total > 0 && (
            <div className="row small" style={{ gap: 12, marginTop: 2 }}>
              <span>Total <b><Money cents={t.total} /></b></span>
              {t.pendingCents > 0 ? <span className="neg">Pendiente <b><Money cents={t.pendingCents} /></b></span> : <span className="pos">Cuentas saldadas</span>}
            </div>
          )}
        </div>
      </div>
    </Link>
  );
}
