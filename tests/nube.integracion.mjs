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
const celA = crypto.randomUUID(), celB = crypto.randomUUID();
const j = (id, fecha, extra = {}) => ({ id, fecha, titulo: 'Asado', personas: [{ id: 'p1', nombre: 'Jesús', puso: 5000000, alcohol: 0, toma: true, porcentaje: 100, participa: true }], separarAlcohol: true, ...extra });
const datos = (cli, codigo, cel, admin = null) => cli.rpc('grupo_datos', { p_codigo: codigo, p_dispositivo: cel, p_admin: admin });
const guardar = (cli, codigo, x, cel, admin = null) => cli.rpc('guardar_juntada', { p_codigo: codigo, p: x, p_dispositivo: cel, p_admin: admin });

// Grupo con administrador
const { data: g, error: e1 } = await a.rpc('crear_grupo', { p_nombre: 'Los del asado' });
ok(!e1 && /^[a-z0-9]{12}$/.test(g?.codigo) && g?.admin?.length === 24, 'crear grupo devuelve código y clave de administrador');
const { codigo, admin } = g;
const idA = crypto.randomUUID(), idB = crypto.randomUUID();
await guardar(a, codigo, j(idA, '2026-10-01'), celA, admin);
await guardar(b, codigo, j(idB, '2026-10-05', { titulo: 'La de Pablo' }), celB);
let { data: d } = await datos(b, codigo, celB);
ok(d.juntadas.length === 2 && !d.esAdmin && d.tieneAdmin, 'un amigo ve todo y sabe que hay administrador');
ok(d.juntadas.find((x) => x.id === idB).editable && !d.juntadas.find((x) => x.id === idA).editable, 'el amigo puede editar solo la que cargó él');
await falla(guardar(b, codigo, j(idA, '2026-10-01', { titulo: 'hack' }), celB), 'un amigo no puede editar la juntada de otro');
await guardar(b, codigo, j(idB, '2026-10-05', { titulo: 'La de Pablo (editada)' }), celB);
await guardar(a, codigo, j(idB, '2026-10-05', { titulo: 'Corregida por el admin' }), celA, admin);
({ data: d } = await datos(a, codigo, celA, admin));
ok(d.esAdmin && d.juntadas.every((x) => x.editable) && d.juntadas.find((x) => x.id === idB).titulo === 'Corregida por el admin', 'el administrador edita todas');
await falla(b.rpc('actualizar_grupo', { p_codigo: codigo, p_aviso_dias: 7 }), 'un amigo no puede cambiar los días del aviso');
await b.rpc('actualizar_grupo', { p_codigo: codigo, p_amigos: ['Jesús', 'Pablo'] });
await a.rpc('actualizar_grupo', { p_codigo: codigo, p_aviso_dias: 15, p_admin: admin });
({ data: d } = await datos(b, codigo, celB));
ok(d.avisoDias === 15 && d.amigos.length === 2, 'el admin cambia los días; los amigos frecuentes los actualiza cualquiera');
await falla(b.rpc('borrar_juntada', { p_codigo: codigo, p_id: idB }), 'un amigo no puede borrar juntadas');
await falla(b.rpc('reclamar_admin', { p_codigo: codigo }), 'nadie puede quitarle el administrador a un grupo que ya tiene');

// Grupo viejo sin administrador
const { data: g2 } = await b.rpc('crear_grupo', { p_nombre: 'Viejo' });
const { error: eSql } = await srv.from('grupos').select('id').limit(1);
ok(!eSql, 'el servidor accede a los grupos');

// Seguridad general
await falla(a.rpc('grupo_datos', { p_codigo: 'zzzzzzzzzzzz' }), 'un código inválido no da acceso');
await falla(a.from('juntadas').select('*'), 'no se puede leer la tabla directamente');
await falla(a.from('grupos').select('codigo, admin_token'), 'no se pueden listar códigos ni claves de admin');
await falla(a.rpc('tomar_avisos'), 'un celular no puede disparar los avisos');
await guardar(b, g2.codigo, j(idA, '2020-01-01', { titulo: 'pisado' }), celA, g2.admin);
({ data: d } = await datos(a, codigo, celA, admin));
ok(d.juntadas.find((x) => x.id === idA).titulo === 'Asado', 'otro grupo no puede pisar una juntada ajena aunque sepa el id');
await falla(guardar(a, codigo, { id: crypto.randomUUID(), fecha: '2026-10-01', personas: 'x' }, celA), 'rechaza datos mal formados');

// Avisos en varios grupos con el mismo celular
const ep = 'https://push.example/' + crypto.randomUUID();
await a.rpc('suscribir_avisos', { p_codigo: codigo, p_endpoint: ep, p_p256dh: 'k', p_auth: 'a' });
await a.rpc('suscribir_avisos', { p_codigo: g2.codigo, p_endpoint: ep, p_p256dh: 'k', p_auth: 'a' });
let { data: subs } = await srv.from('suscripciones').select('grupo_id').eq('endpoint', ep);
ok(subs.length === 2, 'un celular recibe avisos de dos grupos');
await a.rpc('cancelar_avisos', { p_endpoint: ep, p_codigo: g2.codigo });
({ data: subs } = await srv.from('suscripciones').select('grupo_id').eq('endpoint', ep));
ok(subs.length === 1, 'desactivar en un grupo no apaga el otro');
await falla(a.rpc('suscribir_avisos', { p_codigo: codigo, p_endpoint: 'http://inseguro', p_p256dh: 'k', p_auth: 'a' }), 'rechaza endpoints no https');
let { data: av, error: eav } = await srv.rpc('tomar_avisos');
const mio = av?.find((x) => x.nombre === 'Los del asado');
ok(!eav && mio && mio.dias >= 15 && mio.suscripciones.length === 1, `el servidor detecta el grupo vencido (${mio?.dias} días)`);
({ data: av } = await srv.rpc('tomar_avisos'));
ok(!av.some((x) => x.nombre === 'Los del asado'), 'no repite el aviso en la segunda corrida');
const { data: pub } = await a.rpc('clave_publica_avisos');
ok(pub === null || (typeof pub === 'string' && pub.length > 80), 'la app puede pedir la clave pública de avisos');
await falla(a.from('config').select('valor'), 'la app no puede leer la clave privada');
await a.rpc('cancelar_avisos', { p_endpoint: ep });

// Tiempo real
let recibido = false;
const chB = b.channel(`grupo-${codigo}`, { config: { broadcast: { self: false } } }).on('broadcast', { event: 'cambio' }, () => (recibido = true));
await new Promise((r) => chB.subscribe((s) => s === 'SUBSCRIBED' && r()));
const chA = a.channel(`grupo-${codigo}`, { config: { broadcast: { self: false } } });
await new Promise((r) => chA.subscribe((s) => s === 'SUBSCRIBED' && r()));
await chA.send({ type: 'broadcast', event: 'cambio', payload: {} });
for (let i = 0; i < 50 && !recibido; i++) await new Promise((r) => setTimeout(r, 100));
ok(recibido, 'el otro celular se entera del cambio en vivo');

await a.rpc('borrar_juntada', { p_codigo: codigo, p_id: idB, p_admin: admin });
({ data: d } = await datos(b, codigo, celB));
ok(d.juntadas.length === 1, 'el administrador puede borrar una juntada');

for (const r of res) console.log(r.join(' '));
const f = res.filter((r) => r[0] === '✘').length;
console.log(`\n${res.length - f}/${res.length} OK`);
process.exit(f ? 1 : 0);
