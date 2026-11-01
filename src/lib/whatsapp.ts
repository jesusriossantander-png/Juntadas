// Mensajes para compartir por WhatsApp con el enlace oficial https://wa.me/?text=
// (abre WhatsApp con el texto listo; la persona elige el chat y envía).
import { formatMoney } from './money';
import { formatDateTime } from './format';

export function whatsappUrl(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

export function appUrl(path: string): string {
  const configured = import.meta.env?.VITE_PUBLIC_APP_URL as string | undefined;
  // Se conserva la barra final (ej. https://usuario.github.io/Juntadas/) para que el enlace abra directo.
  let base = configured || (typeof location !== 'undefined' ? location.origin + location.pathname : '');
  if (!base.endsWith('/')) base += '/';
  return `${base}#${path.startsWith('/') ? path : '/' + path}`;
}

export const messages = {
  proposal: (days: number | null, link: string) =>
    days && days > 0
      ? `🍻 Muchachos, ya pasaron ${days} días desde la última juntada. ¿Organizamos una? Entren acá para votar la fecha: ${link}`
      : `🍻 Muchachos, ¿organizamos una juntada? Entren acá para votar la fecha: ${link}`,
  accounts: (title: string, link: string) =>
    `💰 Ya están las cuentas de "${title}". Entren a La Juntada para ver cuánto puso y cuánto debe cada uno: ${link}`,
  confirmed: (title: string, startsAt: string | null, place: string | null, link: string) =>
    `🔥 Se confirmó "${title}" para el ${formatDateTime(startsAt).toLowerCase()}${place ? ` en ${place}` : ''}. ¡Confirmen asistencia! ${link}`,
  invite: (groupName: string, code: string, link: string) =>
    `👋 Sumate a "${groupName}" en La Juntada para organizar las juntadas y las cuentas. Código: ${code} · ${link}`,
  debt: (who: string, amount: number, title: string, alias: string | null, link: string) =>
    `Hola ${who}! De "${title}" quedaste debiendo ${formatMoney(amount)}${alias ? `. Mi alias: ${alias}` : ''}. Detalle: ${link}`
};
