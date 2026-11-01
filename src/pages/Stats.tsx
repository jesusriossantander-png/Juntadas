import { useMemo, useState } from 'react';
import { BarChart3 } from 'lucide-react';
import { useApp, useSnapshot } from '../app/AppContext';
import { HBars, MonthlyBars } from '../components/charts';
import { GroupSwitcher } from '../components/common';
import { EmptyState, LoadError, Page, Segmented, Skeleton } from '../components/ui';
import { formatDate } from '../lib/format';
import { groupStats, profileName } from '../lib/insights';
import { categoryOf } from '../lib/labels';
import { formatMoney } from '../lib/money';

type Period = '3m' | '6m' | '12m' | 'all';
const DAY = 86_400_000;

export default function Stats() {
  const { activeGroupId } = useApp();
  const { snap, error, reload } = useSnapshot(activeGroupId);
  const [period, setPeriod] = useState<Period>('12m');
  const stats = useMemo(() => {
    if (!snap) return null;
    const days = { '3m': 92, '6m': 183, '12m': 366, all: null }[period];
    return groupStats(snap, days ? { from: Date.now() - days * DAY } : {});
  }, [snap, period]);

  return (
    <Page title={<GroupSwitcher />} back="/">
      <div className="stack-lg">
        <div className="row"><BarChart3 color="var(--ember)" /><h1 style={{ fontSize: '1.35rem' }}>Estadísticas</h1></div>
        <Segmented ariaLabel="Período" value={period} onChange={setPeriod} options={[{ value: '3m', label: '3 meses' }, { value: '6m', label: '6 meses' }, { value: '12m', label: '12 meses' }, { value: 'all', label: 'Todo' }]} />
        {!snap && !error && <Skeleton h={100} n={4} />}
        {error && !snap && <LoadError text={error} onRetry={reload} />}
        {snap && stats && (stats.heldCount === 0 ? (
          <EmptyState icon={<BarChart3 />} title="Sin juntadas en este período" text="Cuando se realicen juntadas con gastos, acá vas a ver la evolución del grupo." />
        ) : (
          <>
            <div className="grid-2">
              <div className="stat"><div className="stat-label">Juntadas realizadas</div><div className="stat-value">{stats.heldCount}</div></div>
              <div className="stat"><div className="stat-label">Total gastado</div><div className="stat-value">{formatMoney(stats.totalSpent)}</div></div>
              <div className="stat"><div className="stat-label">Promedio por juntada</div><div className="stat-value">{formatMoney(stats.avgPerGathering)}</div></div>
              <div className="stat"><div className="stat-label">Promedio por persona</div><div className="stat-value">{formatMoney(stats.avgPerPerson)}</div></div>
              <div className="stat"><div className="stat-label">Última juntada</div><div className="stat-value" style={{ fontSize: '1.05rem' }}>{stats.last?.title ?? '—'}</div><div className="stat-sub">{stats.last ? `${formatDate(stats.last.starts_at)} · hace ${stats.daysSinceLast} días` : ''}</div></div>
              <div className="stat"><div className="stat-label">Próxima</div><div className="stat-value" style={{ fontSize: '1.05rem' }}>{stats.next?.title ?? '—'}</div><div className="stat-sub">{stats.next ? (stats.next.starts_at ? formatDate(stats.next.starts_at) : 'Fecha en votación') : 'Nada organizado'}</div></div>
            </div>
            <section className="card stack">
              <h3>Gasto por mes</h3>
              <MonthlyBars data={stats.byMonth} />
            </section>
            {stats.byCategory.length > 0 && (
              <section className="card stack">
                <h3>¿En qué se va la plata?</h3>
                <HBars rows={stats.byCategory.map((c) => ({ label: `${categoryOf(c.category).emoji} ${categoryOf(c.category).label}`, value: c.total }))} format={formatMoney} />
              </section>
            )}
            <section className="card stack">
              <h3>Asistencia</h3>
              <HBars rows={stats.attendance.filter((a) => a.invited > 0).map((a) => ({ label: profileName(snap.profiles[a.userId]), value: Math.round(a.rate * 100), sub: `${a.attended}/${a.invited}` }))} format={(v) => `${v}%`} />
            </section>
            {stats.topOrganizers.length > 0 && (
              <section className="card stack">
                <h3>¿Quién organiza más?</h3>
                <HBars rows={stats.topOrganizers.map((o) => ({ label: `${o === stats.topOrganizers[0] ? '🏆 ' : ''}${profileName(snap.profiles[o.userId])}`, value: o.count }))} format={(v) => `${v} ${v === 1 ? 'juntada' : 'juntadas'}`} />
              </section>
            )}
          </>
        ))}
      </div>
    </Page>
  );
}
