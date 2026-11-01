import { Link } from 'react-router-dom';
import { ArrowRight, Check, Clock, HandCoins, MessageCircle, PartyPopper, Share2, Wallet, X } from 'lucide-react';
import { useAction, useApp } from '../../app/AppContext';
import { Avatar, DebtBadge, EmptyState, Money, ProfileAvatar, useFileUrl } from '../../components/ui';
import { debtStatus } from '../../lib/balances';
import { formatDate } from '../../lib/format';
import { PAY_METHODS } from '../../lib/labels';
import { buildLedger } from '../../lib/ledger';
import { formatMoney } from '../../lib/money';
import type { Gathering, GroupSnapshot, Settlement } from '../../lib/types';
import { appUrl, messages, whatsappUrl } from '../../lib/whatsapp';

export default function AccountsTab({ snap, g, isAdmin, canManage, reload }: { snap: GroupSnapshot; g: Gathering; isAdmin: boolean; canManage: boolean; reload: () => void }) {
  const { user, backend } = useApp();
  const { run, busy } = useAction();
  const L = buildLedger(snap, g.id, user!.id)!;
  const settlements = snap.settlements.filter((s) => s.gathering_id === g.id).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const meId = L.me?.id;
  const avatarOf = (pid: string, size?: 'sm' | 'lg') => {
    const p = L.participant(pid);
    return p?.user_id ? <ProfileAvatar profile={snap.profiles[p.user_id]} name={L.name(pid)} size={size} /> : <Avatar name={L.name(pid)} size={size} />;
  };
  const people = [...L.balances].filter((b) => b.paid || b.owed || b.sent || b.received).sort((a, b) => b.net - a.net);
  const maxAbs = Math.max(1, ...people.map((b) => Math.abs(b.initialNet)));
  const pendingIn = (from: string, to: string) => settlements.filter((s) => s.status === 'reported' && s.from_participant === from && s.to_participant === to).reduce((a, s) => a + s.amount_cents, 0);
  const canReview = (s: Settlement) => {
    const to = L.participant(s.to_participant);
    const from = L.participant(s.from_participant);
    return s.status === 'reported' && (to?.user_id === user!.id || (isAdmin && from?.user_id !== user!.id));
  };
  const canRegister = (from: string, to: string) => {
    const f = L.participant(from), t = L.participant(to);
    return f?.user_id === user!.id || t?.user_id === user!.id || canManage;
  };

  if (L.total === 0) {
    return <EmptyState icon={<Wallet />} title="Todavía no hay cuentas" text="Cuando se carguen gastos, acá aparece quién le debe a quién y cuánto." action={<Link className="btn btn-primary" to={`/juntadas/${g.id}/gastos/nuevo`}>Cargar un gasto</Link>} />;
  }

  return (
    <div className="stack-lg">
      <div className="card stack">
        <div className="row-between">
          <div>
            <div className="stat-label">Total gastado</div>
            <div className="amount-xl"><Money cents={L.total} /></div>
          </div>
          <DebtBadge status={L.status} />
        </div>
        <a className="btn btn-wa" href={whatsappUrl(messages.accounts(g.title, appUrl(`/juntadas/${g.id}/cuentas`)))} target="_blank" rel="noreferrer"><Share2 /> Compartir cuentas por WhatsApp</a>
      </div>

      <section className="stack">
        <div className="section-title"><h2>¿Quién le debe a quién?</h2></div>
        {L.transfers.length === 0 ? (
          <div className="card center stack" style={{ alignItems: 'center' }}>
            <PartyPopper color="var(--green)" size={36} />
            <h3>¡Cuentas saldadas!</h3>
            <p className="muted small">Nadie le debe nada a nadie en esta juntada.</p>
          </div>
        ) : (
          L.transfers.map((t) => {
            const mineOut = t.from === meId, mineIn = t.to === meId;
            const pend = pendingIn(t.from, t.to);
            const creditor = L.participant(t.to);
            const alias = creditor?.user_id ? snap.profiles[creditor.user_id]?.alias ?? null : null;
            return (
              <div key={t.from + t.to} className={`card flush ${mineOut || mineIn ? 'alert' : ''}`}>
                <div className="transfer">
                  <div className="transfer-person">{avatarOf(t.from)}<span className="name">{mineOut ? 'Vos' : L.name(t.from)}</span></div>
                  <div className="transfer-arrow"><span className="amt">{formatMoney(t.amountCents)}</span><ArrowRight /><span className="xsmall faint">le paga a</span></div>
                  <div className="transfer-person">{avatarOf(t.to)}<span className="name">{mineIn ? 'Vos' : L.name(t.to)}</span></div>
                </div>
                {alias && mineOut && <p className="small center" style={{ marginTop: -6, paddingBottom: 8 }}>Alias: <b>{alias}</b></p>}
                {pend > 0 && <p className="xsmall center" style={{ color: 'var(--amber)', paddingBottom: 8 }}><Clock size={12} style={{ verticalAlign: -2 }} /> {formatMoney(pend)} informado, esperando confirmación</p>}
                {canRegister(t.from, t.to) && t.amountCents - pend > 0 && (
                  <div className="row" style={{ padding: '0 12px 12px' }}>
                    <Link className="btn btn-sm btn-primary grow" to={`/juntadas/${g.id}/pagar?de=${t.from}&a=${t.to}&monto=${t.amountCents - pend}`}>
                      <HandCoins /> {mineIn ? 'Me pagó' : mineOut ? 'Ya pagué' : 'Registrar pago'}
                    </Link>
                    {mineIn && (
                      <a className="btn btn-sm btn-wa" aria-label="Recordar por WhatsApp" href={whatsappUrl(messages.debt(L.name(t.from), t.amountCents, g.title, alias ?? snap.profiles[user!.id]?.alias ?? null, appUrl(`/juntadas/${g.id}/cuentas`)))} target="_blank" rel="noreferrer"><MessageCircle /></a>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </section>

      <section className="stack">
        <div className="section-title"><h2>Detalle por persona</h2></div>
        <div className="card flush list">
          {people.map((b) => {
            const st = debtStatus(b);
            const w = (Math.abs(b.initialNet) / maxAbs) * 50;
            return (
              <div key={b.participantId} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
                <div className="row">
                  {avatarOf(b.participantId, 'sm')}
                  <div className="grow">
                    <div className="bold small">{L.name(b.participantId)}{b.participantId === meId ? ' (vos)' : ''}</div>
                    <div className="faint xsmall">Puso <Money cents={b.paid} /> · le tocaba <Money cents={b.owed} /></div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div className="bold"><Money cents={b.net} signed /></div>
                    {st !== 'none' && <DebtBadge status={st} />}
                  </div>
                </div>
                <div className="balance-bar" aria-hidden>
                  <span className="mid" />
                  <i style={b.initialNet >= 0 ? { left: '50%', width: `${w}%`, background: 'var(--green)' } : { right: '50%', width: `${w}%`, background: 'var(--red)' }} />
                </div>
              </div>
            );
          })}
        </div>
        <p className="hint">Verde: puso de más, le tienen que devolver. Rojo: le falta poner. El saldo incluye los pagos confirmados.</p>
      </section>

      <section className="stack">
        <div className="section-title"><h2>Pagos registrados</h2></div>
        {settlements.length === 0 ? <p className="faint small">Todavía no se registró ningún pago.</p> : (
          <div className="card flush list">
            {settlements.map((s) => (
              <SettlementRow key={s.id} s={s} from={L.name(s.from_participant)} to={L.name(s.to_participant)} canReview={canReview(s)} busy={busy}
                onReview={(ok) => run(() => backend.reviewSettlement(s.id, ok).then(reload), ok ? 'Pago confirmado' : 'Pago rechazado')} />
            ))}
          </div>
        )}
        <p className="hint">Un pago informado por quien paga queda pendiente hasta que quien cobra lo confirme. Así nadie duplica ni borra pagos.</p>
      </section>
    </div>
  );
}

function SettlementRow({ s, from, to, canReview, onReview, busy }: { s: Settlement; from: string; to: string; canReview: boolean; onReview: (ok: boolean) => void; busy: boolean }) {
  const receipt = useFileUrl(s.receipt_path);
  const method = PAY_METHODS.find((m) => m.id === s.method)?.label ?? s.method;
  return (
    <div className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
      <div className="row">
        <div className="grow">
          <div className="small"><b>{from}</b> → <b>{to}</b></div>
          <div className="faint xsmall">{method} · {formatDate(s.paid_on)}{s.notes ? ` · ${s.notes}` : ''}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className={`bold ${s.status === 'rejected' ? 'faint' : ''}`} style={s.status === 'rejected' ? { textDecoration: 'line-through' } : undefined}><Money cents={s.amount_cents} /></div>
          <span className={`badge ${s.status === 'confirmed' ? 'b-settled' : s.status === 'reported' ? 'b-partial' : 'b-cancelled'}`}>
            {s.status === 'confirmed' ? 'Confirmado' : s.status === 'reported' ? 'Por confirmar' : 'Rechazado'}
          </span>
        </div>
      </div>
      {receipt && <a href={receipt} target="_blank" rel="noreferrer" className="link xsmall">Ver comprobante</a>}
      {canReview && (
        <div className="grid-2">
          <button className="btn btn-sm btn-danger" disabled={busy} onClick={() => onReview(false)}><X /> No lo recibí</button>
          <button className="btn btn-sm btn-success" disabled={busy} onClick={() => onReview(true)}><Check /> Lo recibí</button>
        </div>
      )}
    </div>
  );
}
