import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bell, BookOpen, Camera, Download, LogOut, Moon, RotateCcw, Smartphone, Sun, SunMoon, Database, KeyRound } from 'lucide-react';
import { useAction, useApp } from '../app/AppContext';
import { useInstallPrompt } from '../components/pwa';
import { ask, Field, Page, ProfileAvatar, Segmented, Spinner, Switch } from '../components/ui';
import { DemoBackend } from '../data/demoBackend';
import { supabaseConfigured, switchMode } from '../data';
import { compressImage } from '../lib/image';
import { profileName } from '../lib/insights';
import { currentSubscription, disablePush, enablePush, isIOS, isStandalone, pushSupport } from '../lib/push';
import { getThemePref, setThemePref, type ThemePref } from '../lib/theme';

export default function Settings() {
  const { backend, user, profile, refreshProfile, toast } = useApp();
  const { run, busy } = useAction();
  const [name, setName] = useState(profile?.display_name ?? '');
  const [alias, setAlias] = useState(profile?.alias ?? '');
  const [theme, setTheme] = useState<ThemePref>(getThemePref());
  const [pushOn, setPushOn] = useState(false);
  const [pw, setPw] = useState('');
  const { canInstall, install } = useInstallPrompt();
  const support = pushSupport(backend);

  useEffect(() => {
    setName(profile?.display_name ?? '');
    setAlias(profile?.alias ?? '');
  }, [profile]);
  useEffect(() => {
    currentSubscription().then((s) => setPushOn(!!s)).catch(() => undefined);
  }, []);

  const saveProfile = () => run(async () => {
    if (!name.trim()) throw new Error('Tu nombre no puede quedar vacío');
    await backend.updateProfile({ display_name: name.trim(), alias: alias.trim() || null });
    await refreshProfile();
  }, 'Perfil guardado');

  async function uploadAvatar(f: File | undefined) {
    if (!f || !user) return;
    await run(async () => {
      const path = await backend.uploadFile('avatars', user.id, await compressImage(f, 400, 0.8));
      await backend.updateProfile({ avatar_url: path });
      await refreshProfile();
    }, 'Foto actualizada');
  }

  async function togglePush(v: boolean) {
    await run(async () => {
      if (v) await enablePush(backend);
      else await disablePush(backend);
      setPushOn(v);
    }, v ? 'Notificaciones activadas' : 'Notificaciones desactivadas');
  }

  return (
    <Page title="Perfil y ajustes">
      <div className="stack-lg">
        <section className="card stack">
          <div className="row" style={{ gap: 14 }}>
            <label style={{ position: 'relative', cursor: 'pointer' }} aria-label="Cambiar foto">
              <ProfileAvatar profile={profile ?? undefined} name={profileName(profile ?? undefined)} size="lg" />
              <span className="icon-btn" style={{ position: 'absolute', right: -6, bottom: -6, width: 30, height: 30, background: 'var(--ember)', color: 'var(--ember-ink)', borderRadius: 10 }}><Camera size={16} /></span>
              <input type="file" accept="image/*" hidden onChange={(e) => uploadAvatar(e.target.files?.[0])} />
            </label>
            <div className="grow">
              <h2>{profileName(profile ?? undefined)}</h2>
              <p className="faint small ellipsis">{user?.email}</p>
            </div>
          </div>
          <Field label="Nombre"><input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} /></Field>
          <Field label="Alias (opcional)" hint="Se muestra a quien te debe plata, por ejemplo tu alias de transferencia."><input className="input" value={alias} onChange={(e) => setAlias(e.target.value)} maxLength={30} placeholder="tu.alias.mp" /></Field>
          <button className="btn btn-primary" onClick={saveProfile} disabled={busy}>{busy ? <Spinner /> : 'Guardar perfil'}</button>
        </section>

        <section className="card stack">
          <h3><SunMoon size={18} style={{ verticalAlign: -3 }} /> Apariencia</h3>
          <Segmented ariaLabel="Tema" value={theme} onChange={(t) => { setTheme(t); setThemePref(t); }}
            options={[{ value: 'system', label: 'Automático' }, { value: 'dark', label: <><Moon size={14} style={{ verticalAlign: -2 }} /> Oscuro</> }, { value: 'light', label: <><Sun size={14} style={{ verticalAlign: -2 }} /> Claro</> }]} />
        </section>

        <section className="card stack">
          <h3><Bell size={18} style={{ verticalAlign: -3 }} /> Notificaciones push</h3>
          {support === 'ok' || (support === 'denied' && pushOn) ? (
            <div className="row-between"><span className="small">Recibir avisos en este dispositivo</span><Switch on={pushOn} onChange={togglePush} label="Notificaciones push" /></div>
          ) : (
            <p className="small muted">
              {support === 'ios-needs-install' && 'En iPhone/iPad las notificaciones funcionan solo con la app instalada (iOS 16.4 o superior). Instalala desde Compartir → "Agregar a inicio" y activalas desde ahí.'}
              {support === 'unsupported' && 'Este navegador no admite notificaciones push. Igual vas a ver todos los avisos dentro de la app.'}
              {support === 'denied' && 'Bloqueaste las notificaciones para este sitio. Podés habilitarlas desde los ajustes del navegador.'}
              {support === 'no-server' && (backend.mode === 'demo' ? 'En la demo los avisos se ven dentro de la app (campanita). Las notificaciones push funcionan en la versión real.' : 'El servidor de notificaciones push todavía no está configurado. Los avisos se ven dentro de la app.')}
            </p>
          )}
          <p className="hint">Solo te avisamos lo importante: propuestas, fechas confirmadas, pagos y recordatorios. Nunca duplicados.</p>
        </section>

        <section className="card stack">
          <h3><Smartphone size={18} style={{ verticalAlign: -3 }} /> Instalar la app</h3>
          {isStandalone() ? <p className="small pos">✓ Ya estás usando la app instalada.</p> : canInstall ? (
            <button className="btn btn-primary" onClick={() => install().then((ok) => ok && toast('¡App instalada!', 'success'))}><Download /> Instalar La Juntada</button>
          ) : (
            <p className="small muted">{isIOS() ? 'En Safari tocá el botón Compartir (cuadrado con flecha) y elegí "Agregar a inicio".' : 'Abrí el menú del navegador (⋮) y elegí "Instalar app" o "Agregar a pantalla principal".'}</p>
          )}
          <Link to="/ayuda" className="btn"><BookOpen /> Guía de uso e instalación</Link>
        </section>

        {backend.mode === 'supabase' && (
          <section className="card stack">
            <h3><KeyRound size={18} style={{ verticalAlign: -3 }} /> Cambiar contraseña</h3>
            <div className="row"><input className="input" type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Nueva contraseña" autoComplete="new-password" />
              <button className="btn" disabled={busy || pw.length < 6} onClick={() => run(() => backend.updatePassword(pw).then(() => setPw('')), 'Contraseña actualizada')}>Guardar</button></div>
          </section>
        )}

        {backend instanceof DemoBackend && (
          <section className="card stack">
            <h3><Database size={18} style={{ verticalAlign: -3 }} /> Modo demo</h3>
            <p className="small muted">Estás usando datos ficticios guardados solo en este navegador. No se mezclan con datos reales.</p>
            <button className="btn" onClick={async () => { if (await ask('¿Restaurar los datos de demostración originales? Se pierden los cambios de prueba.', { danger: true, confirmLabel: 'Restaurar' })) { backend.reset(); location.reload(); } }}><RotateCcw /> Restaurar datos de demo</button>
            {supabaseConfigured && <button className="btn btn-primary" onClick={() => switchMode('supabase')}>Usar la app real</button>}
          </section>
        )}

        <button className="btn btn-danger" onClick={() => backend.signOut()}><LogOut /> Cerrar sesión</button>
        <p className="hint center">La Juntada · v1.0 · {backend.mode === 'demo' ? 'modo demo' : 'conectado a Supabase'}</p>
      </div>
    </Page>
  );
}
