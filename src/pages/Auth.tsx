import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mail, Lock, User, PlayCircle, ArrowLeft } from 'lucide-react';
import { useApp } from '../app/AppContext';
import { friendlyError } from '../data/backend';
import { DemoBackend } from '../data/demoBackend';
import { DEMO_PASSWORD } from '../data/demoSeed';
import { supabaseConfigured, switchMode } from '../data';
import { Avatar, Field, Logo, Spinner } from '../components/ui';

type View = 'login' | 'signup' | 'forgot';

export function AuthPage() {
  const { backend, toast } = useApp();
  const [view, setView] = useState<View>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const demo = backend instanceof DemoBackend ? backend : null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError('Ingresá un email válido.');
    if (view !== 'forgot' && password.length < 6) return setError('La contraseña debe tener al menos 6 caracteres.');
    if (view === 'signup' && !name.trim()) return setError('Contanos cómo te llaman tus amigos.');
    setBusy(true);
    try {
      if (view === 'login') await backend.signIn(email, password);
      else if (view === 'signup') {
        const r = await backend.signUp(email, password, name);
        if (r.needsConfirmation) {
          setInfo('¡Listo! Te mandamos un email para confirmar tu cuenta. Abrí el enlace y volvé a entrar.');
          setView('login');
        } else toast(`¡Bienvenido, ${name.trim()}!`, 'success');
      } else {
        await backend.sendPasswordReset(email);
        setInfo('Si el email está registrado, te llegará un enlace para crear una contraseña nueva.');
      }
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth fade-in">
      <div className="auth-hero">
        <div className="auth-logo"><Logo size={44} /></div>
        <h1>La Juntada</h1>
        <p className="muted" style={{ marginTop: 6 }}>Organizá el asado, cargá lo que pusiste y mirá quién le debe a quién. Sin planillas.</p>
      </div>

      {demo && (
        <div className="card stack" style={{ marginBottom: 18 }}>
          <div>
            <h3>Probá la demo</h3>
            <p className="muted small">Elegí con quién entrar. Podés abrir otra pestaña con otro amigo para ver la sincronización en vivo.</p>
          </div>
          <div className="grid-2">
            {demo.demoUsers().map((u) => (
              <button key={u.id} className="btn" style={{ justifyContent: 'flex-start' }} onClick={() => demo.loginAs(u.id)}>
                <Avatar name={u.profile.display_name} seed={u.id} size="sm" /> {u.profile.display_name}
              </button>
            ))}
          </div>
          <p className="hint">También podés entrar con email: <b>jesus@demo.lajuntada.app</b> · clave <b>{DEMO_PASSWORD}</b>, o crear una cuenta de prueba.</p>
          {supabaseConfigured && <button className="btn btn-ghost btn-sm" onClick={() => switchMode('supabase')}>Volver a la app real</button>}
        </div>
      )}

      <form className="card stack" onSubmit={submit} noValidate>
        {view !== 'login' && (
          <button type="button" className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start', paddingLeft: 0 }} onClick={() => { setView('login'); setError(null); }}>
            <ArrowLeft /> Volver
          </button>
        )}
        <h2>{view === 'login' ? 'Entrar' : view === 'signup' ? 'Crear cuenta' : 'Recuperar contraseña'}</h2>
        {view === 'signup' && (
          <Field label="¿Cómo te dicen?">
            <div className="input-affix"><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: Jesús" autoComplete="nickname" maxLength={60} /><span><User size={18} /></span></div>
          </Field>
        )}
        <Field label="Email">
          <div className="input-affix"><input className="input" type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="vos@email.com" autoComplete="email" /><span><Mail size={18} /></span></div>
        </Field>
        {view !== 'forgot' && (
          <Field label="Contraseña" hint={view === 'signup' ? 'Mínimo 6 caracteres.' : undefined}>
            <div className="input-affix"><input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" autoComplete={view === 'signup' ? 'new-password' : 'current-password'} /><span><Lock size={18} /></span></div>
          </Field>
        )}
        {error && <p className="error-text" role="alert">{error}</p>}
        {info && <p className="small" style={{ color: 'var(--green)' }} role="status">{info}</p>}
        <button className="btn btn-primary btn-block" disabled={busy}>
          {busy ? <Spinner /> : view === 'login' ? 'Entrar' : view === 'signup' ? 'Crear cuenta' : 'Enviar enlace'}
        </button>
        {view === 'login' && (
          <div className="row-between small">
            <button type="button" className="link" style={{ background: 'none', border: 'none', cursor: 'pointer' }} onClick={() => setView('forgot')}>Olvidé mi contraseña</button>
            <button type="button" className="link" style={{ background: 'none', border: 'none', cursor: 'pointer' }} onClick={() => setView('signup')}>Crear cuenta</button>
          </div>
        )}
      </form>

      {!demo && (
        <>
          <div className="divider" style={{ margin: '18px 0' }}>o</div>
          <button className="btn btn-block" onClick={() => switchMode('demo')}><PlayCircle /> Probar la demo sin registrarme</button>
        </>
      )}
      <p className="hint center" style={{ marginTop: 18 }}>Al usar La Juntada aceptás que tus datos se compartan solo con los integrantes de tus grupos.</p>
    </div>
  );
}

export function NewPasswordPage() {
  const { backend, toast } = useApp();
  const nav = useNavigate();
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pw.length < 6) return setError('Mínimo 6 caracteres.');
    if (pw !== pw2) return setError('Las contraseñas no coinciden.');
    setBusy(true);
    try {
      await backend.updatePassword(pw);
      toast('Contraseña actualizada', 'success');
      nav('/');
      history.replaceState(null, '', location.pathname + '#/');
      location.reload();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth">
      <form className="card stack" onSubmit={submit}>
        <h2>Nueva contraseña</h2>
        <Field label="Contraseña nueva"><input className="input" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" /></Field>
        <Field label="Repetila"><input className="input" type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" /></Field>
        {error && <p className="error-text">{error}</p>}
        <button className="btn btn-primary" disabled={busy}>{busy ? <Spinner /> : 'Guardar'}</button>
      </form>
    </div>
  );
}
