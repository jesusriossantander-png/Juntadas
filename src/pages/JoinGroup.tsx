import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Ticket, Users } from 'lucide-react';
import { useAction, useApp } from '../app/AppContext';
import { Field, Page, Spinner } from '../components/ui';

export default function JoinGroup() {
  const params = useParams();
  const { backend, refreshGroups, setActiveGroupId } = useApp();
  const { run, busy } = useAction();
  const nav = useNavigate();
  const [code, setCode] = useState((params.code ?? '').toUpperCase());
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof backend.previewInvitation>> | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    setPreview(null);
    const c = code.trim();
    if (c.length !== 8) return;
    setChecking(true);
    backend.previewInvitation(c).then(setPreview).catch(() => setPreview(null)).finally(() => setChecking(false));
  }, [backend, code]);

  async function join() {
    const gid = await run(() => backend.acceptInvitation(code.trim()), preview?.already_member ? undefined : '¡Te sumaste al grupo!');
    if (gid) {
      await refreshGroups();
      setActiveGroupId(gid);
      nav('/');
    }
  }

  return (
    <Page title="Unirme a un grupo" back="/grupos">
      <div className="stack">
        <div className="empty" style={{ paddingBottom: 10 }}>
          <div className="empty-art"><Ticket /></div>
          <p>Ingresá el código de 8 letras que te pasaron o abrí directamente el enlace de invitación.</p>
        </div>
        <Field label="Código de invitación">
          <input className="input center amount-lg" style={{ letterSpacing: '.2em', textTransform: 'uppercase' }} value={code} maxLength={8}
            onChange={(e) => setCode(e.target.value.replace(/[^a-z0-9]/gi, '').toUpperCase())} placeholder="ABCD2345" autoFocus={!params.code} autoCapitalize="characters" />
        </Field>
        {checking && <div className="center"><Spinner /></div>}
        {preview && (
          <div className="card stack fade-in">
            {preview.group_name ? (
              <>
                <div className="row"><Users color="var(--ember)" /><div className="grow"><div className="bold">{preview.group_name}</div><div className="faint small">{preview.member_count} integrantes</div></div></div>
                {preview.already_member ? <p className="small pos">Ya sos parte de este grupo.</p> : !preview.is_valid && <p className="error-text">Esta invitación venció, se anuló o ya no tiene cupo. Pedí una nueva.</p>}
                <button className="btn btn-primary" onClick={join} disabled={busy || (!preview.is_valid && !preview.already_member)}>
                  {busy ? <Spinner /> : preview.already_member ? 'Ir al grupo' : 'Sumarme al grupo'}
                </button>
              </>
            ) : (
              <p className="error-text">No encontramos ese código. Revisalo o pedí uno nuevo.</p>
            )}
          </div>
        )}
      </div>
    </Page>
  );
}
