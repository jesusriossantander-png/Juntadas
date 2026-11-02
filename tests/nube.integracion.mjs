// Prueba del grupo compartido contra un Supabase (local o de prueba).
// Uso: SB_URL=http://127.0.0.1:54321 SB_ANON=... SB_SERVICE=... node tests/nube.integracion.mjs
import { createClient } from '@supabase/supabase-js';
const { SB_URL, SB_ANON, SB_SERVICE } = process.env;
const anon = () => createClient(SB_URL, SB_ANON, { auth: { persistSession: false } });
const srv = createClient(SB_URL, SB_SERVICE, { auth: { persistSession: false } });
const res = [];
const ok = (c, m) => res.push([c ? '✔' : '✘', m]);
const falla = async (p, m) => { const { error } = await p; ok(!!error, m + (error ? '' : ' (NO falló)')); };
const a = anon(), b = anon();
const j = (id, fecha, extra = {}) => ({ id, fecha, titulo: 'Asado', personas: [{ id: 'p1', nombre: 'Jesús', puso: 5000000, alcohol: 0, toma: true, porcentaje: 100, participa: true }], separarAlcohol: true, ...extra });
const id1 = crypto.randomUUID();

const { data: codigo, error: e1 } = await a.rpc('crear_grupo', { p_nombre: 'Los del asado' });
ok(!e1 && /^[a-z0-9]{12}$/.test(codigo), 'crear grupo devuelve un código de 12 caracteres');
await a.rpc('guardar_juntada', { p_codigo: codigo, p: j(id1, '2026-10-01') });
let { data: d } = await b.rpc('grupo_datos', { p_codigo: codigo });
ok(d?.juntadas?.length === 1 && d.juntadas[0].personas[0].nombre === 'Jesús', 'otro celular con el código ve la juntada');
await b.rpc('guardar_juntada', { p_codigo: codigo, p: j(id1, '2026-10-02', { titulo: 'Asado editado' }) });
({ data: d } = await a.rpc('grupo_datos', { p_codigo: codigo }));
ok(d.juntadas[0].titulo === 'Asado editado' && d.juntadas.length === 1, 'editar actualiza sin duplicar');
await a.rpc('actualizar_grupo', { p_codigo: codigo, p_aviso_dias: 15, p_amigos: ['Jesús', 'Pablo'] });
({ data: d } = await b.rpc('grupo_datos', { p_codigo: codigo }));
ok(d.avisoDias === 15 && d.amigos.length === 2, 'los días de aviso y amigos se comparten');

await falla(a.rpc('grupo_datos', { p_codigo: 'zzzzzzzzzzzz' }), 'un código inválido no da acceso');
await falla(a.from('juntadas').select('*'), 'no se puede leer la tabla directamente');
await falla(a.from('grupos').select('codigo'), 'no se pueden listar los códigos de los grupos');
await falla(a.rpc('tomar_avisos'), 'un celular no puede disparar los avisos');
const { data: otro } = await b.rpc('crear_grupo', { p_nombre: 'Otro grupo' });
await b.rpc('guardar_juntada', { p_codigo: otro, p: j(id1, '2020-01-01', { titulo: 'pisado' }) });
({ data: d } = await a.rpc('grupo_datos', { p_codigo: codigo }));
ok(d.juntadas[0].titulo === 'Asado editado', 'otro grupo no puede pisar una juntada ajena aunque sepa el id');
await falla(a.rpc('guardar_juntada', { p_codigo: codigo, p: { id: crypto.randomUUID(), fecha: '2026-10-01', personas: 'x' } }), 'rechaza datos mal formados');

// avisos
await a.rpc('suscribir_avisos', { p_codigo: codigo, p_endpoint: 'https://push.example/abc', p_p256dh: 'k', p_auth: 'a' });
await falla(a.rpc('suscribir_avisos', { p_codigo: codigo, p_endpoint: 'http://inseguro', p_p256dh: 'k', p_auth: 'a' }), 'rechaza endpoints no https');
let { data: av, error: eav } = await srv.rpc('tomar_avisos');
const mio = av?.find((x) => x.grupo_id && x.nombre === 'Los del asado');
ok(!eav && mio && mio.dias >= 15 && mio.suscripciones.length === 1, `el servidor detecta el grupo vencido (${mio?.dias} días) con su suscripción`);
({ data: av } = await srv.rpc('tomar_avisos'));
ok(!av.some((x) => x.nombre === 'Los del asado'), 'no repite el aviso en la segunda corrida');
const { data: cfg, error: ecfg } = await srv.from('config').select('*');
ok(!ecfg && Array.isArray(cfg), 'el servidor puede leer la configuración privada');
await a.rpc('cancelar_avisos', { p_endpoint: 'https://push.example/abc' });

// tiempo real
let recibido = false;
const chB = b.channel(`grupo-${codigo}`, { config: { broadcast: { self: false } } }).on('broadcast', { event: 'cambio' }, () => (recibido = true));
await new Promise((r) => chB.subscribe((s) => s === 'SUBSCRIBED' && r()));
const chA = a.channel(`grupo-${codigo}`, { config: { broadcast: { self: false } } });
await new Promise((r) => chA.subscribe((s) => s === 'SUBSCRIBED' && r()));
await chA.send({ type: 'broadcast', event: 'cambio', payload: {} });
for (let i = 0; i < 50 && !recibido; i++) await new Promise((r) => setTimeout(r, 100));
ok(recibido, 'el otro celular se entera del cambio en vivo');

await a.rpc('borrar_juntada', { p_codigo: codigo, p_id: id1 });
({ data: d } = await b.rpc('grupo_datos', { p_codigo: codigo }));
ok(d.juntadas.length === 0, 'borrar una juntada la saca para todos');

for (const r of res) console.log(r.join(' '));
const f = res.filter((r) => r[0] === '✘').length;
console.log(`\n${res.length - f}/${res.length} OK`);
process.exit(f ? 1 : 0);
