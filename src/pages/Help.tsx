import { Page } from '../components/ui';

const Q = ({ q, children }: { q: string; children: React.ReactNode }) => (
  <details className="card tight">
    <summary className="bold" style={{ cursor: 'pointer' }}>{q}</summary>
    <div className="muted small stack" style={{ marginTop: 8, gap: 6 }}>{children}</div>
  </details>
);

export default function Help() {
  return (
    <Page title="Guía de uso" back>
      <div className="stack">
        <h2>Instalar en el celular</h2>
        <Q q="📱 Android (Chrome, Edge, Samsung Internet)">
          <p>1. Abrí el enlace de La Juntada en Chrome.</p>
          <p>2. Tocá <b>Instalar</b> en el aviso que aparece abajo, o el menú <b>⋮ → Instalar app / Agregar a pantalla principal</b>.</p>
          <p>3. Abrila desde el ícono. Para recibir avisos, entrá a Perfil → Notificaciones push.</p>
        </Q>
        <Q q="🍏 iPhone / iPad (Safari)">
          <p>1. Abrí el enlace en <b>Safari</b> (en otros navegadores de iPhone no se puede instalar).</p>
          <p>2. Tocá el botón <b>Compartir</b> (cuadrado con flecha hacia arriba) → <b>Agregar a inicio</b> → Agregar.</p>
          <p>3. Abrí la app desde el ícono. Las notificaciones push requieren iOS 16.4 o superior y se activan desde Perfil, <b>con la app instalada</b>.</p>
        </Q>

        <h2 style={{ marginTop: 10 }}>Cómo se usa</h2>
        <Q q="1. Crear el grupo e invitar a los amigos">
          <p>Grupos → Crear grupo. Después tocá <b>Invitar</b> y mandá el enlace por WhatsApp. Los enlaces vencen solos y se pueden anular.</p>
        </Q>
        <Q q="2. Proponer una juntada y votar la fecha">
          <p>Tocá el botón <b>+</b>, elegí "Votar fecha" y sumá varias opciones. Cada uno vota Puedo / Tal vez / No puedo. La más votada se destaca; si hay empate se avisa y el organizador confirma una.</p>
          <p>En la pestaña Votación también se elige qué comer y dónde.</p>
        </Q>
        <Q q="3. Cargar lo que pagó cada uno">
          <p>En la juntada → Gastos → <b>Cargar lo que pagué</b>. Escribí el importe (por ejemplo 50.000), qué compraste y entre quiénes se divide.</p>
          <p>Si alguien no tomó cerveza, destildalo y no la paga. También podés repartir por porcentaje, por montos fijos o por proporciones (ej.: adultos 2, chicos 1). Si pagaron varios, activá "Varios".</p>
        </Q>
        <Q q="4. Ver quién le debe a quién y saldar">
          <p>La pestaña <b>Cuentas</b> calcula sola el total, lo que puso y lo que le tocaba a cada uno, y propone las mínimas transferencias para quedar a mano.</p>
          <p>Cuando pagás, tocá <b>Ya pagué</b>. Quien cobra recibe un aviso y lo confirma; recién ahí se descuenta. Se admiten pagos parciales. Si sos quien cobra, tocá <b>Me pagó</b> y queda confirmado.</p>
        </Q>
        <Q q="5. Recordatorios">
          <p>Cada grupo elige cada cuántos días quiere juntarse (7, 15, 30, 45, 60 o personalizado). Si pasa ese tiempo sin juntada, a todos les llega un aviso: "¡Hace 35 días que no se juntan!".</p>
        </Q>
        <Q q="¿Funciona sin internet?">
          <p>Podés abrir la app y consultar lo último que cargaste. Para cargar gastos, votar o registrar pagos hace falta conexión (así nadie pisa los datos de otro).</p>
        </Q>
        <Q q="¿Quién puede ver mis datos?">
          <p>Solo los integrantes de tus grupos. Nadie de afuera puede ver juntadas, gastos ni pagos, aunque tenga el enlace. Los administradores pueden corregir gastos de otros; todo queda registrado.</p>
        </Q>
      </div>
    </Page>
  );
}
