import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CalendarDays, History, Plus, Search, Wallet } from 'lucide-react';
import { useApp, useSnapshot } from '../app/AppContext';
import { GatheringCard, GroupSwitcher, NotificationsButton } from '../components/common';
import { DebtBadge, EmptyState, LoadError, Money, Page, Skeleton } from '../components/ui';
import { isUpcoming } from '../lib/insights';
import { buildLedger } from '../lib/ledger';
import { formatMoney } from '../lib/money';

type Tab = 'upcoming' | 'history' | 'cuentas';

export default function Gatherings({ initialTab }: { initialTab?: Tab }) {
  const { activeGroupId, user } = useApp();
  const { snap, error, reload } = useSnapshot(activeGroupId);
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || initialTab || 'upcoming';
  const setTab = (t: Tab) => setParams({ tab: t }, { replace: true });
  const [q, setQ] = useState('');
  const [year, setYear] = useState<string>('all');

  const lists = useMemo(() => {
    if (!snap) return null;
    const upcoming = snap.gatherings.filter((g) => isUpcoming(g)).sort((a, b) => (a.starts_at ?? '9').localeCompare(b.starts_at ?? '9'));
    const history = snap.gatherings.filter((g) => !isUpcoming(g)).sort((a, b) => (b.starts_at ?? '').localeCompare(a.starts_at ?? ''));
    const years = [...new Set(history.map((g) => g.starts_at?.slice(0, 4)).filter(Boolean) as string[])];
    return { upcoming, history, years };
  }, [snap]);

  const filteredHistory = lists?.history.filter((g) => {
    if (year !== 'all' && g.starts_at?.slice(0, 4) !== year) return false;
    if (q.trim() && !`${g.title} ${g.location ?? ''}`.toLowerCase().includes(q.trim().toLowerCase())) return false;
    return true;
  });

  return (
    <Page title={<GroupSwitcher />} actions={<NotificationsButton />}>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'upcoming'} className={`tab ${tab === 'upcoming' ? 'on' : ''}`} onClick={() => setTab('upcoming')}><CalendarDays size={16} />Próximas</button>
        <button role="tab" aria-selected={tab === 'history'} className={`tab ${tab === 'history' ? 'on' : ''}`} onClick={() => setTab('history')}><History size={16} />Historial</button>
        <button role="tab" aria-selected={tab === 'cuentas'} className={`tab ${tab === 'cuentas' ? 'on' : ''}`} onClick={() => setTab('cuentas')}><Wallet size={16} />Cuentas</button>
      </div>
      {!snap && !error && <Skeleton h={90} n={4} />}
      {error && !snap && <LoadError text={error} onRetry={reload} />}
      {snap && lists && (
        <div className="stack" style={{ marginTop: 8 }}>
          {tab === 'upcoming' && (
            <>
              <Link to={`/juntadas/nueva?grupo=${snap.group.id}`} className="btn btn-primary"><Plus /> Proponer una juntada</Link>
              {lists.upcoming.length === 0 ? (
                <EmptyState icon={<CalendarDays />} title="Nada en el horizonte" text="Proponé una juntada: podés sugerir varias fechas para que el grupo vote." />
              ) : lists.upcoming.map((g) => <GatheringCard key={g.id} g={g} snap={snap} />)}
            </>
          )}
          {tab === 'history' && (
            <>
              <div className="row">
                <div className="input-affix grow"><input className="input" placeholder="Buscar por nombre o lugar" value={q} onChange={(e) => setQ(e.target.value)} /><span><Search size={18} /></span></div>
                <select className="select" style={{ width: 110 }} value={year} onChange={(e) => setYear(e.target.value)} aria-label="Año">
                  <option value="all">Todos</option>
                  {lists.years.map((y) => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>
              {filteredHistory!.length === 0 ? (
                <EmptyState icon={<History />} title="Sin juntadas en el historial" text="Cuando se realicen, quedan acá con sus gastos, fotos y cuentas." />
              ) : filteredHistory!.map((g) => <GatheringCard key={g.id} g={g} snap={snap} />)}
            </>
          )}
          {tab === 'cuentas' && user && (() => {
            const ledgers = snap.gatherings.filter((g) => g.status !== 'cancelled').map((g) => buildLedger(snap, g.id, user.id)!).filter((l) => l.total > 0)
              .sort((a, b) => (b.gathering.starts_at ?? '9').localeCompare(a.gathering.starts_at ?? '9'));
            const pending = ledgers.reduce((a, l) => a + l.balances.reduce((x, b) => x + Math.max(0, -b.net), 0), 0);
            if (!ledgers.length) return <EmptyState icon={<Wallet />} title="Todavía no hay gastos" text="Cuando alguien cargue lo que pagó, acá vas a ver quién le debe a quién." />;
            return (
              <>
                <div className="card row-between">
                  <div><div className="stat-label">Pendiente en el grupo</div><div className="amount-lg">{formatMoney(pending)}</div></div>
                  {pending === 0 ? <span className="badge b-settled">Todo saldado</span> : <span className="badge b-pending">Hay deudas</span>}
                </div>
                {ledgers.map((l) => {
                  const mine = l.me ? l.byId[l.me.id] : undefined;
                  return (
                    <Link key={l.gathering.id} to={`/juntadas/${l.gathering.id}/cuentas`} className="card card-link tight stack" style={{ gap: 6 }}>
                      <div className="row-between"><h3 className="ellipsis">{l.gathering.title}</h3><DebtBadge status={l.status} /></div>
                      <div className="row-between small">
                        <span className="faint">Total <Money cents={l.total} /></span>
                        {mine && <span>Tu saldo: <b><Money cents={mine.net} signed /></b></span>}
                      </div>
                    </Link>
                  );
                })}
              </>
            );
          })()}
        </div>
      )}
    </Page>
  );
}
