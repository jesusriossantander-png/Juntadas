import { Link } from 'react-router-dom';
import { ChevronRight, Vote } from 'lucide-react';
import { useApp, useSnapshot } from '../app/AppContext';
import { GroupSwitcher, NotificationsButton } from '../components/common';
import { EmptyState, LoadError, Page, Skeleton, StatusBadge } from '../components/ui';
import { formatDateTime } from '../lib/format';
import { tallyDates } from '../lib/votes';

export default function Polls() {
  const { activeGroupId, user } = useApp();
  const { snap, error, reload } = useSnapshot(activeGroupId);
  return (
    <Page title={<GroupSwitcher />} back="/" actions={<NotificationsButton />}>
      <div className="stack">
        <div className="row"><Vote color="var(--ember)" /><h1 style={{ fontSize: '1.35rem' }}>Votaciones</h1></div>
        {!snap && !error && <Skeleton h={90} n={3} />}
        {error && !snap && <LoadError text={error} onRetry={reload} />}
        {snap && (() => {
          const open = snap.gatherings.filter((g) => g.status === 'proposed');
          if (!open.length) return <EmptyState icon={<Vote />} title="No hay votaciones abiertas" text="Proponé una juntada con varias fechas y el grupo vota cuál le queda mejor." action={<Link className="btn btn-primary" to="/juntadas/nueva">Proponer juntada</Link>} />;
          return open.map((g) => {
            const props = snap.dateProposals.filter((d) => d.gathering_id === g.id);
            const votes = snap.dateVotes.filter((v) => props.some((p) => p.id === v.proposal_id));
            const top = tallyDates(props, votes)[0];
            const voted = votes.some((v) => v.user_id === user?.id);
            return (
              <Link key={g.id} to={`/juntadas/${g.id}/votos`} className="card card-link stack" style={{ gap: 6 }}>
                <div className="row-between"><h3>{g.title}</h3><StatusBadge status={g.status} /></div>
                <p className="small muted">{props.length} fechas propuestas · {new Set(votes.map((v) => v.user_id)).size} de {snap.members.length} votaron</p>
                {top?.isWinner && <p className="small">Va ganando: <b>{formatDateTime(top.proposal.starts_at)}</b>{top.isTied ? ' (empate)' : ''}</p>}
                <div className="row-between small"><span className={voted ? 'pos' : 'neg'}>{voted ? '✓ Ya votaste' : 'Te falta votar'}</span><ChevronRight size={18} /></div>
              </Link>
            );
          });
        })()}
      </div>
    </Page>
  );
}
