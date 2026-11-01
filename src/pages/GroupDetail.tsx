import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Bell, Copy, Crown, LogOut, MoreVertical, Pencil, Share2, Trash2, UserMinus, UserPlus, Link as LinkIcon } from 'lucide-react';
import { useAction, useApp, useSnapshot } from '../app/AppContext';
import { ask, ConfirmSheet, Field, GroupIcon, LoadError, Page, ProfileAvatar, Segmented, Sheet, Skeleton, Spinner, Switch } from '../components/ui';
import { formatDate } from '../lib/format';
import { profileName } from '../lib/insights';
import { REMINDER_PRESETS } from '../lib/labels';
import type { Invitation } from '../lib/types';
import { appUrl, messages, whatsappUrl } from '../lib/whatsapp';

export default function GroupDetail() {
  const { groupId } = useParams();
  const [params] = useSearchParams();
  const { backend, user, toast, refreshGroups } = useApp();
  const { snap, error, reload } = useSnapshot(groupId);
  const { run, busy } = useAction();
  const nav = useNavigate();
  const [invites, setInvites] = useState<Invitation[]>([]);
  const [inviteOpen, setInviteOpen] = useState(params.get('invitar') === '1');
  const [editOpen, setEditOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [memberMenu, setMemberMenu] = useState<string | null>(null);
  const [customOpen, setCustomOpen] = useState(false);
  const [customDays, setCustomDays] = useState('');

  const loadInvites = useCallback(() => {
    if (groupId) backend.listInvitations(groupId).then(setInvites).catch(() => undefined);
  }, [backend, groupId]);
  useEffect(loadInvites, [loadInvites]);

  if (error && !snap) return <Page title="Grupo" back="/grupos"><LoadError text={error} onRetry={reload} /></Page>;
  if (!snap || !user) return <Page title="Grupo" back="/grupos"><Skeleton h={90} n={4} /></Page>;

  const isAdmin = snap.members.some((m) => m.user_id === user.id && m.role === 'admin');
  const active = invites.filter((i) => !i.revoked_at && Date.parse(i.expires_at) > Date.now() && (i.max_uses == null || i.uses < i.max_uses));
  const members = [...snap.members].sort((a, b) => (a.role === b.role ? profileName(snap.profiles[a.user_id]).localeCompare(profileName(snap.profiles[b.user_id])) : a.role === 'admin' ? -1 : 1));
  const s = snap.settings;
  const presetValue = REMINDER_PRESETS.includes(s.reminder_days) ? s.reminder_days : 0;

  const setReminder = (patch: Partial<typeof s>) => run(async () => { await backend.updateSettings(snap.group.id, patch); await reload(); }, 'Recordatorios actualizados');

  return (
    <Page title={snap.group.name} back="/grupos" actions={isAdmin && <button className="icon-btn" aria-label="Editar grupo" onClick={() => setEditOpen(true)}><Pencil /></button>}>
      <div className="stack-lg">
        <div className="row" style={{ gap: 14 }}>
          <GroupIcon name={snap.group.name} id={snap.group.id} url={snap.group.image_url} size={64} />
          <div className="grow">
            <h1 style={{ fontSize: '1.35rem' }}>{snap.group.name}</h1>
            {snap.group.description && <p className="muted small">{snap.group.description}</p>}
            <p className="faint xsmall">Creado el {formatDate(snap.group.created_at)}</p>
          </div>
        </div>

        <section className="stack">
          <div className="section-title"><h2>Integrantes ({members.length})</h2>
            <button className="btn btn-sm btn-primary" onClick={() => setInviteOpen(true)}><UserPlus /> Invitar</button>
          </div>
          <div className="card flush list">
            {members.map((m) => {
              const p = snap.profiles[m.user_id];
              const name = profileName(p);
              return (
                <div key={m.user_id} className="list-item">
                  <ProfileAvatar profile={p} name={name} />
                  <div className="grow">
                    <div className="row" style={{ gap: 6 }}>
                      <span className="bold">{name}{m.user_id === user.id ? ' (vos)' : ''}</span>
                      {m.role === 'admin' && <span className="badge b-admin"><Crown />Admin</span>}
                    </div>
                    <div className="faint xsmall">{p?.alias ? `Alias: ${p.alias} · ` : ''}desde {formatDate(m.joined_at)}</div>
                  </div>
                  {isAdmin && m.user_id !== user.id && (
                    <button className="icon-btn" aria-label={`Opciones de ${name}`} onClick={() => setMemberMenu(m.user_id)}><MoreVertical /></button>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        <section className="stack">
          <div className="section-title"><h2><Bell size={18} style={{ verticalAlign: -3 }} /> Recordatorios</h2></div>
          <div className="card stack">
            <div className="row-between">
              <div>
                <div className="bold">Avisar si no nos juntamos</div>
                <div className="faint small">Les llega a todos cuando pasa el tiempo elegido sin juntada.</div>
              </div>
              <Switch on={s.reminders_enabled} label="Activar recordatorios" onChange={(v) => isAdmin ? setReminder({ reminders_enabled: v }) : toast('Solo un admin puede cambiar esto', 'error')} />
            </div>
            {s.reminders_enabled && (
              <>
                <Segmented ariaLabel="Frecuencia" value={presetValue} onChange={(v) => {
                  if (!isAdmin) return toast('Solo un admin puede cambiar esto', 'error');
                  if (v === 0) setCustomOpen(true);
                  else setReminder({ reminder_days: v });
                }} options={[...REMINDER_PRESETS.map((d) => ({ value: d, label: `${d}d` })), { value: 0, label: presetValue ? 'Otro' : `${s.reminder_days}d` }]} />
                {customOpen && isAdmin && (
                  <div className="row">
                    <div className="input-affix grow"><input className="input" inputMode="numeric" value={customDays} onChange={(e) => setCustomDays(e.target.value.replace(/\D/g, ''))} placeholder="Ej: 21" aria-label="Días personalizados" /><span>días</span></div>
                    <button className="btn btn-primary" disabled={!(Number(customDays) >= 1 && Number(customDays) <= 365)} onClick={() => { setReminder({ reminder_days: Number(customDays) }); setCustomOpen(false); }}>Guardar</button>
                  </div>
                )}
                <p className="hint">Frecuencia actual: cada {s.reminder_days} días. {!isAdmin && 'Solo los administradores pueden cambiarla.'}</p>
              </>
            )}
          </div>
        </section>

        <button className="btn btn-danger" onClick={() => setLeaveOpen(true)}><LogOut /> Abandonar grupo</button>
      </div>

      <InviteSheet open={inviteOpen} onClose={() => setInviteOpen(false)} groupId={snap.group.id} groupName={snap.group.name} active={active} onChange={loadInvites} canRevoke={(i) => isAdmin || i.created_by === user.id} />
      <EditGroupSheet open={editOpen} onClose={() => setEditOpen(false)} snapName={snap.group.name} snapDesc={snap.group.description} groupId={snap.group.id} onSaved={() => { reload(); refreshGroups(); }} />
      <ConfirmSheet open={leaveOpen} onClose={() => setLeaveOpen(false)} danger busy={busy} title="¿Abandonar el grupo?" confirmLabel="Abandonar"
        text="Dejás de ver sus juntadas y cuentas. Tus gastos y pagos registrados se conservan en el historial del grupo. Si sos el último integrante, el grupo se elimina."
        onConfirm={async () => {
          const ok = await run(() => backend.leaveGroup(snap.group.id).then(() => true), 'Saliste del grupo');
          if (ok) { await refreshGroups(); nav('/grupos'); }
        }} />
      <Sheet open={!!memberMenu} onClose={() => setMemberMenu(null)} title={memberMenu ? profileName(snap.profiles[memberMenu]) : ''}>
        {memberMenu && (() => {
          const m = snap.members.find((x) => x.user_id === memberMenu)!;
          return (
            <div className="stack">
              <button className="btn" disabled={busy} onClick={async () => { await run(() => backend.setMemberRole(snap.group.id, m.user_id, m.role === 'admin' ? 'member' : 'admin'), 'Rol actualizado'); setMemberMenu(null); reload(); }}>
                <Crown /> {m.role === 'admin' ? 'Quitar administrador' : 'Hacer administrador'}
              </button>
              <button className="btn btn-danger" disabled={busy} onClick={async () => { if (!(await ask('¿Quitar a esta persona del grupo?', { danger: true, confirmLabel: 'Quitar' }))) return; await run(() => backend.removeMember(snap.group.id, m.user_id), 'Integrante quitado'); setMemberMenu(null); reload(); }}>
                <UserMinus /> Quitar del grupo
              </button>
            </div>
          );
        })()}
      </Sheet>
    </Page>
  );
}

function InviteSheet({ open, onClose, groupId, groupName, active, onChange, canRevoke }: {
  open: boolean; onClose: () => void; groupId: string; groupName: string; active: Invitation[]; onChange: () => void; canRevoke: (i: Invitation) => boolean;
}) {
  const { backend, toast } = useApp();
  const { run, busy } = useAction();
  const [days, setDays] = useState(7);
  const [single, setSingle] = useState(false);
  const share = (code: string) => whatsappUrl(messages.invite(groupName.replace(' (DEMO)', ''), code, appUrl(`/unirse/${code}`)));
  const copy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(appUrl(`/unirse/${code}`));
      toast('Enlace copiado', 'success');
    } catch {
      toast(`Código: ${code}`);
    }
  };
  return (
    <Sheet open={open} onClose={onClose} title="Invitar amigos">
      <div className="stack">
        <p className="muted small">Compartí el enlace o el código. Solo quien lo tenga puede sumarse, y vence solo.</p>
        {active.map((i) => (
          <div key={i.id} className="card tight stack">
            <div className="row-between">
              <div>
                <div className="amount-lg" style={{ letterSpacing: '.12em' }}>{i.code}</div>
                <div className="faint xsmall">Vence el {formatDate(i.expires_at)} · {i.max_uses ? `${i.uses}/${i.max_uses} usos` : `${i.uses} usos`}</div>
              </div>
              {canRevoke(i) && (
                <button className="icon-btn" aria-label="Anular invitación" onClick={() => run(async () => { await backend.revokeInvitation(i.id); onChange(); }, 'Invitación anulada')}><Trash2 /></button>
              )}
            </div>
            <div className="grid-2">
              <button className="btn btn-sm" onClick={() => copy(i.code)}><Copy /> Copiar enlace</button>
              <a className="btn btn-sm btn-wa" href={share(i.code)} target="_blank" rel="noreferrer"><Share2 /> WhatsApp</a>
            </div>
          </div>
        ))}
        <div className="card tight stack">
          <div className="bold row"><LinkIcon size={18} /> Nuevo enlace</div>
          <Segmented ariaLabel="Vencimiento" value={days} onChange={setDays} options={[{ value: 1, label: '1 día' }, { value: 7, label: '7 días' }, { value: 30, label: '30 días' }]} />
          <div className="row-between"><span className="small">Un solo uso</span><Switch on={single} onChange={setSingle} label="Un solo uso" /></div>
          <button className="btn btn-primary" disabled={busy} onClick={() => run(async () => { await backend.createInvitation(groupId, days, single ? 1 : null); onChange(); }, 'Enlace creado')}>
            {busy ? <Spinner /> : 'Generar enlace'}
          </button>
        </div>
      </div>
    </Sheet>
  );
}

function EditGroupSheet({ open, onClose, snapName, snapDesc, groupId, onSaved }: { open: boolean; onClose: () => void; snapName: string; snapDesc: string | null; groupId: string; onSaved: () => void }) {
  const { backend } = useApp();
  const { run, busy } = useAction();
  const [name, setName] = useState(snapName);
  const [desc, setDesc] = useState(snapDesc ?? '');
  const [file, setFile] = useState<File | null>(null);
  useEffect(() => { if (open) { setName(snapName); setDesc(snapDesc ?? ''); } }, [open, snapName, snapDesc]);
  return (
    <Sheet open={open} onClose={onClose} title="Editar grupo">
      <div className="stack">
        <Field label="Nombre"><input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} /></Field>
        <Field label="Descripción"><input className="input" value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={500} /></Field>
        <label className="btn" style={{ cursor: 'pointer' }}>{file ? file.name : 'Cambiar imagen'}<input type="file" accept="image/*" hidden onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
        <button className="btn btn-primary" disabled={busy} onClick={async () => {
          const ok = await run(async () => {
            if (!name.trim()) throw new Error('El nombre no puede quedar vacío');
            const patch: { name: string; description: string | null; image_url?: string } = { name: name.trim(), description: desc.trim() || null };
            if (file) {
              const { compressImage } = await import('../lib/image');
              patch.image_url = await backend.uploadFile('photos', groupId, await compressImage(file, 512));
            }
            await backend.updateGroup(groupId, patch);
            return true;
          }, 'Grupo actualizado');
          if (ok) { onSaved(); onClose(); }
        }}>{busy ? <Spinner /> : 'Guardar'}</button>
      </div>
    </Sheet>
  );
}
