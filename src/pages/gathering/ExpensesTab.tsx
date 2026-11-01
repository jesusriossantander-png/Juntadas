import { Link } from 'react-router-dom';
import { Paperclip, Plus, Receipt } from 'lucide-react';
import { useApp } from '../../app/AppContext';
import { EmptyState, Money } from '../../components/ui';
import { formatDate } from '../../lib/format';
import { categoryOf, SPLIT_LABEL } from '../../lib/labels';
import { buildLedger } from '../../lib/ledger';
import type { Gathering, GroupSnapshot } from '../../lib/types';

export default function ExpensesTab({ snap, g }: { snap: GroupSnapshot; g: Gathering; canManage: boolean }) {
  const { user } = useApp();
  const ledger = buildLedger(snap, g.id, user!.id)!;
  const expenses = snap.expenses.filter((e) => e.gathering_id === g.id).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const byCat = new Map<string, number>();
  expenses.forEach((e) => byCat.set(e.category, (byCat.get(e.category) ?? 0) + e.amount_cents));
  const cats = [...byCat.entries()].sort((a, b) => b[1] - a[1]);
  const canAdd = g.status !== 'cancelled';

  return (
    <div className="stack">
      {canAdd && <Link to={`/juntadas/${g.id}/gastos/nuevo`} className="btn btn-primary"><Plus /> Cargar lo que pagué</Link>}
      {expenses.length === 0 ? (
        <EmptyState icon={<Receipt />} title="Sin gastos todavía" text="Cada uno carga lo que compró: la carne, las bebidas, el carbón… La app hace las cuentas sola." />
      ) : (
        <>
          <div className="card stack">
            <div className="row-between"><span className="stat-label">Total de la juntada</span><span className="amount-lg"><Money cents={ledger.total} /></span></div>
            {cats.map(([c, v]) => (
              <div key={c} className="stack" style={{ gap: 4 }}>
                <div className="row-between small"><span>{categoryOf(c).emoji} {categoryOf(c).label}</span><span className="num">{Math.round((v / ledger.total) * 100)}% · <Money cents={v} /></span></div>
                <div className="bar"><i style={{ width: `${(v / ledger.total) * 100}%` }} /></div>
              </div>
            ))}
          </div>
          <div className="card flush list">
            {expenses.map((e) => {
              const cat = categoryOf(e.category);
              const payers = e.payers.map((p) => ledger.name(p.participant_id)).join(' y ');
              const among = e.splits.filter((s) => s.amount_cents > 0).length;
              const mine = ledger.me ? e.splits.find((s) => s.participant_id === ledger.me!.id)?.amount_cents ?? 0 : 0;
              return (
                <Link key={e.id} to={`/juntadas/${g.id}/gastos/${e.id}`} className="list-item">
                  <span className="cat-icon" aria-hidden>{cat.emoji}</span>
                  <div className="grow">
                    <div className="bold ellipsis">{e.description} {e.receipt_path && <Paperclip size={13} className="faint" />}</div>
                    <div className="faint xsmall ellipsis">Pagó {payers} · {SPLIT_LABEL[e.split_method].toLowerCase()} entre {among} · {formatDate(e.spent_on)}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div className="bold"><Money cents={e.amount_cents} /></div>
                    {ledger.me && <div className="xsmall faint">{mine ? <>a vos <Money cents={mine} /></> : 'no participás'}</div>}
                  </div>
                </Link>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
