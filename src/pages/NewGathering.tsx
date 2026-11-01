import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CalendarCheck, Plus, Vote, X } from 'lucide-react';
import { useAction, useApp } from '../app/AppContext';
import { EmptyState, Field, Page, Segmented, Spinner, Switch } from '../components/ui';
import { formatDateTime, fromLocalInput } from '../lib/format';

export default function NewGathering() {
  const { backend, groups, activeGroupId, setActiveGroupId } = useApp();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const { run, busy } = useAction();
  const [groupId, setGroupId] = useState(params.get('grupo') ?? activeGroupId ?? groups?.[0]?.group.id ?? '');
  const [title, setTitle] = useState('Asado');
  const [mode, setMode] = useState<'vote' | 'fixed'>('vote');
  const [when, setWhen] = useState('');
  const [options, setOptions] = useState<string[]>(['', '']);
  const [location, setLocation] = useState('');
  const [description, setDescription] = useState('');
  const [notes, setNotes] = useState('');
  const [inviteAll, setInviteAll] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  if (groups && groups.length === 0) {
    return <Page title="Nueva juntada" back="/"><EmptyState icon={<CalendarCheck />} title="Primero creá un grupo" text="Las juntadas se organizan dentro de un grupo de amigos." /></Page>;
  }

  async function submit() {
    setErr(null);
    if (!groupId) return setErr('Elegí un grupo');
    if (!title.trim()) return setErr('Poné un nombre para la juntada');
    const opts = options.map(fromLocalInput).filter(Boolean) as string[];
    const startsAt = mode === 'fixed' ? fromLocalInput(when) : null;
    if (mode === 'fixed' && !startsAt) return setErr('Elegí fecha y hora');
    if (mode === 'vote' && opts.length === 0) return setErr('Sugerí al menos una fecha para votar');
    const id = await run(
      () => backend.createGathering({
        group_id: groupId, title: title.trim(), starts_at: startsAt, location: location.trim() || null,
        description: description.trim() || null, notes: notes.trim() || null,
        status: mode === 'fixed' ? 'confirmed' : 'proposed', invite_all: inviteAll, date_options: mode === 'vote' ? [...new Set(opts)] : []
      }),
      mode === 'fixed' ? '¡Juntada creada!' : '¡Propuesta creada! Compartila para que voten.'
    );
    if (id) {
      setActiveGroupId(groupId);
      nav(`/juntadas/${id}`, { replace: true });
    }
  }

  const suggestions = ['Asado', 'Pizzas', 'Picada', 'Cumpleaños', 'Empanadas', 'Fútbol + asado'];

  return (
    <Page title="Nueva juntada" back>
      <div className="stack">
        {groups && groups.length > 1 && (
          <Field label="Grupo">
            <select className="select" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
              {groups.map((g) => <option key={g.group.id} value={g.group.id}>{g.group.name}</option>)}
            </select>
          </Field>
        )}
        <Field label="¿Qué hacemos?">
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={100} placeholder="Ej: Asado del mes" />
        </Field>
        <div className="chips">{suggestions.map((s) => <button key={s} type="button" className={`chip ${title === s ? 'on' : ''}`} onClick={() => setTitle(s)}>{s}</button>)}</div>

        <Segmented ariaLabel="Fecha" value={mode} onChange={setMode} options={[{ value: 'vote', label: <><Vote size={15} style={{ verticalAlign: -2 }} /> Votar fecha</> }, { value: 'fixed', label: <><CalendarCheck size={15} style={{ verticalAlign: -2 }} /> Ya hay fecha</> }]} />

        {mode === 'fixed' ? (
          <Field label="Fecha y hora"><input className="input" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} /></Field>
        ) : (
          <div className="stack" style={{ gap: 8 }}>
            <span className="label">Opciones de fecha y hora</span>
            {options.map((o, i) => (
              <div className="row" key={i}>
                <input className="input" type="datetime-local" value={o} aria-label={`Opción ${i + 1}`} onChange={(e) => setOptions(options.map((x, k) => (k === i ? e.target.value : x)))} />
                {options.length > 1 && <button className="icon-btn" aria-label="Quitar opción" onClick={() => setOptions(options.filter((_, k) => k !== i))}><X /></button>}
              </div>
            ))}
            {options.some(Boolean) && <p className="hint">{options.filter(Boolean).map((o) => formatDateTime(fromLocalInput(o))).join(' · ')}</p>}
            {options.length < 8 && <button className="btn btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setOptions([...options, ''])}><Plus /> Agregar otra fecha</button>}
          </div>
        )}

        <Field label="Lugar o dirección" hint="Si todavía no saben, lo pueden votar después."><input className="input" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Ej: Quincho de Pablo" maxLength={200} /></Field>
        <Field label="Descripción (opcional)"><textarea className="textarea" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} placeholder="¿Qué se festeja? ¿Qué hay que llevar?" /></Field>
        <Field label="Notas (opcional)"><input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} placeholder="Ej: cada uno trae su bebida" /></Field>
        <div className="card tight row-between">
          <div><div className="bold">Invitar a todo el grupo</div><div className="faint small">Después podés sumar invitados externos.</div></div>
          <Switch on={inviteAll} onChange={setInviteAll} label="Invitar a todo el grupo" />
        </div>
        {err && <p className="error-text" role="alert">{err}</p>}
        <button className="btn btn-primary btn-block" onClick={submit} disabled={busy}>{busy ? <Spinner /> : mode === 'vote' ? 'Crear propuesta' : 'Crear juntada'}</button>
      </div>
    </Page>
  );
}
