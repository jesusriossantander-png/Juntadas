import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { CircleCheck, X } from 'lucide-react';
import { formatMoney, parseMoney } from './lib/money';

export const pesos = (c: number) => formatMoney(c);

/** Importe en pesos: acepta "50.000", "1.234,50", "2500". */
export function MoneyInput({ cents, onChange, ariaLabel, big, autoFocus }: { cents: number; onChange: (c: number) => void; ariaLabel: string; big?: boolean; autoFocus?: boolean }) {
  const show = (c: number) => (c ? formatMoney(c).replace('$ ', '') : '');
  const [text, setText] = useState(show(cents));
  const [focus, setFocus] = useState(false);
  useEffect(() => {
    if (!focus) setText(show(cents));
  }, [cents, focus]);
  return (
    <div className="input-affix">
      <input className={`input num ${big ? 'money' : ''}`} style={{ paddingLeft: 26 }} inputMode="decimal" autoComplete="off" placeholder="0"
        aria-label={ariaLabel} value={text} autoFocus={autoFocus}
        onFocus={(e) => { setFocus(true); e.target.select(); }} onBlur={() => setFocus(false)}
        onChange={(e) => {
          const v = e.target.value.replace(/[^\d.,]/g, '');
          setText(v);
          onChange(v ? parseMoney(v) ?? 0 : 0);
        }} />
      <span style={{ left: 12, right: 'auto' }}>$</span>
    </div>
  );
}

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="overlay" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="row-between" style={{ marginBottom: 12 }}>
          <h2>{title}</h2>
          <button className="icon-btn" aria-label="Cerrar" onClick={onClose}><X /></button>
        </div>
        {children}
      </div>
    </div>,
    document.body
  );
}

/** Confirmación propia (los confirm() del navegador se ven mal en el celular). */
export function Confirm({ text, label, onYes, onClose }: { text: string | null; label: string; onYes: () => void; onClose: () => void }) {
  return (
    <Sheet open={!!text} onClose={onClose} title={text ?? ''}>
      <div className="grid-2">
        <button className="btn" onClick={onClose}>Cancelar</button>
        <button className="btn btn-danger" onClick={() => { onYes(); onClose(); }}>{label}</button>
      </div>
    </Sheet>
  );
}

let pushToast: ((t: string) => void) | null = null;
export const toast = (t: string) => pushToast?.(t);
export function Toasts() {
  const [items, setItems] = useState<{ id: number; t: string }[]>([]);
  useEffect(() => {
    let n = 0;
    pushToast = (t) => {
      const id = ++n;
      setItems((x) => [...x.slice(-1), { id, t }]);
      setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), 2600);
    };
    return () => { pushToast = null; };
  }, []);
  return createPortal(
    <div className="toasts" role="status" aria-live="polite">
      {items.map((i) => <div key={i.id} className="toast success"><CircleCheck />{i.t}</div>)}
    </div>,
    document.body
  );
}

export function Logo({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 2c1.5 2.6 4.5 4.3 4.5 8a4.5 4.5 0 0 1-9 0c0-1.9.9-3.1 1.8-4.1.3 1.4 1 2.3 2 2.7C11 6.6 11.2 4.2 12 2Z" />
      <path d="M5 21h14" />
      <path d="M7 17.5h10" />
    </svg>
  );
}

export function fechaLarga(iso: string) {
  const d = new Date(`${iso}T12:00:00`);
  const s = new Intl.DateTimeFormat('es-AR', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(d).replace(/\./g, '');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export const whatsapp = (texto: string) => `https://wa.me/?text=${encodeURIComponent(texto)}`;
