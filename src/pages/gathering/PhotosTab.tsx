import { useState } from 'react';
import { Camera, Trash2 } from 'lucide-react';
import { useAction, useApp } from '../../app/AppContext';
import { ask, EmptyState, Sheet, Spinner, useFileUrl } from '../../components/ui';
import { compressImage } from '../../lib/image';
import type { Gathering, GroupSnapshot, Photo } from '../../lib/types';

export default function PhotosTab({ snap, g, canManage, reload }: { snap: GroupSnapshot; g: Gathering; canManage: boolean; reload: () => void }) {
  const { backend, user } = useApp();
  const { run, busy } = useAction();
  const [view, setView] = useState<Photo | null>(null);
  const photos = snap.photos.filter((p) => p.gathering_id === g.id).sort((a, b) => b.created_at.localeCompare(a.created_at));

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    await run(async () => {
      for (const f of Array.from(files).slice(0, 10)) {
        const blob = await compressImage(f, backend.mode === 'demo' ? 900 : 1600, backend.mode === 'demo' ? 0.7 : 0.82);
        const path = await backend.uploadFile('photos', `${g.group_id}/${g.id}`, blob);
        await backend.addPhoto(g.id, path, null);
      }
      reload();
    }, 'Fotos subidas');
  }

  return (
    <div className="stack">
      <label className={`btn btn-primary ${busy ? 'disabled' : ''}`} style={{ cursor: 'pointer' }}>
        {busy ? <Spinner /> : <><Camera /> Subir fotos</>}
        <input type="file" accept="image/*" multiple hidden disabled={busy} onChange={(e) => upload(e.target.files)} />
      </label>
      {photos.length === 0 ? (
        <EmptyState icon={<Camera />} title="Sin fotos" text="Subí las fotos de la juntada para que queden en el recuerdo del grupo." />
      ) : (
        <div className="photo-grid">
          {photos.map((p) => <Thumb key={p.id} photo={p} onClick={() => setView(p)} />)}
        </div>
      )}
      <Sheet open={!!view} onClose={() => setView(null)} title="Foto">
        {view && (
          <div className="stack">
            <Full photo={view} />
            {(view.uploaded_by === user!.id || canManage) && (
              <button className="btn btn-danger" disabled={busy} onClick={async () => { if (!(await ask('¿Borrar esta foto?', { danger: true, confirmLabel: 'Borrar' }))) return; await run(() => backend.deletePhoto(view.id).then(reload), 'Foto borrada'); setView(null); }}><Trash2 /> Borrar</button>
            )}
          </div>
        )}
      </Sheet>
    </div>
  );
}

function Thumb({ photo, onClick }: { photo: Photo; onClick: () => void }) {
  const url = useFileUrl(photo.storage_path);
  return <button className="ph" style={{ border: 'none', padding: 0, cursor: 'pointer' }} onClick={onClick} aria-label="Ver foto">{url && <img src={url} alt={photo.caption ?? 'Foto de la juntada'} loading="lazy" />}</button>;
}
function Full({ photo }: { photo: Photo }) {
  const url = useFileUrl(photo.storage_path);
  return url ? <img src={url} alt={photo.caption ?? 'Foto'} style={{ borderRadius: 14, width: '100%' }} /> : <Spinner />;
}
