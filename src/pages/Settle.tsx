import { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowDown, Paperclip } from 'lucide-react';
import { useAction, useApp, useGatheringSnapshot } from '../app/AppContext';
import { Field, LoadError, MoneyInput, Page, Segmented, Skeleton, Spinner } from '../components/ui';
import { todayISODate } from '../lib/format';
import { compressImage } from '../lib/image';
import { PAY_METHODS } from '../lib/labels';
import { buildLedger } from '../lib/ledger';
import { formatMoney } from '../lib/money';
import type { PayMethod } from '../lib/types';

/** Registrar una transferencia para saldar (total o parcial). */
export default function Settle() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const { backend, user } = useApp();
  const { run, busy } = useAction();
  const { snap, gathering, error, reload } = useGatheringSnapshot(id);
  const [from, setFrom] = useState(params.get('de') ?? '');
  const [to, setTo] = useState(params.get('a') ?? '');
  const [amount, setAmount] = useState<number | null>(Number(params.get('monto')) || null);
  const [method, setMethod] = useState<PayMethod>('transferencia');
  const [paidOn, setPaidOn] = useState(todayISODate());
  const [notes, setNotes] = useState('');
  const [file, setFile] = useState<File | null>(null);
  // Identificador único de este intento: si se toca dos veces "Guardar", no se duplica el pago.
  const [clientRef] = useState(() => crypto.randomUUID());

  if (error && !snap) return <Page title="Registrar pago" back><LoadError text={error} onRetry={reload} /></Page>;
  if (!snap || !gathering || !user) return <Page title="Registrar pago" back><Skeleton h={80} n={4} /></Page>;
  const L = buildLedger(snap, gathering.id, user.id)!;
  const debtors = L.balances.filter((b) => b.net < 0);
  const creditors = L.balances.filter((b) => b.net > 0);
  const maxFrom = from ? -(L.byId[from]?.net ?? 0) : 0;
  const toUser = L.participant(to)?.user_id;
  const willConfirm = toUser === user.id || (!toUser && (snap.members.some((m) => m.user_id === user.id && m.role === 'admin') || gathering.created_by === user.id));

  async function save() {
    if (!from || !to || !amount || !gathering) return;
    const ok = await run(async () => {
      let receipt: string | null = null;
      if (file) receipt = await backend.uploadFile('receipts', `${gathering.group_id}/${gathering.id}`, file.type === 'application/pdf' ? file : await compressImage(file, backend.mode === 'demo' ? 900 : 1600, 0.75));
      return backend.reportSettlement({ gathering_id: gathering.id, from, to, amount_cents: amount, method, paid_on: paidOn, notes: notes.trim() || null, receipt_path: receipt, client_ref: clientRef });
    }, willConfirm ? 'Pago registrado y confirmado' : 'Pago informado. Falta que lo confirme quien cobra.');
    if (ok) {
      reload();
      nav(`/juntadas/${gathering.id}/cuentas`, { replace: true });
    }
  }

  return (
    <Page title="Registrar pago" back={`/juntadas/${gathering.id}/cuentas`}>
      <div className="stack-lg">
        <p className="faint small center">{gathering.title}</p>
        <Field label="Paga">
          <select className="select" value={from} onChange={(e) => setFrom(e.target.value)}>
            <option value="">Elegí quién paga</option>
            {debtors.map((b) => <option key={b.participantId} value={b.participantId}>{L.name(b.participantId)} (debe {formatMoney(-b.net)})</option>)}
          </select>
        </Field>
        <div className="center faint"><ArrowDown /></div>
        <Field label="Cobra">
          <select className="select" value={to} onChange={(e) => setTo(e.target.value)}>
            <option value="">Elegí quién cobra</option>
            {creditors.map((b) => <option key={b.participantId} value={b.participantId}>{L.name(b.participantId)} (le deben {formatMoney(b.net)})</option>)}
          </select>
        </Field>
        <Field label="Importe" hint={maxFrom > 0 ? `Puede ser un pago parcial. Debe en total ${formatMoney(maxFrom)}.` : undefined}>
          <MoneyInput cents={amount} onChange={setAmount} big />
        </Field>
        <Segmented ariaLabel="Medio de pago" value={method} onChange={setMethod} options={PAY_METHODS.map((m) => ({ value: m.id, label: m.label }))} />
        <div className="grid-2">
          <Field label="Fecha"><input className="input" type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} /></Field>
          <Field label="Comprobante">
            <label className="btn" style={{ cursor: 'pointer', minHeight: 48 }}><Paperclip /> {file ? 'Listo' : 'Adjuntar'}<input type="file" accept="image/*,application/pdf" hidden onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
          </Field>
        </div>
        <Field label="Nota (opcional)"><input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} placeholder="Ej: te transferí al alias" /></Field>
        <p className="hint">{willConfirm ? 'Como sos quien cobra, el pago queda confirmado.' : 'Quien cobra va a recibir un aviso para confirmar que le llegó. Hasta entonces no cambia el saldo.'}</p>
        <button className="btn btn-primary btn-block" onClick={save} disabled={busy || !from || !to || !amount}>{busy ? <Spinner /> : 'Registrar pago'}</button>
      </div>
    </Page>
  );
}
