import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Paperclip, Trash2, Users } from 'lucide-react';
import { useAction, useApp, useGatheringSnapshot } from '../app/AppContext';
import { CheckRow, ConfirmSheet, Field, HelpTip, LoadError, Money, MoneyInput, Page, Segmented, Skeleton, Spinner, Switch, useFileUrl } from '../components/ui';
import { todayISODate } from '../lib/format';
import { compressImage } from '../lib/image';
import { participantName } from '../lib/insights';
import { CATEGORIES, SPLIT_LABEL } from '../lib/labels';
import { computeSplit, formatMoney, parseMoney, SplitError, type SplitMethod } from '../lib/money';
import type { ExpenseCategory } from '../lib/types';

export default function ExpenseForm() {
  const { id, expenseId } = useParams();
  const nav = useNavigate();
  const { backend, user } = useApp();
  const { run, busy } = useAction();
  const { snap, gathering, error, reload } = useGatheringSnapshot(id);
  const existing = snap?.expenses.find((e) => e.id === expenseId);
  const participants = useMemo(() => snap?.participants.filter((p) => p.gathering_id === id) ?? [], [snap, id]);
  const me = participants.find((p) => p.user_id === user?.id);

  const [loaded, setLoaded] = useState(false);
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<ExpenseCategory>('carne');
  const [amount, setAmount] = useState<number | null>(null);
  const [spentOn, setSpentOn] = useState(todayISODate());
  const [notes, setNotes] = useState('');
  const [multiPay, setMultiPay] = useState(false);
  const [payer, setPayer] = useState<string>('');
  const [payerAmounts, setPayerAmounts] = useState<Record<string, number | null>>({});
  const [method, setMethod] = useState<SplitMethod>('equal');
  const [included, setIncluded] = useState<Set<string>>(new Set());
  const [values, setValues] = useState<Record<string, string>>({});
  const [receiptPath, setReceiptPath] = useState<string | null>(null);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const receiptUrl = useFileUrl(receiptFile ? null : receiptPath);

  // Inicializar el formulario (nuevo o edición) una sola vez cuando llegan los datos.
  useEffect(() => {
    if (loaded || !snap || !gathering) return;
    if (expenseId && !existing) return;
    if (existing) {
      setDescription(existing.description);
      setCategory(existing.category);
      setAmount(existing.amount_cents);
      setSpentOn(existing.spent_on);
      setNotes(existing.notes ?? '');
      setMethod(existing.split_method);
      setReceiptPath(existing.receipt_path);
      if (existing.payers.length > 1) {
        setMultiPay(true);
        setPayerAmounts(Object.fromEntries(existing.payers.map((p) => [p.participant_id, p.amount_cents])));
      } else setPayer(existing.payers[0]?.participant_id ?? '');
      const inc = existing.splits.filter((s) => s.amount_cents > 0 || s.share > 0);
      setIncluded(new Set(inc.map((s) => s.participant_id)));
      setValues(Object.fromEntries(inc.map((s) => [s.participant_id,
        existing.split_method === 'amount' ? formatMoney(s.amount_cents).replace('$ ', '') : String(s.share).replace('.', ',')])));
    } else {
      setPayer(me?.id ?? participants[0]?.id ?? '');
      setIncluded(new Set(participants.filter((p) => p.rsvp !== 'no').map((p) => p.id)));
    }
    setLoaded(true);
  }, [loaded, snap, gathering, existing, expenseId, me, participants]);

  const includedList = participants.filter((p) => included.has(p.id));

  // Al cambiar de método, precargar valores razonables.
  function changeMethod(m: SplitMethod) {
    setMethod(m);
    const n = includedList.length || 1;
    if (m === 'percent') {
      const base = Math.floor(10000 / n) / 100;
      const last = Math.round((100 - base * (n - 1)) * 100) / 100;
      setValues(Object.fromEntries(includedList.map((p, i) => [p.id, String(i === n - 1 ? last : base).replace('.', ',')])));
    } else if (m === 'weight') setValues(Object.fromEntries(includedList.map((p) => [p.id, '1'])));
    else if (m === 'amount') setValues({});
  }

  const split = useMemo(() => {
    if (!amount || amount <= 0) return { error: 'Ingresá el importe', rows: null };
    try {
      const rows = computeSplit(amount, method, includedList.map((p) => ({
        participantId: p.id,
        value: method === 'equal' ? 1 : method === 'amount' ? (parseMoney(values[p.id] ?? '') ?? 0) : (values[p.id] || '0')
      })));
      return { error: null, rows };
    } catch (e) {
      return { error: e instanceof SplitError ? e.message : 'Revisá los valores del reparto', rows: null };
    }
  }, [amount, method, includedList, values]);

  const payersList = multiPay
    ? Object.entries(payerAmounts).filter(([, v]) => v && v > 0).map(([participant_id, v]) => ({ participant_id, amount_cents: v! }))
    : payer && amount ? [{ participant_id: payer, amount_cents: amount }] : [];
  const paidSum = payersList.reduce((a, p) => a + p.amount_cents, 0);
  const payError = !payersList.length ? 'Indicá quién pagó' : amount && paidSum !== amount ? (paidSum < amount ? `Faltan ${formatMoney(amount - paidSum)} por asignar a quién pagó` : `Lo pagado supera el total por ${formatMoney(paidSum - amount)}`) : null;
  const descError = !description.trim() ? 'Contá qué se compró' : null;
  const canEdit = !existing || existing.created_by === user?.id || snap?.members.some((m) => m.user_id === user?.id && m.role === 'admin') || gathering?.created_by === user?.id;

  async function save() {
    setShowErrors(true);
    if (descError || payError || split.error || !split.rows || !amount || !gathering) return;
    const saved = await run(async () => {
      let path = receiptPath;
      if (receiptFile) {
        const blob = receiptFile.type === 'application/pdf' ? receiptFile : await compressImage(receiptFile, backend.mode === 'demo' ? 900 : 1600, backend.mode === 'demo' ? 0.65 : 0.82);
        path = await backend.uploadFile('receipts', `${gathering.group_id}/${gathering.id}`, blob);
      }
      return backend.saveExpense({
        id: existing?.id, gathering_id: gathering.id, description: description.trim(), category, amount_cents: amount, currency: 'ARS',
        split_method: method, spent_on: spentOn, receipt_path: path, notes: notes.trim() || null, payers: payersList,
        splits: split.rows!.map((r) => ({ participant_id: r.participantId, share: r.share, amount_cents: r.amountCents }))
      });
    }, existing ? 'Gasto actualizado' : '¡Gasto cargado! Las cuentas ya se actualizaron.');
    if (saved) {
      reload();
      nav(`/juntadas/${gathering.id}/gastos`, { replace: true });
    }
  }

  if (error && !snap) return <Page title="Gasto" back><LoadError text={error} onRetry={reload} /></Page>;
  if (!snap || !gathering || !loaded) return <Page title="Gasto" back><Skeleton h={70} n={5} /></Page>;
  const name = (pid: string) => participantName(participants.find((p) => p.id === pid), snap.profiles);
  const assigned = method === 'amount' ? includedList.reduce((a, p) => a + (parseMoney(values[p.id] ?? '') ?? 0), 0) : 0;

  return (
    <Page title={existing ? 'Editar gasto' : 'Nuevo gasto'} back={`/juntadas/${gathering.id}/gastos`}
      actions={existing && canEdit && <button className="icon-btn" aria-label="Eliminar gasto" onClick={() => setConfirmDel(true)}><Trash2 /></button>}>
      <div className="stack-lg">
        <p className="faint small center">{gathering.title}</p>
        {!canEdit && <p className="card tight small" style={{ color: 'var(--amber)' }}>Solo quien cargó este gasto o un administrador puede modificarlo.</p>}
        <fieldset disabled={!canEdit} style={{ border: 'none', padding: 0, margin: 0 }} className="stack-lg">
          <Field error={showErrors && !amount ? 'Ingresá el importe' : null}>
            <MoneyInput cents={amount} onChange={setAmount} big autoFocus={!existing} ariaLabel="Importe" />
          </Field>

          <Field label="¿Qué se compró?" error={showErrors ? descError : null}>
            <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ej: Vacío y chorizos" maxLength={120} />
          </Field>
          <div className="chips" role="radiogroup" aria-label="Categoría">
            {CATEGORIES.map((c) => (
              <button key={c.id} type="button" role="radio" aria-checked={category === c.id} className={`chip ${category === c.id ? 'on' : ''}`}
                onClick={() => { setCategory(c.id); if (!description.trim() && c.id !== 'otros') setDescription(c.label); }}>{c.emoji} {c.label}</button>
            ))}
          </div>

          <section className="stack">
            <div className="row-between"><span className="label">¿Quién pagó?</span><span className="row small">Varios <Switch on={multiPay} onChange={(v) => { setMultiPay(v); if (v && payer && amount) setPayerAmounts({ [payer]: amount }); }} label="Pagaron varios" /></span></div>
            {!multiPay ? (
              <select className="select" value={payer} onChange={(e) => setPayer(e.target.value)} aria-label="Quién pagó">
                {participants.map((p) => <option key={p.id} value={p.id}>{name(p.id)}{p.id === me?.id ? ' (yo)' : ''}</option>)}
              </select>
            ) : (
              <div className="stack" style={{ gap: 8 }}>
                {participants.map((p) => (
                  <div key={p.id} className="row">
                    <span className="grow small bold">{name(p.id)}</span>
                    <div style={{ width: 150 }}><MoneyInput cents={payerAmounts[p.id] ?? null} onChange={(c) => setPayerAmounts({ ...payerAmounts, [p.id]: c })} ariaLabel={`Pagó ${name(p.id)}`} /></div>
                  </div>
                ))}
              </div>
            )}
            {showErrors && payError && <span className="error-text">{payError}</span>}
            {multiPay && !payError && amount ? <span className="hint pos">✓ Lo pagado coincide con el total</span> : null}
          </section>

          <section className="stack">
            <span className="label"><Users size={15} style={{ verticalAlign: -2 }} /> ¿Entre quiénes se divide?</span>
            <Segmented ariaLabel="Método de reparto" value={method} onChange={changeMethod}
              options={(['equal', 'percent', 'amount', 'weight'] as SplitMethod[]).map((m) => ({ value: m, label: m === 'equal' ? 'Iguales' : m === 'percent' ? '%' : m === 'amount' ? '$' : 'Proporción' }))} />
            <HelpTip>
              {method === 'equal' && 'Se divide en partes iguales entre los que marques. Si alguien no tomó cerveza, destildalo.'}
              {method === 'percent' && 'Asigná un porcentaje a cada uno. Tiene que sumar 100%.'}
              {method === 'amount' && 'Escribí cuánto le toca a cada uno. Tiene que sumar el total.'}
              {method === 'weight' && 'Proporciones: por ejemplo 2 para un adulto y 1 para un chico.'}
            </HelpTip>
            <div className="row" style={{ gap: 8 }}>
              <button type="button" className="btn btn-sm" onClick={() => setIncluded(new Set(participants.map((p) => p.id)))}>Todos</button>
              <button type="button" className="btn btn-sm" onClick={() => setIncluded(new Set())}>Ninguno</button>
            </div>
            <div className="stack" style={{ gap: 8 }}>
              {participants.map((p) => {
                const on = included.has(p.id);
                const row = split.rows?.find((r) => r.participantId === p.id);
                return (
                  <CheckRow key={p.id} on={on} onToggle={() => { const s = new Set(included); if (on) s.delete(p.id); else s.add(p.id); setIncluded(s); }}>
                    <span className="grow small bold">{name(p.id)}{p.id === me?.id ? ' (yo)' : ''}</span>
                    {on && method !== 'equal' && (
                      <span onClick={(e) => e.stopPropagation()} className="input-affix" style={{ width: method === 'amount' ? 120 : 92 }}>
                        <input className="input input-sm num" inputMode="decimal" value={values[p.id] ?? ''} aria-label={`Valor para ${name(p.id)}`}
                          onChange={(e) => setValues({ ...values, [p.id]: e.target.value.replace(/[^\d.,]/g, '') })} placeholder={method === 'amount' ? '0' : method === 'weight' ? '1' : '0'} />
                        {method === 'percent' && <span>%</span>}
                      </span>
                    )}
                    <span className="num small" style={{ minWidth: 76, textAlign: 'right' }}>{on && row ? formatMoney(row.amountCents) : on ? '—' : <span className="faint">no paga</span>}</span>
                  </CheckRow>
                );
              })}
            </div>
            {method === 'amount' && amount ? <p className="hint">Asignado {formatMoney(assigned)} de {formatMoney(amount)}{assigned !== amount && ` · ${assigned < amount ? 'faltan' : 'sobran'} ${formatMoney(Math.abs(amount - assigned))}`}</p> : null}
            {split.error && amount ? <span className="error-text">{split.error}</span> : null}
            {split.rows && <p className="hint">Se reparte exacto: la suma da <Money cents={split.rows.reduce((a, r) => a + r.amountCents, 0)} />, sin centavos perdidos.</p>}
          </section>

          <div className="grid-2">
            <Field label="Fecha"><input className="input" type="date" value={spentOn} onChange={(e) => setSpentOn(e.target.value)} /></Field>
            <Field label="Comprobante">
              <label className="btn" style={{ cursor: 'pointer', minHeight: 48 }}>
                <Paperclip /> {receiptFile ? 'Listo' : receiptPath ? 'Cambiar' : 'Adjuntar'}
                <input type="file" accept="image/*,application/pdf" hidden onChange={(e) => setReceiptFile(e.target.files?.[0] ?? null)} />
              </label>
            </Field>
          </div>
          {(receiptFile || receiptUrl) && (
            <div className="row small">
              {receiptFile ? <span className="ellipsis grow">📎 {receiptFile.name}</span> : <a href={receiptUrl!} target="_blank" rel="noreferrer" className="link grow">Ver comprobante actual</a>}
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => { setReceiptFile(null); setReceiptPath(null); }}>Quitar</button>
            </div>
          )}
          <Field label="Observaciones (opcional)"><input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ej: incluye 2 kg de hielo" maxLength={1000} /></Field>
          <button className="btn btn-primary btn-block" onClick={save} disabled={busy}>{busy ? <Spinner /> : existing ? 'Guardar cambios' : `Cargar gasto${amount ? ` de ${formatMoney(amount)}` : ''}`}</button>
          <p className="hint center">Método: {SPLIT_LABEL[method]} · Los importes se guardan al centavo.</p>
        </fieldset>
      </div>
      <ConfirmSheet open={confirmDel} onClose={() => setConfirmDel(false)} danger busy={busy} title="¿Eliminar este gasto?" confirmLabel="Eliminar"
        text="Las cuentas se recalculan. El gasto queda registrado en la auditoría del grupo."
        onConfirm={async () => { const ok = await run(() => backend.deleteExpense(existing!.id).then(() => true), 'Gasto eliminado'); if (ok) { reload(); nav(`/juntadas/${gathering.id}/gastos`, { replace: true }); } }} />
    </Page>
  );
}
