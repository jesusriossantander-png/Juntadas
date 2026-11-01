import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, BarChart3, Beer, CalendarPlus, History, Plus, Share2, UserPlus, Vote, Wallet, HandCoins } from 'lucide-react';
import { useApp, useSnapshot } from '../app/AppContext';
import { GatheringCard, GroupSwitcher, NotificationsButton } from '../components/common';
import { EmptyState, Money, Page, Skeleton, LoadError } from '../components/ui';
import { groupStats, isUpcoming, profileName, reminderState } from '../lib/insights';
import { myOpenTransfers, pendingConfirmations } from '../lib/ledger';
import { formatMoney } from '../lib/money';
import { appUrl, messages, whatsappUrl } from '../lib/whatsapp';
import { formatDateTime } from '../lib/format';

export default function Dashboard() {
  const { groups, activeGroupId, user, profile } = useApp();
  const { snap, error, reload } = useSnapshot(activeGroupId);
  const nav = useNavigate();

  if (groups && groups.length === 0) {
    return (
      <Page title={<span className="brand">La Juntada</span>} actions={<NotificationsButton />}>
        <EmptyState icon={<Beer />} title={`¡Hola${profile ? `, ${profileName(profile)}` : ''}!`}
          text="Para arrancar, creá un grupo con tus amigos o sumate a uno con el código que te pasaron."
          action={
            <div className="stack" style={{ width: 260 }}>
              <Link className="btn btn-primary" to="/grupos?crear=1"><Plus /> Crear un grupo</Link>
              <Link className="btn" to="/unirse"><UserPlus /> Tengo un código</Link>
            </div>
          } />
      </Page>
    );
  }

  return (
    <Page title={<GroupSwitcher />} actions={<NotificationsButton />}>
      {!snap && !error && <Skeleton h={140} n={3} />}
      {error && !snap && <LoadError text={error} onRetry={reload} />}
      {snap && user && (() => {
        const me = myOpenTransfers(snap, user.id);
        const confirmations = pendingConfirmations(snap, user.id);
        const rem = reminderState(snap);
        const stats = groupStats(snap);
        const upcoming = snap.gatherings.filter((g) => isUpcoming(g)).sort((a, b) => (a.starts_at ?? '9').localeCompare(b.starts_at ?? '9'));
        const net = me.owed - me.owe;
        return (
          <div className="stack-lg">
            <div>
              <h1>¡Hola, {profileName(profile ?? undefined)}! 👋</h1>
              <p className="muted">{snap.group.name.replace(' (DEMO)', '')} · {snap.members.length} integrantes</p>
            </div>

            {rem.due && (
              <div className="card alert stack fade-in">
                <div>
                  <h2>🍻 ¡Hace {rem.days} días que no se juntan!</h2>
                  <p className="muted" style={{ marginTop: 4 }}>
                    {rem.neverMet ? 'Todavía no registraron ninguna juntada.' : 'Ya va siendo hora de organizar otro asado.'}
                  </p>
                </div>
                <div className="grid-2">
                  <button className="btn btn-primary" onClick={() => nav(`/juntadas/nueva?grupo=${snap.group.id}`)}><CalendarPlus /> Proponer juntada</button>
                  <a className="btn btn-wa" href={whatsappUrl(messages.proposal(rem.neverMet ? null : rem.days, appUrl('/juntadas/nueva')))} target="_blank" rel="noreferrer"><Share2 /> Avisar</a>
                </div>
              </div>
            )}

            <Link to="/juntadas?tab=cuentas" className="card hero card-link">
              <div className="kpi-hero">
                <div>
                  <div className="small muted bold">Tu saldo en el grupo</div>
                  <div className="amount-xl">{net === 0 ? 'Al día' : formatMoney(Math.abs(net))}</div>
                  <div className="muted small">
                    {net > 0 ? 'Te deben en total' : net < 0 ? 'Debés en total' : me.items.length ? 'Lo que debés y te deben se compensa' : 'No tenés cuentas pendientes 🎉'}
                  </div>
                </div>
                <Wallet size={40} style={{ opacity: .9 }} />
              </div>
            </Link>

            {confirmations.length > 0 && (
              <div className="card stack">
                <div className="row"><HandCoins color="var(--amber)" /><h3 className="grow">Pagos para confirmar</h3><span className="badge b-partial">{confirmations.length}</span></div>
                {confirmations.slice(0, 3).map((s) => {
                  const g = snap.gatherings.find((x) => x.id === s.gathering_id)!;
                  return (
                    <Link key={s.id} to={`/juntadas/${g.id}/cuentas`} className="row-between small">
                      <span className="ellipsis">{g.title}</span>
                      <span className="row"><Money cents={s.amount_cents} /> <ArrowRight size={16} /></span>
                    </Link>
                  );
                })}
              </div>
            )}

            {me.items.length > 0 && (
              <section className="stack">
                <div className="section-title"><h2>¿Quién le debe a quién?</h2></div>
                <div className="card flush list">
                  {me.items.slice(0, 5).map((d) => (
                    <Link key={d.gathering.id + d.transfer.from + d.transfer.to} to={`/juntadas/${d.gathering.id}/cuentas`} className="list-item">
                      <div className="grow">
                        <div className="bold">{d.direction === 'pay' ? `Le debés a ${d.otherName}` : `${d.otherName} te debe`}</div>
                        <div className="faint xsmall ellipsis">{d.gathering.title}</div>
                      </div>
                      <b className={d.direction === 'pay' ? 'neg num' : 'pos num'}>{formatMoney(d.transfer.amountCents)}</b>
                    </Link>
                  ))}
                </div>
              </section>
            )}

            <section className="stack">
              <div className="section-title">
                <h2>Próximas juntadas</h2>
                <Link to="/juntadas">Ver todas</Link>
              </div>
              {upcoming.length === 0 ? (
                <div className="card center stack" style={{ alignItems: 'center' }}>
                  <p className="muted">No hay nada organizado todavía.</p>
                  <Link to={`/juntadas/nueva?grupo=${snap.group.id}`} className="btn btn-primary btn-sm"><Plus /> Proponer una</Link>
                </div>
              ) : (
                upcoming.slice(0, 3).map((g) => <GatheringCard key={g.id} g={g} snap={snap} showTotals={false} />)
              )}
            </section>

            <section className="stack">
              <div className="section-title"><h2>El grupo en números</h2><Link to="/estadisticas">Estadísticas</Link></div>
              <div className="grid-2">
                <div className="stat"><div className="stat-label">Juntadas</div><div className="stat-value">{stats.heldCount}</div><div className="stat-sub">realizadas</div></div>
                <div className="stat"><div className="stat-label">Total gastado</div><div className="stat-value">{formatMoney(stats.totalSpent)}</div><div className="stat-sub">en todas</div></div>
                <div className="stat"><div className="stat-label">Última</div><div className="stat-value">{stats.daysSinceLast == null ? '—' : `${stats.daysSinceLast} días`}</div><div className="stat-sub ellipsis">{stats.last?.title ?? 'Sin juntadas aún'}</div></div>
                <div className="stat"><div className="stat-label">Promedio p/persona</div><div className="stat-value">{formatMoney(stats.avgPerPerson)}</div><div className="stat-sub">por juntada</div></div>
              </div>
              {stats.next?.starts_at && <p className="faint small center">Próxima: {stats.next.title} · {formatDateTime(stats.next.starts_at)}</p>}
            </section>

            <div className="grid-3">
              <Link to="/historial" className="card card-link tight center stack" style={{ gap: 6, alignItems: 'center' }}><History color="var(--ember)" /><span className="small bold">Historial</span></Link>
              <Link to="/votaciones" className="card card-link tight center stack" style={{ gap: 6, alignItems: 'center' }}><Vote color="var(--ember)" /><span className="small bold">Votaciones</span></Link>
              <Link to="/estadisticas" className="card card-link tight center stack" style={{ gap: 6, alignItems: 'center' }}><BarChart3 color="var(--ember)" /><span className="small bold">Números</span></Link>
            </div>
          </div>
        );
      })()}
    </Page>
  );
}
