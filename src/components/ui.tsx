import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Check, CircleCheck, HelpCircle, X, AlertTriangle, Info } from 'lucide-react';
import { useApp } from '../app/AppContext';
import { initials } from '../lib/format';
import { formatMoney, parseMoney } from '../lib/money';
import type { DebtStatus } from '../lib/balances';
import { DEBT_STATUS_LABEL } from '../lib/balances';
import type { GatheringStatus, Profile } from '../lib/types';
import { STATUS_LABEL } from '../lib/labels';

// ------------------------------------------------------------------ page shell
export function Page({ title, back, actions, children, wide }: { title?: ReactNode; back?: string | true; actions?: ReactNode; children: ReactNode; wide?: boolean }) {
  const nav = useNavigate();
  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          {back ? (
            <button className="icon-btn" aria-label="Volver" onClick={() => (back === true ? nav(-1) : nav(back))}>
              <ArrowLeft />
            </button>
          ) : (
            <Link to="/" className="brand" aria-label="La Juntada, inicio">
              <span className="brand-mark"><Logo size={18} /></span>
            </Link>
          )}
          <div className="topbar-title">{title}</div>
          {actions}
        </div>
      </header>
      <main className={`main fade-in ${wide ? 'wide' : ''}`}>{children}</main>
    </>
  );
}

export function Logo({ size = 24 }: { size?: number }) {
  // Brasa + copa: identidad de La Juntada.
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 2c1.5 2.6 4.5 4.3 4.5 8a4.5 4.5 0 0 1-9 0c0-1.9.9-3.1 1.8-4.1.3 1.4 1 2.3 2 2.7C11 6.6 11.2 4.2 12 2Z" />
      <path d="M5 21h14" />
      <path d="M7 17.5h10" />
    </svg>
  );
}

// ------------------------------------------------------------------ avatars
const PALETTE = ['#e9561c', '#c2410c', '#b45309', '#0f766e', '#2563eb', '#7c3aed', '#be185d', '#15803d', '#9333ea', '#0369a1'];
export function colorFor(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export function useFileUrl(path: string | null | undefined) {
  const { backend } = useApp();
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setUrl(null);
    if (path) backend.fileUrl(path).then((u) => alive && setUrl(u)).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [backend, path]);
  return url;
}

export function Avatar({ name, seed, url, size }: { name: string; seed?: string; url?: string | null; size?: 'sm' | 'lg' }) {
  const src = useFileUrl(url);
  return (
    <span className={`avatar ${size ?? ''}`} style={{ background: src ? undefined : colorFor(seed ?? name) }} title={name} aria-hidden>
      {src ? <img src={src} alt="" loading="lazy" /> : initials(name)}
    </span>
  );
}

export function ProfileAvatar({ profile, name, size }: { profile?: Profile; name: string; size?: 'sm' | 'lg' }) {
  return <Avatar name={name} seed={profile?.id ?? name} url={profile?.avatar_url} size={size} />;
}

export function GroupIcon({ name, id, url, size = 46 }: { name: string; id: string; url?: string | null; size?: number }) {
  const src = useFileUrl(url);
  return (
    <span className="group-icon" style={{ width: size, height: size, background: src ? undefined : `linear-gradient(135deg, ${colorFor(id)}, ${colorFor(id + 'x')})` }}>
      {src ? <img src={src} alt="" /> : initials(name.replace(/\(DEMO\)/, ''))}
    </span>
  );
}

// ------------------------------------------------------------------ badges
export function StatusBadge({ status }: { status: GatheringStatus }) {
  return <span className={`badge b-${status}`}>{STATUS_LABEL[status]}</span>;
}
export function DebtBadge({ status }: { status: DebtStatus }) {
  return <span className={`badge b-${status}`}>{DEBT_STATUS_LABEL[status]}</span>;
}
export function Money({ cents, signed, className }: { cents: number; signed?: boolean; className?: string }) {
  const cls = signed ? (cents > 0 ? 'pos' : cents < 0 ? 'neg' : 'faint') : '';
  return <span className={`num ${cls} ${className ?? ''}`}>{signed && cents > 0 ? '+' : ''}{formatMoney(cents)}</span>;
}

// ------------------------------------------------------------------ empty / loading
export function EmptyState({ icon, title, text, action }: { icon: ReactNode; title: string; text?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty fade-in">
      <div className="empty-art">{icon}</div>
      <h3>{title}</h3>
      {text && <p>{text}</p>}
      {action && <div style={{ marginTop: 6 }}>{action}</div>}
    </div>
  );
}
export function Skeleton({ h = 80, n = 1 }: { h?: number; n?: number }) {
  return (
    <div className="stack" aria-busy="true" aria-label="Cargando">
      {Array.from({ length: n }, (_, i) => <div key={i} className="skeleton" style={{ height: h }} />)}
    </div>
  );
}
export function Spinner() {
  return <span className="spinner" aria-label="Cargando" />;
}
export function LoadError({ text, onRetry }: { text: string; onRetry?: () => void }) {
  return (
    <EmptyState icon={<AlertTriangle />} title="No pudimos cargar esto" text={text}
      action={onRetry && <button className="btn" onClick={onRetry}>Reintentar</button>} />
  );
}

// ------------------------------------------------------------------ sheet
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="overlay" onClick={onClose} role="presentation">
      <div className="sheet" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        {title && (
          <div className="row-between" style={{ marginBottom: 14 }}>
            <h2>{title}</h2>
            <button className="icon-btn" aria-label="Cerrar" onClick={onClose}><X /></button>
          </div>
        )}
        {children}
      </div>
    </div>,
    document.body
  );
}

export function ConfirmSheet({ open, onClose, onConfirm, title, text, confirmLabel = 'Confirmar', danger, busy }: {
  open: boolean; onClose: () => void; onConfirm: () => void; title: string; text?: ReactNode; confirmLabel?: string; danger?: boolean; busy?: boolean;
}) {
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <div className="stack">
        {text && <p className="muted">{text}</p>}
        <div className="grid-2" style={{ marginTop: 6 }}>
          <button className="btn" onClick={onClose}>Cancelar</button>
          <button className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={onConfirm} disabled={busy}>
            {busy ? <Spinner /> : confirmLabel}
          </button>
        </div>
      </div>
    </Sheet>
  );
}

// ------------------------------------------------------------------ inputs
export function Field({ label, hint, error, children }: { label?: string; hint?: ReactNode; error?: string | null; children: ReactNode }) {
  return (
    <label className="field">
      {label && <span className="label">{label}</span>}
      {children}
      {error ? <span className="error-text">{error}</span> : hint ? <span className="hint">{hint}</span> : null}
    </label>
  );
}

export function Segmented<T extends string | number>({ value, onChange, options, ariaLabel }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[]; ariaLabel?: string;
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={ariaLabel}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" role="radio" aria-checked={value === o.value} className={value === o.value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} className={`switch ${on ? 'on' : ''}`} onClick={() => onChange(!on)} />;
}

export function CheckRow({ on, onToggle, children }: { on: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <div role="checkbox" aria-checked={on} tabIndex={0} className={`check-row ${on ? 'on' : ''}`} onClick={onToggle}
      onKeyDown={(e) => (e.key === ' ' || e.key === 'Enter') && (e.preventDefault(), onToggle())}>
      <span className="check">{on && <Check />}</span>
      {children}
    </div>
  );
}

/** Campo de importe en pesos: acepta "50.000", "1.234,56", etc. */
export function MoneyInput({ cents, onChange, big, placeholder = '$ 0', autoFocus, id, ariaLabel }: {
  cents: number | null; onChange: (c: number | null) => void; big?: boolean; placeholder?: string; autoFocus?: boolean; id?: string; ariaLabel?: string;
}) {
  const [text, setText] = useState(cents ? formatMoney(cents).replace('$ ', '') : '');
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(cents ? formatMoney(cents).replace('$ ', '') : '');
  }, [cents, focused]);
  return (
    <input id={id} aria-label={ariaLabel} className={`input num ${big ? 'money' : ''}`} inputMode="decimal" autoComplete="off" placeholder={placeholder} value={text} autoFocus={autoFocus}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onChange={(e) => {
        const v = e.target.value.replace(/[^\d.,]/g, '');
        setText(v);
        onChange(v ? parseMoney(v) : null);
      }} />
  );
}

// ------------------------------------------------------------------ toasts
export function Toasts() {
  const { toasts } = useApp();
  return createPortal(
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          {t.kind === 'success' ? <CircleCheck /> : t.kind === 'error' ? <AlertTriangle /> : <Info />}
          <span>{t.text}</span>
        </div>
      ))}
    </div>,
    document.body
  );
}

export function HelpTip({ children }: { children: ReactNode }) {
  return (
    <p className="hint row" style={{ alignItems: 'flex-start', gap: 6 }}>
      <HelpCircle size={15} style={{ flexShrink: 0, marginTop: 2 }} />
      <span>{children}</span>
    </p>
  );
}
