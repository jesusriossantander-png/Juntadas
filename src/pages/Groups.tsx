import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ChevronRight, Plus, UserPlus, Users, ImagePlus } from 'lucide-react';
import { useAction, useApp } from '../app/AppContext';
import { NotificationsButton } from '../components/common';
import { EmptyState, Field, GroupIcon, Page, Sheet, Skeleton, Spinner } from '../components/ui';
import { compressImage } from '../lib/image';

export default function Groups() {
  const { groups, setActiveGroupId, activeGroupId } = useApp();
  const [params, setParams] = useSearchParams();
  const [open, setOpen] = useState(params.get('crear') === '1');
  useEffect(() => {
    if (params.get('crear') === '1') setOpen(true);
  }, [params]);
  const close = () => {
    setOpen(false);
    if (params.has('crear')) setParams({}, { replace: true });
  };

  return (
    <Page title="Mis grupos" actions={<NotificationsButton />}>
      <div className="stack">
        <div className="grid-2">
          <button className="btn btn-primary" onClick={() => setOpen(true)}><Plus /> Crear grupo</button>
          <Link className="btn" to="/unirse"><UserPlus /> Unirme</Link>
        </div>
        {!groups && <Skeleton h={72} n={3} />}
        {groups?.length === 0 && (
          <EmptyState icon={<Users />} title="Todavía no tenés grupos" text="Creá uno para tus amigos del asado, del laburo o de la facu, y compartí el código de invitación." />
        )}
        {groups && groups.length > 0 && (
          <div className="card flush list">
            {groups.map((g) => (
              <Link key={g.group.id} to={`/grupos/${g.group.id}`} className="list-item" onClick={() => setActiveGroupId(g.group.id)}>
                <GroupIcon name={g.group.name} id={g.group.id} url={g.group.image_url} />
                <div className="grow">
                  <div className="row" style={{ gap: 6 }}>
                    <span className="bold ellipsis">{g.group.name}</span>
                    {g.role === 'admin' && <span className="badge b-admin">Admin</span>}
                  </div>
                  <div className="faint small ellipsis">{g.member_count} integrantes{g.group.description ? ` · ${g.group.description}` : ''}</div>
                </div>
                {g.group.id === activeGroupId && <span className="badge b-confirmed">Activo</span>}
                <ChevronRight className="faint" size={20} />
              </Link>
            ))}
          </div>
        )}
      </div>
      <CreateGroupSheet open={open} onClose={close} />
    </Page>
  );
}

function CreateGroupSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { backend, refreshGroups, setActiveGroupId } = useApp();
  const { run, busy } = useAction();
  const nav = useNavigate();
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [image, setImage] = useState<File | null>(null);
  async function create() {
    const id = await run(async () => {
      if (!name.trim()) throw new Error('Poné un nombre para el grupo');
      const gid = await backend.createGroup(name.trim(), desc.trim() || null, null);
      if (image) {
        const path = await backend.uploadFile('photos', gid, await compressImage(image, 512));
        await backend.updateGroup(gid, { image_url: path });
      }
      return gid;
    }, '¡Grupo creado!');
    if (id) {
      await refreshGroups();
      setActiveGroupId(id);
      onClose();
      setName('');
      setDesc('');
      setImage(null);
      nav(`/grupos/${id}?invitar=1`);
    }
  }
  return (
    <Sheet open={open} onClose={onClose} title="Nuevo grupo">
      <div className="stack">
        <Field label="Nombre"><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: Los del Asado" maxLength={80} autoFocus /></Field>
        <Field label="Descripción (opcional)"><input className="input" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Amigos de la secundaria" maxLength={500} /></Field>
        <label className="btn" style={{ cursor: 'pointer' }}>
          <ImagePlus /> {image ? image.name : 'Agregar imagen (opcional)'}
          <input type="file" accept="image/*" hidden onChange={(e) => setImage(e.target.files?.[0] ?? null)} />
        </label>
        <button className="btn btn-primary" onClick={create} disabled={busy}>{busy ? <Spinner /> : 'Crear grupo'}</button>
      </div>
    </Sheet>
  );
}
