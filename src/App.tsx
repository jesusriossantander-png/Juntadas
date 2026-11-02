import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight, Bell, BellRing, Calculator, Check, Copy, Crown, LogOut, Users, ChevronDown, Download, History, Pencil, Plus, Save, Settings, Share2, Trash2, Upload, UserPlus, X, RotateCcw
} from 'lucide-react';
import {
  alcoholDe, calcular, cargar, pct, tomaAlcohol, diasSinJuntarse, fechaLocal, guardar, sumarAmigos, tocaJuntarse, validar, type Datos, type Juntada, type Persona
} from './lib/juntada';
import { getThemePref, setThemePref, type ThemePref } from './lib/theme';
import {
  activarAvisos, avisarCambio, codigoDelLink, codigoDeTexto, codigoGuardado, crearGrupo, desactivarAvisos, escucharGrupo, estadoAvisos,
  guardarCodigo, linkAdmin, linkInvitacion, misGrupos, olvidarGrupo, reclamarAdmin, recordarGrupo, sincronizar, traerGrupo,
  type EstadoAvisos, type MiGrupo
} from './lib/nube';
import { Confirm, Logo, MoneyInput, Sheet, Toasts, fechaLarga, pesos, toast, whatsapp } from './ui';

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
  useEffect(() => { try { localStorage.setItem(BORRADOR_KEY, JSON.stringify(borrador)); } catch { /* nada */ } }, [borrador]);

  // ---- grupos compartidos
  const [codigo, setCodigo] = useState<string | null>(() => codigoGuardado());
  const [grupos, setGrupos] = useState<MiGrupo[]>(() => misGrupos());
  const [nombreGrupo, setNombreGrupo] = useState<string>('');
  const [esAdmin, setEsAdmin] = useState(false);
  const [tieneAdmin, setTieneAdmin] = useState(true);
  const [cargando, setCargando] = useState(false);
  const [selector, setSelector] = useState(false);
  const datosRef = useRef(datos);
  datosRef.current = datos;
  const codigoRef = useRef(codigo);
  codigoRef.current = codigo;
  const cacheKey = (c: string) => `la-juntada:cache:${c}`;

  const recargar = useCallback(async (c: string, avisarError = false) => {
    try {
      const d = await traerGrupo(c);
      if (codigoRef.current !== c) return; // se cambió de grupo mientras cargaba
      const { nombreGrupo: nombre, esAdmin: admin, tieneAdmin: conAdmin, ...resto } = d;
      setNombreGrupo(nombre);
      setEsAdmin(admin);
      setTieneAdmin(conAdmin);
      setDatosState(resto);
      setGrupos(recordarGrupo({ codigo: c, nombre }));
      try { localStorage.setItem(cacheKey(c), JSON.stringify({ ...resto, nombreGrupo: nombre, esAdmin: admin, tieneAdmin: conAdmin })); } catch { /* nada */ }
    } catch (e) {
      if (avisarError) toast(`⚠️ ${(e as Error).message}`);
    } finally {
      setCargando(false);
    }
  }, []);

  /** Pasa a un grupo (o a "solo este celular" con null). */
  const abrirGrupo = useCallback((c: string | null, avisar = true) => {
    guardarCodigo(c);
    setCodigo(c);
    codigoRef.current = c;
    setEsAdmin(false);
    if (!c) { setNombreGrupo(''); setDatosState(cargar()); return Promise.resolve(); }
    try {
      const cache = JSON.parse(localStorage.getItem(cacheKey(c)) || 'null');
      if (cache) { setNombreGrupo(cache.nombreGrupo ?? ''); setEsAdmin(!!cache.esAdmin); setTieneAdmin(cache.tieneAdmin !== false); setDatosState(validar(cache)); }
      else { setNombreGrupo(misGrupos().find((g) => g.codigo === c)?.nombre ?? ''); setDatosState({ version: 1, juntadas: [], amigos: [], avisoDias: 30 }); }
    } catch { /* nada */ }
    setCargando(true);
    return recargar(c, avisar);
  }, [recargar]);

  // Al abrir: link de invitación (?g=...&a=...) o el último grupo usado.
  useEffect(() => {
    const delLink = codigoDelLink();
    if (delLink) {
      setGrupos(recordarGrupo({ codigo: delLink.codigo, nombre: '', admin: delLink.admin }));
      abrirGrupo(delLink.codigo).then(() => toast(delLink.admin ? '¡Listo! En este celular sos el administrador' : '¡Te sumaste al grupo!'));
    } else if (codigoGuardado()) abrirGrupo(codigoGuardado(), true);
  }, [abrirGrupo]);

  // Cambios de los demás en vivo + al volver a la app.
  useEffect(() => {
    if (!codigo) return;
    const off = escucharGrupo(codigo, () => recargar(codigo));
    const alVolver = () => document.visibilityState === 'visible' && recargar(codigo);
    document.addEventListener('visibilitychange', alVolver);
    const t = setInterval(() => document.visibilityState === 'visible' && recargar(codigo), 60_000);
    return () => { off(); document.removeEventListener('visibilitychange', alVolver); clearInterval(t); };
  }, [codigo, recargar]);

  const setDatos = (d: Datos) => {
    const antes = datosRef.current;
    setDatosState(d);
    if (!codigo) { guardar(d); return; }
    sincronizar(codigo, antes, d)
      .then(() => { avisarCambio(); recargar(codigo); })
      .catch((e) => { toast(`⚠️ No se guardó en el grupo: ${(e as Error).message}`); recargar(codigo); });
  };

  const crearNuevoGrupo = async (nombre: string) => {
    const g = await crearGrupo(nombre);
    // Si estabas usando la app sin grupo, lo que tenías se sube al grupo nuevo.
    if (!codigo) await sincronizar(g.codigo, { version: 1, juntadas: [], amigos: [], avisoDias: 30 }, datosRef.current).catch(() => undefined);
    setGrupos(recordarGrupo(g));
    await abrirGrupo(g.codigo, true);
  };
  const unirseConTexto = async (texto: string) => {
    const g = codigoDeTexto(texto);
    if (!g) throw new Error('No reconozco ese link o código. Copiá el link completo que te mandaron.');
    setGrupos(recordarGrupo({ codigo: g.codigo, nombre: '', admin: g.admin }));
    await abrirGrupo(g.codigo, true);
  };
  const salirDelGrupo = () => {
    if (!codigo) return;
    desactivarAvisos(codigo).catch(() => undefined);
    const resto = olvidarGrupo(codigo);
    setGrupos(resto);
    abrirGrupo(resto[0]?.codigo ?? null);
  };
  const hacermeAdmin = async () => {
    if (!codigo) return;
    await reclamarAdmin(codigo);
    setGrupos(misGrupos());
    await recargar(codigo, true);
    toast('¡Ahora sos el administrador del grupo!');
  };
  const adminToken = grupos.find((g) => g.codigo === codigo)?.admin;

  const aviso = tocaJuntarse(datos);

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-inner">
          <span className="brand"><span className="brand-mark"><Logo size={18} /></span> La Juntada</span>
          <button className="btn btn-sm btn-ghost grupo-btn" onClick={() => setSelector(true)} aria-label="Cambiar de grupo">
            <Users size={15} /> <span className="ellipsis">{codigo ? (nombreGrupo || 'Grupo') + (cargando ? ' · …' : '') : 'Sin grupo'}</span> <ChevronDown size={15} />
          </button>
        </div>
      </header>
      <main className="main fade-in" key={tab}>
        {aviso != null && tab !== 'ajustes' && <Aviso dias={aviso} />}
        {codigo && tab === 'calcular' && <InvitarAvisos codigo={codigo} irAjustes={() => setTab('ajustes')} />}
        {tab === 'calcular' && <Calculadora datos={datos} setDatos={setDatos} b={borrador} setB={setBorrador} irARegistro={() => setTab('registro')} />}
        {tab === 'registro' && <Registro datos={datos} editar={(j) => { setBorrador({ id: j.id, fecha: j.fecha, titulo: j.titulo, personas: j.personas, separarAlcohol: j.separarAlcohol }); setTab('calcular'); }} />}
        {tab === 'ajustes' && <Ajustes datos={datos} setDatos={setDatos} codigo={codigo} nombreGrupo={nombreGrupo} esAdmin={esAdmin} tieneAdmin={tieneAdmin}
          adminToken={adminToken} crear={crearNuevoGrupo} salir={salirDelGrupo} hacermeAdmin={hacermeAdmin} />}
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
      <SelectorGrupos abierto={selector} cerrar={() => setSelector(false)} grupos={grupos} activo={codigo}
        elegir={(c) => { setSelector(false); abrirGrupo(c); }} crear={crearNuevoGrupo} unirse={unirseConTexto} />
      <Toasts />
    </div>
  );
}

function SelectorGrupos({ abierto, cerrar, grupos, activo, elegir, crear, unirse }: {
  abierto: boolean; cerrar: () => void; grupos: MiGrupo[]; activo: string | null; elegir: (c: string | null) => void;
  crear: (nombre: string) => Promise<void>; unirse: (texto: string) => Promise<void>;
}) {
  const [nombre, setNombre] = useState('');
  const [link, setLink] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const hacer = async (fn: () => Promise<void>, ok: string) => {
    setOcupado(true);
    try { await fn(); toast(ok); setNombre(''); setLink(''); cerrar(); }
    catch (e) { toast(`⚠️ ${(e as Error).message}`); }
    finally { setOcupado(false); }
  };
  return (
    <Sheet open={abierto} onClose={cerrar} title="Tus grupos">
      <div className="stack">
        <div className="card flush list">
          {grupos.map((g) => (
            <button key={g.codigo} className="list-item" onClick={() => elegir(g.codigo)} aria-current={g.codigo === activo}>
              <Users size={18} color="var(--ember)" />
              <span className="grow bold ellipsis">{g.nombre || 'Grupo'}</span>
              {g.admin && <span className="badge b-admin">Admin</span>}
              {g.codigo === activo && <Check size={18} color="var(--ember)" />}
            </button>
          ))}
          <button className="list-item" onClick={() => elegir(null)} aria-current={!activo}>
            <span aria-hidden>📱</span>
            <span className="grow">Solo en este celular <span className="faint xsmall">(sin grupo)</span></span>
            {!activo && <Check size={18} color="var(--ember)" />}
          </button>
        </div>
        <div className="stack" style={{ gap: 6 }}>
          <span className="label">Unirme a otro grupo</span>
          <div className="row">
            <input className="input" value={link} onChange={(e) => setLink(e.target.value)} placeholder="Pegá el link que te mandaron" />
            <button className="btn" disabled={ocupado || !link.trim()} onClick={() => hacer(() => unirse(link), '¡Te sumaste al grupo!')}>Unirme</button>
          </div>
        </div>
        <div className="stack" style={{ gap: 6 }}>
          <span className="label">Crear otro grupo (vas a ser el administrador)</span>
          <div className="row">
            <input className="input" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej: Los del fútbol" maxLength={60} />
            <button className="btn btn-primary" disabled={ocupado} onClick={() => hacer(() => crear(nombre.trim() || 'La Juntada'), '¡Grupo creado! Mandá el link desde Ajustes')}>Crear</button>
          </div>
        </div>
      </div>
    </Sheet>
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

/** Si el celular todavía no recibe avisos del grupo, lo ofrece (se puede descartar). */
function InvitarAvisos({ codigo, irAjustes }: { codigo: string; irAjustes: () => void }) {
  const [estado, setEstado] = useState<EstadoAvisos | null>(null);
  const [oculto, setOculto] = useState(() => { try { return localStorage.getItem('la-juntada:avisos-oculto') === '1'; } catch { return false; } });
  useEffect(() => { estadoAvisos(codigo).then(setEstado).catch(() => setEstado('no-disponible')); }, [codigo]);
  if (oculto || !estado || estado === 'activos' || estado === 'no-disponible' || estado === 'bloqueados') return null;
  return (
    <div className="card tight row" style={{ marginBottom: 12, gap: 8 }}>
      <Bell color="var(--ember)" size={20} style={{ flexShrink: 0 }} />
      <span className="small grow">{estado === 'iphone-instalar'
        ? 'Para recibir los avisos en iPhone, agregá la app a la pantalla de inicio (Compartir → Agregar a inicio).'
        : 'Activá los avisos para enterarte cuando hace mucho que no se juntan.'}</span>
      {estado === 'apagados'
        ? <button className="btn btn-sm btn-primary" onClick={() => activarAvisos(codigo).then(() => { setEstado('activos'); toast('¡Avisos activados!'); }).catch((e) => toast(`⚠️ ${(e as Error).message}`))}>Activar</button>
        : <button className="btn btn-sm" onClick={irAjustes}>Ver</button>}
      <button className="tag-x" aria-label="Ocultar" onClick={() => { setOculto(true); try { localStorage.setItem('la-juntada:avisos-oculto', '1'); } catch { /* nada */ } }}><X size={15} /></button>
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
      : `Total: ${pesos(r.total)}${r.alcohol ? ` (bebida ${pesos(r.alcohol)})` : ''} · ${r.participantes} personas`,
    `Pusieron: ${pusieron}`,
    ...(noToman.length ? [`No toman (no pagan bebida): ${noToman.join(', ')}`] : []),
    ...(parciales.length ? [`Estuvieron un rato: ${parciales.join(', ')}`] : []),
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
function Registro({ datos, editar }: { datos: Datos; editar: (j: Juntada) => void }) {
  const [abierta, setAbierta] = useState<string | null>(datos.juntadas[0]?.id ?? null);
  const dias = diasSinJuntarse(datos.juntadas);
  const total = datos.juntadas.reduce((a, j) => a + calcular(j.personas, j.separarAlcohol).total, 0);

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
        <div className="stat"><div className="stat-label">Gastado</div><div className="stat-value" style={{ fontSize: '.95rem' }}>{pesos(total)}</div></div>
      </div>
      <div className="stack">
        {datos.juntadas.map((j) => {
          const r = calcular(j.personas, j.separarAlcohol);
          const nombre = (id: string) => j.personas.find((p) => p.id === id)?.nombre ?? '';
          const open = abierta === j.id;
          return (
            <div key={j.id} className="card stack" style={{ gap: 10 }}>
              <button className="row-between" style={{ background: 'none', border: 'none', padding: 0, textAlign: 'left', cursor: 'pointer', width: '100%' }}
                aria-expanded={open} onClick={() => setAbierta(open ? null : j.id)}>
                <div style={{ minWidth: 0 }}>
                  <h3 className="ellipsis">{j.titulo || 'Juntada'}</h3>
                  <div className="faint small">{fechaLarga(j.fecha)} · {j.personas.length} personas · {pesos(r.total)}</div>
                </div>
                <span className="row" style={{ gap: 6 }}>
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
                    {j.editable === false
                      ? <span className="xsmall faint">🔒 La cargó otro celular: solo el administrador puede editarla.</span>
                      : <button className="btn btn-sm" onClick={() => editar(j)}><Pencil /> Editar</button>}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- ajustes
function Ajustes({ datos, setDatos, codigo, nombreGrupo, esAdmin, tieneAdmin, adminToken, crear, salir, hacermeAdmin }: {
  datos: Datos; setDatos: (d: Datos) => void; codigo: string | null; nombreGrupo: string; esAdmin: boolean; tieneAdmin: boolean;
  adminToken?: string; crear: (nombre: string) => Promise<void>; salir: () => void; hacermeAdmin: () => Promise<void>;
}) {
  const [tema, setTema] = useState<ThemePref>(getThemePref());
  const [otro, setOtro] = useState(String(datos.avisoDias));
  useEffect(() => { setOtro(String(datos.avisoDias)); }, [datos.avisoDias, codigo]);
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
      <Grupo codigo={codigo} nombreGrupo={nombreGrupo} esAdmin={esAdmin} tieneAdmin={tieneAdmin} adminToken={adminToken} crear={crear} salir={salir} hacermeAdmin={hacermeAdmin} />
      <section className="card stack">
        <h3><BellRing size={18} style={{ verticalAlign: -3 }} /> {codigo ? 'Avisar al grupo si no nos juntamos en…' : 'Avisarme si no nos juntamos en…'}</h3>
        {codigo && !esAdmin && <p className="hint">🔒 Solo el administrador del grupo puede cambiarlo.</p>}
        <div className="segmented" role="radiogroup" aria-label="Días para el aviso" style={codigo && !esAdmin ? { pointerEvents: 'none', opacity: 0.6 } : undefined}>
          {presets.map((d) => (
            <button key={d} role="radio" aria-checked={datos.avisoDias === d} className={datos.avisoDias === d ? 'on' : ''}
              onClick={() => { setDatos({ ...datos, avisoDias: d }); setOtro(String(d)); }}>{d} días</button>
          ))}
        </div>
        <div className="row">
          <span className="small grow">Otro número de días</span>
          <input className="input input-sm num" style={{ width: 90 }} inputMode="numeric" value={otro} aria-label="Días personalizados" disabled={!!codigo && !esAdmin}
            onChange={(e) => {
              const v = e.target.value.replace(/\D/g, '').slice(0, 3);
              setOtro(v);
              const n = Number(v);
              if (n >= 1 && n <= 365) setDatos({ ...datos, avisoDias: n });
            }} />
        </div>
        <p className="hint">{codigo ? `Es igual para todo el grupo. Cuando pasan ${datos.avisoDias} días desde la última juntada, a cada celular con los avisos activados le llega una notificación.`
          : `El aviso aparece al abrir la app cuando pasan ${datos.avisoDias} días desde la última juntada del registro.`}</p>
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
        <p className="small muted">{codigo ? 'Las juntadas están guardadas en el grupo. Igual podés bajarte una copia.' : 'Todo queda guardado en este celular. Bajate un respaldo de vez en cuando o para pasarlo a otro teléfono.'}</p>
        <div className="grid-2">
          <button className="btn" onClick={exportar}><Download /> Bajar respaldo</button>
          {!codigo && <label className="btn" style={{ cursor: 'pointer' }}><Upload /> Cargar respaldo<input type="file" accept="application/json,.json" hidden onChange={(e) => importar(e.target.files?.[0])} /></label>}
        </div>
        {!codigo && <button className="btn btn-ghost" style={{ color: 'var(--red)' }} onClick={() => setBorrarTodo('¿Borrar todas las juntadas y amigos?')}><Trash2 /> Borrar todo</button>}
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

// ---------------------------------------------------------------- grupo compartido
function Grupo({ codigo, nombreGrupo, esAdmin, tieneAdmin, adminToken, crear, salir, hacermeAdmin }: {
  codigo: string | null; nombreGrupo: string; esAdmin: boolean; tieneAdmin: boolean; adminToken?: string;
  crear: (nombre: string) => Promise<void>; salir: () => void; hacermeAdmin: () => Promise<void>;
}) {
  const [nombre, setNombre] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [avisos, setAvisos] = useState<EstadoAvisos | null>(null);
  const [confirmarSalir, setConfirmarSalir] = useState<string | null>(null);
  useEffect(() => { if (codigo) estadoAvisos(codigo).then(setAvisos).catch(() => setAvisos('no-disponible')); }, [codigo]);

  if (!codigo) {
    return (
      <section className="card alert stack">
        <h3><Users size={18} style={{ verticalAlign: -3 }} /> Compartir con los amigos</h3>
        <p className="small muted">Creá el grupo y mandales el link: todos ven el mismo registro, cualquiera puede cargar y a cada uno le llega el aviso cuando hace mucho que no se juntan. Lo que ya tenés guardado se sube al grupo.</p>
        <input className="input" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre del grupo (ej: Los del asado)" maxLength={60} />
        <button className="btn btn-primary" disabled={ocupado} onClick={async () => {
          setOcupado(true);
          try { await crear(nombre.trim() || 'La Juntada'); toast('¡Grupo creado! Ahora mandá el link'); }
          catch (e) { toast(`⚠️ ${(e as Error).message}`); }
          finally { setOcupado(false); }
        }}><Users /> {ocupado ? 'Creando…' : 'Crear grupo'}</button>
      </section>
    );
  }
  const link = linkInvitacion(codigo);
  return (
    <section className="card stack">
      <h3><Users size={18} style={{ verticalAlign: -3 }} /> Grupo: {nombreGrupo || '…'}</h3>
      <p className="small muted">Todos los que abran el link ven las mismas juntadas y pueden cargar nuevas. Cualquiera con el link puede entrar: pasalo solo a los del grupo.</p>
      {esAdmin ? (
        <div className="card tight stack" style={{ gap: 6 }}>
          <span className="small bold"><Crown size={15} color="var(--amber)" style={{ verticalAlign: -2 }} /> Sos el administrador</span>
          <span className="xsmall muted">Podés cambiar los días del aviso y editar cualquier juntada. Los demás solo editan las que cargaron desde su celular.</span>
          {adminToken && (
            <button className="btn btn-sm" onClick={() => navigator.clipboard?.writeText(linkAdmin(codigo, adminToken)).then(() => toast('Link de administrador copiado'), () => toast(linkAdmin(codigo, adminToken)))}>
              <Copy /> Copiar link de administrador
            </button>
          )}
          <span className="xsmall faint">Guardalo por si cambiás de celular. No lo mandes al grupo: quien lo abra también es administrador.</span>
        </div>
      ) : tieneAdmin ? (
        <p className="xsmall faint"><Crown size={13} style={{ verticalAlign: -2 }} /> El grupo tiene administrador: solo él cambia los días del aviso y edita juntadas de otros.</p>
      ) : (
        <button className="btn btn-sm" onClick={() => hacermeAdmin().catch((e) => toast(`⚠️ ${(e as Error).message}`))}><Crown /> Hacerme administrador</button>
      )}
      <div className="grid-2">
        <a className="btn btn-wa" href={whatsapp(`🔥 Sumate a "${nombreGrupo || 'La Juntada'}" para dividir los gastos de las juntadas: ${link}\nAbrilo y agregalo a la pantalla de inicio para recibir los avisos.`)} target="_blank" rel="noreferrer"><Share2 /> Invitar</a>
        <button className="btn" onClick={() => navigator.clipboard?.writeText(link).then(() => toast('Link copiado'), () => toast(link))}><Copy /> Copiar link</button>
      </div>
      <div className="row-between">
        <span className="small"><Bell size={15} style={{ verticalAlign: -2 }} /> Avisos en este celular</span>
        {avisos === 'activos' && <button className="btn btn-sm" onClick={() => desactivarAvisos(codigo).then(() => { setAvisos('apagados'); toast('Avisos desactivados'); })}>Desactivar</button>}
        {avisos === 'apagados' && <button className="btn btn-sm btn-primary" onClick={() => activarAvisos(codigo).then(() => { setAvisos('activos'); toast('¡Avisos activados!'); }).catch((e) => toast(`⚠️ ${(e as Error).message}`))}>Activar</button>}
      </div>
      {avisos === 'activos' && <p className="hint pos">✓ Este celular recibe los avisos del grupo.</p>}
      {avisos === 'bloqueados' && <p className="hint">Bloqueaste las notificaciones de esta página: habilitalas desde los ajustes del navegador.</p>}
      {avisos === 'iphone-instalar' && <p className="hint">En iPhone: abrí la app en Safari → Compartir → “Agregar a inicio”, y activá los avisos desde ahí (iOS 16.4 o más nuevo).</p>}
      {avisos === 'no-disponible' && <p className="hint">Este navegador no admite notificaciones. Probá con Chrome.</p>}
      <button className="btn btn-ghost btn-sm" style={{ color: 'var(--red)', alignSelf: 'flex-start' }} onClick={() => setConfirmarSalir('¿Salir del grupo en este celular? Las juntadas quedan guardadas para los demás.')}><LogOut /> Salir del grupo</button>
      <Confirm text={confirmarSalir} label="Salir" onClose={() => setConfirmarSalir(null)} onYes={salir} />
    </section>
  );
}
