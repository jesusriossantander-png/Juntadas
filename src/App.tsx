import { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight, BellRing, Calculator, Check, ChevronDown, Download, History, Pencil, Plus, Save, Settings, Share2, Trash2, Upload, UserPlus, X, RotateCcw
} from 'lucide-react';
import {
  calcular, cargar, diasSinJuntarse, fechaLocal, guardar, sumarAmigos, tocaJuntarse, validar, type Datos, type Juntada, type Persona
} from './lib/juntada';
import { getThemePref, setThemePref, type ThemePref } from './lib/theme';
import { Confirm, Logo, MoneyInput, Toasts, fechaLarga, pesos, toast, whatsapp } from './ui';

type Tab = 'calcular' | 'registro' | 'ajustes';
type Borrador = { id?: string; fecha: string; titulo: string; personas: Persona[] };

const BORRADOR_KEY = 'la-juntada:borrador:v1';
const nuevaPersona = (nombre = ''): Persona => ({ id: crypto.randomUUID(), nombre, puso: 0, participa: true });
const borradorVacio = (amigos: string[]): Borrador => ({
  fecha: fechaLocal(),
  titulo: '',
  personas: amigos.length ? [] : [nuevaPersona(), nuevaPersona(), nuevaPersona()]
});

export default function App() {
  const [datos, setDatosState] = useState<Datos>(() => cargar());
  const [tab, setTab] = useState<Tab>('calcular');
  const [borrador, setBorrador] = useState<Borrador>(() => {
    try {
      const b = JSON.parse(localStorage.getItem(BORRADOR_KEY) || 'null');
      if (b?.personas) return b;
    } catch { /* nada */ }
    return borradorVacio(cargar().amigos);
  });
  const setDatos = (d: Datos) => { setDatosState(d); guardar(d); };
  useEffect(() => { try { localStorage.setItem(BORRADOR_KEY, JSON.stringify(borrador)); } catch { /* nada */ } }, [borrador]);

  const aviso = tocaJuntarse(datos);

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-inner">
          <span className="brand"><span className="brand-mark"><Logo size={18} /></span> La Juntada</span>
        </div>
      </header>
      <main className="main fade-in" key={tab}>
        {aviso != null && tab !== 'ajustes' && <Aviso dias={aviso} />}
        {tab === 'calcular' && <Calculadora datos={datos} setDatos={setDatos} b={borrador} setB={setBorrador} irARegistro={() => setTab('registro')} />}
        {tab === 'registro' && <Registro datos={datos} setDatos={setDatos} editar={(j) => { setBorrador({ id: j.id, fecha: j.fecha, titulo: j.titulo, personas: j.personas }); setTab('calcular'); }} />}
        {tab === 'ajustes' && <Ajustes datos={datos} setDatos={setDatos} />}
      </main>
      <nav className="bottomnav" aria-label="Secciones">
        <div className="bottomnav-inner" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
          {([['calcular', 'Calcular', Calculator], ['registro', 'Registro', History], ['ajustes', 'Ajustes', Settings]] as const).map(([id, label, Icon]) => (
            <button key={id} className={`navlink ${tab === id ? 'active' : ''}`} style={{ background: 'none', border: 'none', cursor: 'pointer' }}
              aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id)}>
              <Icon /><span>{label}</span>
            </button>
          ))}
        </div>
      </nav>
      <Toasts />
    </div>
  );
}

function Aviso({ dias }: { dias: number }) {
  return (
    <div className="card alert stack" style={{ marginBottom: 18 }}>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <BellRing color="var(--ember)" style={{ flexShrink: 0, marginTop: 2 }} />
        <div>
          <h2>🍻 ¡Hace {dias} días que no se juntan!</h2>
          <p className="muted small" style={{ marginTop: 4 }}>Ya va siendo hora de organizar otro asado.</p>
        </div>
      </div>
      <a className="btn btn-wa" href={whatsapp(`🍻 Muchachos, ya pasaron ${dias} días desde la última juntada. ¿Organizamos otra?`)} target="_blank" rel="noreferrer"><Share2 /> Avisar al grupo por WhatsApp</a>
    </div>
  );
}

// ---------------------------------------------------------------- calculadora
function Calculadora({ datos, setDatos, b, setB, irARegistro }: {
  datos: Datos; setDatos: (d: Datos) => void; b: Borrador; setB: (b: Borrador) => void; irARegistro: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [limpiar, setLimpiar] = useState<string | null>(null);
  const r = useMemo(() => calcular(b.personas), [b.personas]);
  const nombre = (id: string) => b.personas.find((p) => p.id === id)?.nombre.trim() || 'Sin nombre';
  const enLista = new Set(b.personas.map((p) => p.nombre.trim().toLowerCase()));
  const sugeridos = datos.amigos.filter((a) => !enLista.has(a.toLowerCase()));
  const upd = (id: string, patch: Partial<Persona>) => setB({ ...b, personas: b.personas.map((p) => (p.id === id ? { ...p, ...patch } : p)) });
  const editando = !!b.id && datos.juntadas.some((j) => j.id === b.id);

  function guardarJuntada() {
    setError(null);
    const personas = b.personas.filter((p) => p.nombre.trim() || p.puso > 0);
    if (personas.some((p) => !p.nombre.trim())) return setError('Falta el nombre de alguien que puso plata.');
    if (personas.length < 2) return setError('Cargá al menos dos personas.');
    if (r.total <= 0) return setError('Nadie puso plata todavía.');
    if (!personas.some((p) => p.participa)) return setError('Marcá quiénes entran en la división.');
    const j: Juntada = {
      id: b.id ?? crypto.randomUUID(), fecha: b.fecha || fechaLocal(), titulo: b.titulo.trim(),
      personas: personas.map((p) => ({ ...p, nombre: p.nombre.trim() })), saldada: datos.juntadas.find((x) => x.id === b.id)?.saldada ?? false,
      creada: datos.juntadas.find((x) => x.id === b.id)?.creada ?? new Date().toISOString()
    };
    const juntadas = [j, ...datos.juntadas.filter((x) => x.id !== j.id)].sort((a, c) => c.fecha.localeCompare(a.fecha));
    const amigos = sumarAmigos(datos.amigos, j.personas.map((p) => p.nombre));
    setDatos({ ...datos, juntadas, amigos });
    setB(borradorVacio(amigos));
    toast(editando ? 'Juntada actualizada' : '¡Juntada guardada en el registro!');
    irARegistro();
  }

  return (
    <div className="stack-lg">
      <div>
        <h1>{editando ? 'Editar juntada' : '¿Quién puso cuánto?'}</h1>
        <p className="muted">Cargá lo que gastó cada uno y la app dice quién le paga a quién.</p>
      </div>

      <div className="grid-2">
        <label className="field"><span className="label">¿Qué hicieron?</span>
          <input className="input" value={b.titulo} placeholder="Asado" maxLength={80} onChange={(e) => setB({ ...b, titulo: e.target.value })} /></label>
        <label className="field"><span className="label">Fecha</span>
          <input className="input" type="date" value={b.fecha} max={fechaLocal()} onChange={(e) => setB({ ...b, fecha: e.target.value })} /></label>
      </div>

      <section className="stack">
        <div className="section-title"><h2>Personas ({b.personas.length})</h2></div>
        {b.personas.map((p, i) => (
          <div key={p.id} className={`card tight stack ${p.participa ? '' : ''}`} style={{ gap: 8, opacity: p.participa ? 1 : 0.75 }}>
            <div className="row">
              <input className="input grow" value={p.nombre} placeholder={`Nombre ${i + 1}`} maxLength={40} aria-label={`Nombre de la persona ${i + 1}`}
                list="amigos" onChange={(e) => upd(p.id, { nombre: e.target.value })} />
              <button className="icon-btn" aria-label={`Quitar a ${p.nombre || `persona ${i + 1}`}`} onClick={() => setB({ ...b, personas: b.personas.filter((x) => x.id !== p.id) })}><X /></button>
            </div>
            <div className="row">
              <div className="grow"><MoneyInput cents={p.puso} onChange={(c) => upd(p.id, { puso: c })} ariaLabel={`Cuánto puso ${p.nombre || `la persona ${i + 1}`}`} /></div>
              <button className={`chip ${p.participa ? 'on' : ''}`} style={{ minHeight: 48, borderRadius: 13 }} aria-pressed={p.participa}
                onClick={() => upd(p.id, { participa: !p.participa })}>
                {p.participa ? <><Check /> Entra</> : 'No entra'}
              </button>
            </div>
            {r.total > 0 && p.nombre.trim() && (
              <div className="xsmall faint">
                {!p.participa ? 'No entra en la división' : <>Le toca {pesos(r.parte[p.id])} · </>}
                {r.saldo[p.id] > 0 && <span className="pos">le deben {pesos(r.saldo[p.id])}</span>}
                {r.saldo[p.id] < 0 && <span className="neg">debe {pesos(-r.saldo[p.id])}</span>}
                {r.saldo[p.id] === 0 && p.participa && <span>está justo</span>}
              </div>
            )}
          </div>
        ))}
        <datalist id="amigos">{datos.amigos.map((a) => <option key={a} value={a} />)}</datalist>
        {sugeridos.length > 0 && (
          <div className="chips" aria-label="Amigos frecuentes">
            {sugeridos.map((a) => (
              <button key={a} className="chip" onClick={() => setB({ ...b, personas: [...b.personas, nuevaPersona(a)] })}><Plus /> {a}</button>
            ))}
            {sugeridos.length > 1 && <button className="chip on" onClick={() => setB({ ...b, personas: [...b.personas, ...sugeridos.map((a) => nuevaPersona(a))] })}><UserPlus /> Todos</button>}
          </div>
        )}
        <button className="btn" onClick={() => setB({ ...b, personas: [...b.personas, nuevaPersona()] })}><UserPlus /> Agregar persona</button>
        <p className="hint">Marcá “No entra” si alguien compró pero no participa (por ejemplo, no vino): recupera lo que puso y no paga parte.</p>
      </section>

      <Resultado r={r} nombre={nombre} titulo={b.titulo} fecha={b.fecha} personas={b.personas} />

      {error && <p className="error-text" role="alert">{error}</p>}
      <div className="grid-2">
        <button className="btn" onClick={() => setLimpiar(editando ? '¿Descartar los cambios?' : '¿Empezar de cero?')}><RotateCcw /> {editando ? 'Descartar' : 'Limpiar'}</button>
        <button className="btn btn-primary" onClick={guardarJuntada}><Save /> {editando ? 'Guardar cambios' : 'Guardar'}</button>
      </div>
      <Confirm text={limpiar} label="Sí" onClose={() => setLimpiar(null)} onYes={() => setB(borradorVacio(datos.amigos))} />
    </div>
  );
}

function textoCuentas(r: ReturnType<typeof calcular>, nombre: (id: string) => string, titulo: string, fecha: string, personas: Persona[]) {
  const pusieron = personas.filter((p) => p.puso > 0).map((p) => `${nombre(p.id)} ${pesos(p.puso)}`).join(', ');
  const exacto = Object.values(r.parte).filter((x) => x > 0).every((x) => x === r.porCabeza);
  return [
    `🔥 ${titulo.trim() || 'Juntada'} · ${fechaLarga(fecha)}`,
    `Total: ${pesos(r.total)} · ${r.participantes} personas · ${exacto ? '' : '≈'}${pesos(r.porCabeza)} c/u`,
    `Pusieron: ${pusieron}`,
    r.transferencias.length ? 'Cuentas:' : '¡Todos a mano! 🎉',
    ...r.transferencias.map((t) => `• ${nombre(t.from)} le pasa ${pesos(t.amountCents)} a ${nombre(t.to)}`)
  ].join('\n');
}

function Resultado({ r, nombre, titulo, fecha, personas }: { r: ReturnType<typeof calcular>; nombre: (id: string) => string; titulo: string; fecha: string; personas: Persona[] }) {
  if (r.total <= 0) {
    return <div className="card center muted small">Cuando cargues lo que puso cada uno, acá aparece cómo quedan las cuentas.</div>;
  }
  const exacto = Object.values(r.parte).filter((x) => x > 0).every((x) => x === r.porCabeza);
  return (
    <section className="card hero stack" aria-label="Resultado">
      <div className="kpi-hero">
        <div>
          <div className="small muted bold">Total gastado</div>
          <div className="amount-xl">{pesos(r.total)}</div>
          <div className="muted small">{r.participantes ? `${exacto ? '' : '≈ '}${pesos(r.porCabeza)} cada uno · ${r.participantes} personas` : 'Nadie entra en la división'}</div>
        </div>
      </div>
      <div className="stack" style={{ gap: 8, position: 'relative', zIndex: 1 }}>
        {r.transferencias.length === 0 ? (
          <p className="bold">¡Están todos a mano! 🎉</p>
        ) : r.transferencias.map((t) => (
          <div key={t.from + t.to} className="row-between" style={{ background: 'rgba(0,0,0,.18)', borderRadius: 12, padding: '10px 12px' }}>
            <span className="row" style={{ gap: 6, minWidth: 0 }}><b className="ellipsis">{nombre(t.from)}</b><ArrowRight size={16} /><b className="ellipsis">{nombre(t.to)}</b></span>
            <b className="num">{pesos(t.amountCents)}</b>
          </div>
        ))}
      </div>
      <a className="btn" style={{ position: 'relative', zIndex: 1, background: '#fff7f0', color: '#3a1606', borderColor: 'transparent' }}
        href={whatsapp(textoCuentas(r, nombre, titulo, fecha, personas))} target="_blank" rel="noreferrer"><Share2 /> Mandar cuentas por WhatsApp</a>
    </section>
  );
}

// ---------------------------------------------------------------- registro
function Registro({ datos, setDatos, editar }: { datos: Datos; setDatos: (d: Datos) => void; editar: (j: Juntada) => void }) {
  const [abierta, setAbierta] = useState<string | null>(datos.juntadas[0]?.id ?? null);
  const [borrar, setBorrar] = useState<Juntada | null>(null);
  const dias = diasSinJuntarse(datos.juntadas);
  const total = datos.juntadas.reduce((a, j) => a + calcular(j.personas).total, 0);
  const pendientes = datos.juntadas.filter((j) => !j.saldada && calcular(j.personas).transferencias.length).length;

  if (!datos.juntadas.length) {
    return (
      <div className="empty">
        <div className="empty-art"><History /></div>
        <h3>Todavía no hay juntadas</h3>
        <p>Cuando guardes una cuenta desde “Calcular”, queda acá con la fecha y quién le pagó a quién.</p>
      </div>
    );
  }
  return (
    <div className="stack-lg">
      <h1>Registro</h1>
      <div className="grid-3">
        <div className="stat"><div className="stat-label">Juntadas</div><div className="stat-value">{datos.juntadas.length}</div></div>
        <div className="stat"><div className="stat-label">Última</div><div className="stat-value">{dias === 0 ? 'Hoy' : `${dias} d`}</div></div>
        <div className="stat"><div className="stat-label">Sin saldar</div><div className="stat-value">{pendientes}</div></div>
      </div>
      <p className="faint small center">Total gastado en todas: {pesos(total)}</p>
      <div className="stack">
        {datos.juntadas.map((j) => {
          const r = calcular(j.personas);
          const nombre = (id: string) => j.personas.find((p) => p.id === id)?.nombre ?? '';
          const open = abierta === j.id;
          const set = (patch: Partial<Juntada>) => setDatos({ ...datos, juntadas: datos.juntadas.map((x) => (x.id === j.id ? { ...x, ...patch } : x)) });
          return (
            <div key={j.id} className="card stack" style={{ gap: 10 }}>
              <button className="row-between" style={{ background: 'none', border: 'none', padding: 0, textAlign: 'left', cursor: 'pointer', width: '100%' }}
                aria-expanded={open} onClick={() => setAbierta(open ? null : j.id)}>
                <div style={{ minWidth: 0 }}>
                  <h3 className="ellipsis">{j.titulo || 'Juntada'}</h3>
                  <div className="faint small">{fechaLarga(j.fecha)} · {j.personas.length} personas · {pesos(r.total)}</div>
                </div>
                <span className="row" style={{ gap: 6 }}>
                  {r.transferencias.length > 0 && <span className={`badge ${j.saldada ? 'b-settled' : 'b-pending'}`}>{j.saldada ? 'Saldada' : 'Pendiente'}</span>}
                  <ChevronDown size={18} style={{ transform: open ? 'rotate(180deg)' : undefined, transition: 'transform .2s' }} />
                </span>
              </button>
              {open && (
                <>
                  <div className="list" style={{ borderTop: '1px solid var(--border)' }}>
                    {j.personas.map((p) => (
                      <div key={p.id} className="row-between small" style={{ padding: '7px 0', borderBottom: '1px solid var(--border)' }}>
                        <span>{p.nombre}{!p.participa && <span className="faint"> (no entra)</span>}</span>
                        <span className="num">puso {pesos(p.puso)} · <span className={r.saldo[p.id] > 0 ? 'pos' : r.saldo[p.id] < 0 ? 'neg' : 'faint'}>{r.saldo[p.id] > 0 ? '+' : ''}{pesos(r.saldo[p.id])}</span></span>
                      </div>
                    ))}
                  </div>
                  {r.transferencias.length > 0 ? (
                    <div className="stack" style={{ gap: 6 }}>
                      {r.transferencias.map((t) => (
                        <div key={t.from + t.to} className="row-between small"><span><b>{nombre(t.from)}</b> → <b>{nombre(t.to)}</b></span><b className="num">{pesos(t.amountCents)}</b></div>
                      ))}
                    </div>
                  ) : <p className="small pos">Todos a mano.</p>}
                  <div className="row wrap" style={{ gap: 8 }}>
                    {r.transferencias.length > 0 && (
                      <button className={`btn btn-sm ${j.saldada ? '' : 'btn-success'}`} onClick={() => { set({ saldada: !j.saldada }); toast(j.saldada ? 'Marcada como pendiente' : '¡Cuentas saldadas!'); }}>
                        <Check /> {j.saldada ? 'Desmarcar saldada' : 'Ya pagaron todos'}
                      </button>
                    )}
                    <a className="btn btn-sm btn-wa" href={whatsapp(textoCuentas(r, nombre, j.titulo, j.fecha, j.personas))} target="_blank" rel="noreferrer"><Share2 /> Compartir</a>
                    <button className="btn btn-sm" onClick={() => editar(j)}><Pencil /> Editar</button>
                    <button className="btn btn-sm btn-ghost" style={{ color: 'var(--red)' }} onClick={() => setBorrar(j)}><Trash2 /> Borrar</button>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
      <Confirm text={borrar ? `¿Borrar “${borrar.titulo || 'Juntada'}” del ${fechaLarga(borrar.fecha)}?` : null} label="Borrar"
        onClose={() => setBorrar(null)} onYes={() => { setDatos({ ...datos, juntadas: datos.juntadas.filter((x) => x.id !== borrar!.id) }); toast('Juntada borrada'); }} />
    </div>
  );
}

// ---------------------------------------------------------------- ajustes
function Ajustes({ datos, setDatos }: { datos: Datos; setDatos: (d: Datos) => void }) {
  const [tema, setTema] = useState<ThemePref>(getThemePref());
  const [otro, setOtro] = useState(String(datos.avisoDias));
  const [borrarTodo, setBorrarTodo] = useState<string | null>(null);
  const presets = [7, 15, 30, 45, 60];

  function exportar() {
    const blob = new Blob([JSON.stringify(datos, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `la-juntada-${fechaLocal()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }
  async function importar(f: File | undefined) {
    if (!f) return;
    try {
      const d = validar(JSON.parse(await f.text()));
      setDatos(d);
      toast(`Respaldo cargado: ${d.juntadas.length} juntadas`);
    } catch {
      alert('Ese archivo no es un respaldo válido de La Juntada.');
    }
  }

  return (
    <div className="stack-lg">
      <h1>Ajustes</h1>
      <section className="card stack">
        <h3><BellRing size={18} style={{ verticalAlign: -3 }} /> Avisarme si no nos juntamos en…</h3>
        <div className="segmented" role="radiogroup" aria-label="Días para el aviso">
          {presets.map((d) => (
            <button key={d} role="radio" aria-checked={datos.avisoDias === d} className={datos.avisoDias === d ? 'on' : ''}
              onClick={() => { setDatos({ ...datos, avisoDias: d }); setOtro(String(d)); }}>{d} días</button>
          ))}
        </div>
        <div className="row">
          <span className="small grow">Otro número de días</span>
          <input className="input input-sm num" style={{ width: 90 }} inputMode="numeric" value={otro} aria-label="Días personalizados"
            onChange={(e) => {
              const v = e.target.value.replace(/\D/g, '').slice(0, 3);
              setOtro(v);
              const n = Number(v);
              if (n >= 1 && n <= 365) setDatos({ ...datos, avisoDias: n });
            }} />
        </div>
        <p className="hint">El aviso aparece al abrir la app cuando pasan {datos.avisoDias} días desde la última juntada del registro.</p>
      </section>

      <section className="card stack">
        <h3>Amigos frecuentes</h3>
        {datos.amigos.length === 0 ? <p className="small muted">Se guardan solos cuando registrás una juntada.</p> : (
          <div className="chips">
            {datos.amigos.map((a) => (
              <span key={a} className="chip">{a}
                <button aria-label={`Quitar a ${a}`} style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: 0, display: 'flex' }}
                  onClick={() => setDatos({ ...datos, amigos: datos.amigos.filter((x) => x !== a) })}><X size={15} /></button>
              </span>
            ))}
          </div>
        )}
      </section>

      <section className="card stack">
        <h3>Apariencia</h3>
        <div className="segmented" role="radiogroup" aria-label="Tema">
          {(['system', 'dark', 'light'] as ThemePref[]).map((t) => (
            <button key={t} role="radio" aria-checked={tema === t} className={tema === t ? 'on' : ''} onClick={() => { setTema(t); setThemePref(t); }}>
              {t === 'system' ? 'Automático' : t === 'dark' ? 'Oscuro' : 'Claro'}
            </button>
          ))}
        </div>
      </section>

      <section className="card stack">
        <h3>Tus datos</h3>
        <p className="small muted">Todo queda guardado en este celular, sin cuentas ni servidores. Bajate un respaldo de vez en cuando o para pasarlo a otro teléfono.</p>
        <div className="grid-2">
          <button className="btn" onClick={exportar}><Download /> Bajar respaldo</button>
          <label className="btn" style={{ cursor: 'pointer' }}><Upload /> Cargar respaldo<input type="file" accept="application/json,.json" hidden onChange={(e) => importar(e.target.files?.[0])} /></label>
        </div>
        <button className="btn btn-ghost" style={{ color: 'var(--red)' }} onClick={() => setBorrarTodo('¿Borrar todas las juntadas y amigos?')}><Trash2 /> Borrar todo</button>
      </section>

      <section className="card stack">
        <h3>Instalarla en el celular</h3>
        <p className="small muted"><b>Android:</b> en Chrome, menú ⋮ → “Instalar app” o “Agregar a pantalla principal”.</p>
        <p className="small muted"><b>iPhone:</b> en Safari, botón Compartir → “Agregar a inicio”.</p>
        <p className="small muted">Una vez instalada funciona sin internet.</p>
      </section>
      <Confirm text={borrarTodo} label="Borrar todo" onClose={() => setBorrarTodo(null)} onYes={() => { setDatos({ ...datos, juntadas: [], amigos: [] }); toast('Datos borrados'); }} />
    </div>
  );
}
