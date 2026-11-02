import { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight, BellRing, Calculator, Check, ChevronDown, Download, History, Pencil, Plus, Save, Settings, Share2, Trash2, Upload, UserPlus, X, RotateCcw
} from 'lucide-react';
import {
  alcoholDe, calcular, cargar, pct, tomaAlcohol, diasSinJuntarse, fechaLocal, guardar, sumarAmigos, tocaJuntarse, validar, type Datos, type Juntada, type Persona
} from './lib/juntada';
import { getThemePref, setThemePref, type ThemePref } from './lib/theme';
import { Confirm, Logo, MoneyInput, Toasts, fechaLarga, pesos, toast, whatsapp } from './ui';

type Tab = 'calcular' | 'registro' | 'ajustes';
type Borrador = { id?: string; fecha: string; titulo: string; personas: Persona[]; separarAlcohol?: boolean };

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
        {tab === 'registro' && <Registro datos={datos} setDatos={setDatos} editar={(j) => { setBorrador({ id: j.id, fecha: j.fecha, titulo: j.titulo, personas: j.personas, separarAlcohol: j.separarAlcohol }); setTab('calcular'); }} />}
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
  // La bebida siempre la pagan solo los que toman (si todos toman, da lo mismo).
  const sep = true;
  const r = useMemo(() => calcular(b.personas, sep), [b.personas, sep]);
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
      id: b.id ?? crypto.randomUUID(), fecha: b.fecha || fechaLocal(), titulo: b.titulo.trim(), separarAlcohol: sep,
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

  const visibles = b.personas;
  return (
    <div className="stack-lg">
      <div>
        <h1>{editando ? 'Editar juntada' : '¿Quién puso cuánto?'}</h1>
        <p className="muted small">Completá cada etiqueta: lo que puso en comida y en bebida, si toma y cuánto estuvo.</p>
      </div>

      <div className="grid-2">
        <label className="field"><span className="label">¿Qué hicieron?</span>
          <input className="input" value={b.titulo} placeholder="Asado" maxLength={80} onChange={(e) => setB({ ...b, titulo: e.target.value })} /></label>
        <label className="field"><span className="label">Fecha</span>
          <input className="input" type="date" value={b.fecha} max={fechaLocal()} onChange={(e) => setB({ ...b, fecha: e.target.value })} /></label>
      </div>

      <section className="tags-grid" aria-label="Personas">
        {visibles.map((p, i) => (
          <EtiquetaPersona key={p.id} p={p} i={i} saldo={r.total > 0 ? r.saldo[p.id] : null}
            upd={(patch) => upd(p.id, patch)} quitar={() => setB({ ...b, personas: b.personas.filter((x) => x.id !== p.id) })} />
        ))}
        <button className="tag-nueva" onClick={() => setB({ ...b, personas: [...b.personas, nuevaPersona()] })}>
          <UserPlus /> Agregar
        </button>
      </section>
      <datalist id="amigos">{datos.amigos.map((a) => <option key={a} value={a} />)}</datalist>
      {sugeridos.length > 0 && (
        <div className="chips" aria-label="Amigos frecuentes">
          {sugeridos.map((a) => (
            <button key={a} className="chip" onClick={() => setB({ ...b, personas: [...b.personas, nuevaPersona(a)] })}><Plus /> {a}</button>
          ))}
          {sugeridos.length > 1 && <button className="chip on" onClick={() => setB({ ...b, personas: [...b.personas, ...sugeridos.map((a) => nuevaPersona(a))] })}><UserPlus /> Todos</button>}
        </div>
      )}

      {r.avisos.map((a) => <p key={a} className="small" style={{ color: 'var(--amber)' }}>⚠️ {a}</p>)}
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

/** Etiqueta editable de una persona: nombre, comida, bebida, si toma y cuánto estuvo. */
function EtiquetaPersona({ p, i, saldo, upd, quitar }: { p: Persona; i: number; saldo: number | null; upd: (patch: Partial<Persona>) => void; quitar: () => void }) {
  const quien = p.nombre.trim() || `la persona ${i + 1}`;
  const estuvo = !p.participa ? '0' : [100, 75, 50, 25].includes(pct(p)) ? String(pct(p)) : 'otro';
  return (
    <div className={`tag-persona ${p.participa ? '' : 'fuera'}`}>
      <div className="row" style={{ gap: 2 }}>
        <input className="tag-nombre" value={p.nombre} placeholder={`Nombre ${i + 1}`} maxLength={40} list="amigos"
          aria-label={`Nombre de la persona ${i + 1}`} onChange={(e) => upd({ nombre: e.target.value })} />
        <button className="tag-x" aria-label={`Quitar a ${quien}`} onClick={quitar}><X size={15} /></button>
      </div>
      <label className="tag-campo"><span aria-hidden>🍖</span>
        <MoneyInput small cents={p.puso - alcoholDe(p)} onChange={(c) => upd({ puso: c + alcoholDe(p) })} ariaLabel={`Comida de ${quien}`} />
      </label>
      <label className="tag-campo"><span aria-hidden>🍺</span>
        <MoneyInput small cents={alcoholDe(p)} onChange={(c) => upd({ alcohol: c, puso: p.puso - alcoholDe(p) + c })} ariaLabel={`Bebida de ${quien}`} />
      </label>
      <div className="row" style={{ gap: 4 }}>
        <label className="tag-toma">
          <input type="checkbox" checked={tomaAlcohol(p)} disabled={!p.participa} aria-label={`${quien} toma`} onChange={(e) => upd({ toma: e.target.checked })} />
          Toma
        </label>
        <select className="tag-select" value={estuvo} aria-label={`Cuánto estuvo ${quien}`}
          onChange={(e) => {
            const v = e.target.value;
            if (v === '0') upd({ participa: false });
            else upd({ participa: true, porcentaje: v === 'otro' ? 80 : Number(v) });
          }}>
          <option value="100">100%</option>
          <option value="75">75%</option>
          <option value="50">50%</option>
          <option value="25">25%</option>
          <option value="otro">Otro…</option>
          <option value="0">No entra</option>
        </select>
      </div>
      {estuvo === 'otro' && (
        <div className="input-affix">
          <input className="input input-sm num" inputMode="numeric" value={pct(p)} aria-label={`Porcentaje de ${quien}`}
            onChange={(e) => { const n = Number(e.target.value.replace(/\D/g, '').slice(0, 3)); upd({ porcentaje: Math.min(100, Math.max(1, n || 1)) }); }} />
          <span>%</span>
        </div>
      )}
      {saldo != null && (p.nombre.trim() || p.puso > 0) && (
        <div className={`tag-saldo ${saldo > 0 ? 'pos' : saldo < 0 ? 'neg' : 'faint'}`}>
          {!p.participa && saldo === 0 ? 'No entra' : saldo > 0 ? `Le deben ${pesos(saldo)}` : saldo < 0 ? `Debe ${pesos(-saldo)}` : 'Está justo'}
        </div>
      )}
    </div>
  );
}

function textoCuentas(r: ReturnType<typeof calcular>, nombre: (id: string) => string, titulo: string, fecha: string, personas: Persona[]) {
  const pusieron = personas.filter((p) => p.puso > 0).map((p) => {
    const beb = alcoholDe(p);
    return beb ? `${nombre(p.id)} ${pesos(p.puso - beb)} comida + ${pesos(beb)} bebida` : `${nombre(p.id)} ${pesos(p.puso)}`;
  }).join(', ');
  const part = personas.filter((p) => p.participa);
  const noToman = r.alcohol > 0 ? part.filter((p) => !tomaAlcohol(p)).map((p) => nombre(p.id)) : [];
  const parciales = part.filter((p) => pct(p) < 100).map((p) => `${nombre(p.id)} (${pct(p)}%)`);
  return [
    `🔥 ${titulo.trim() || 'Juntada'} · ${fechaLarga(fecha)}`,
    r.porCabeza != null
      ? `Total: ${pesos(r.total)} · ${r.participantes} personas · ${pesos(r.porCabeza)} c/u`
      : `Total: ${pesos(r.total)}${r.alcohol ? ` (alcohol ${pesos(r.alcohol)})` : ''} · ${r.participantes} personas`,
    `Pusieron: ${pusieron}`,
    ...(noToman.length ? [`No toman (no pagan bebida): ${noToman.join(', ')}`] : []),
    ...(parciales.length ? [`Estuvieron un rato: ${parciales.join(', ')}`] : []),
    ...(r.porCabeza == null ? [`A cada uno le toca: ${part.map((p) => `${nombre(p.id)} ${pesos(r.parte[p.id])}`).join(', ')}`] : []),
    r.transferencias.length ? 'Cuentas:' : '¡Todos a mano! 🎉',
    ...r.transferencias.map((t) => `• ${nombre(t.from)} le pasa ${pesos(t.amountCents)} a ${nombre(t.to)}`)
  ].join('\n');
}

function Resultado({ r, nombre, titulo, fecha, personas }: { r: ReturnType<typeof calcular>; nombre: (id: string) => string; titulo: string; fecha: string; personas: Persona[] }) {
  if (r.total <= 0) return null;
  const bebida = personas.reduce((a, p) => a + alcoholDe(p), 0);
  return (
    <section className="stack" aria-label="Resultado">
      <div className="grid-2" style={{ alignItems: 'stretch' }}>
        <div className="card hero stack" style={{ gap: 6, padding: 11 }}>
          <div style={{ position: 'relative', zIndex: 1 }}>
            <div className="xsmall muted bold">Total gastado</div>
            <div className="amount-total num">{pesos(r.total)}</div>
          </div>
          <div className="stack xsmall" style={{ gap: 2, position: 'relative', zIndex: 1 }}>
            <div className="row-between"><span>🍖 Comida</span><b className="num">{pesos(r.total - bebida)}</b></div>
            <div className="row-between"><span>🍺 Bebida</span><b className="num">{pesos(bebida)}</b></div>
          </div>
          <div className="muted xsmall" style={{ position: 'relative', zIndex: 1 }}>{!r.participantes ? 'Nadie entra'
            : r.porCabeza != null ? `${pesos(r.porCabeza)} c/u · ${r.participantes} personas` : `${r.participantes} personas`}</div>
        </div>
        <div className="card stack" style={{ gap: 6, padding: 11 }} aria-label="Quién le paga a quién">
          <div className="xsmall bold faint">¿Quién le paga a quién?</div>
          {r.transferencias.length === 0 ? <p className="small bold pos">¡Todos a mano! 🎉</p> : r.transferencias.map((t) => (
            <div key={t.from + t.to} className="pago">
              <span className="ellipsis"><b>{nombre(t.from)}</b> <ArrowRight size={12} color="var(--ember)" style={{ verticalAlign: -1 }} /> <b>{nombre(t.to)}</b></span>
              <b className="num">{pesos(t.amountCents)}</b>
            </div>
          ))}
        </div>
      </div>
      <a className="btn btn-wa" href={whatsapp(textoCuentas(r, nombre, titulo, fecha, personas))} target="_blank" rel="noreferrer"><Share2 /> Mandar cuentas por WhatsApp</a>
    </section>
  );
}

// ---------------------------------------------------------------- registro
function Registro({ datos, setDatos, editar }: { datos: Datos; setDatos: (d: Datos) => void; editar: (j: Juntada) => void }) {
  const [abierta, setAbierta] = useState<string | null>(datos.juntadas[0]?.id ?? null);
  const [borrar, setBorrar] = useState<Juntada | null>(null);
  const dias = diasSinJuntarse(datos.juntadas);
  const total = datos.juntadas.reduce((a, j) => a + calcular(j.personas, j.separarAlcohol).total, 0);
  const pendientes = datos.juntadas.filter((j) => !j.saldada && calcular(j.personas, j.separarAlcohol).transferencias.length).length;

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
          const r = calcular(j.personas, j.separarAlcohol);
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
                        <span>{p.nombre}{!p.participa && <span className="faint"> (no entra)</span>}{p.participa && pct(p) < 100 && <span className="faint"> ({pct(p)}%)</span>}{p.participa && j.separarAlcohol && !tomaAlcohol(p) && <span className="faint"> · no toma</span>}</span>
                        <span className="num">🍖 {pesos(p.puso - alcoholDe(p))} · 🍺 {pesos(alcoholDe(p))} · <span className={r.saldo[p.id] > 0 ? 'pos' : r.saldo[p.id] < 0 ? 'neg' : 'faint'}>{r.saldo[p.id] > 0 ? '+' : ''}{pesos(r.saldo[p.id])}</span></span>
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
