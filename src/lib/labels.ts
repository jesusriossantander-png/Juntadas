import type { ExpenseCategory, GatheringStatus, MenuKind, PayMethod, Rsvp, VenueKind } from './types';
import type { SplitMethod } from './money';

export const CATEGORIES: { id: ExpenseCategory; label: string; emoji: string }[] = [
  { id: 'carne', label: 'Carne', emoji: '🥩' },
  { id: 'bebidas', label: 'Bebidas', emoji: '🍺' },
  { id: 'pan', label: 'Pan', emoji: '🥖' },
  { id: 'carbon', label: 'Carbón / leña', emoji: '🔥' },
  { id: 'hielo', label: 'Hielo', emoji: '🧊' },
  { id: 'verduras', label: 'Verduras', emoji: '🥗' },
  { id: 'postre', label: 'Postre', emoji: '🍰' },
  { id: 'salon', label: 'Alquiler de salón', emoji: '🏠' },
  { id: 'descartables', label: 'Descartables', emoji: '🥤' },
  { id: 'otros', label: 'Otros', emoji: '🧾' }
];
export const categoryOf = (id: string) => CATEGORIES.find((c) => c.id === id) ?? CATEGORIES[CATEGORIES.length - 1];

export const STATUS_LABEL: Record<GatheringStatus, string> = {
  proposed: 'Propuesta',
  confirmed: 'Confirmada',
  done: 'Realizada',
  cancelled: 'Cancelada'
};

export const RSVP_LABEL: Record<Rsvp, string> = { pending: 'Sin responder', yes: 'Va', maybe: 'Tal vez', no: 'No va' };

export const SPLIT_LABEL: Record<SplitMethod, string> = {
  equal: 'Partes iguales',
  percent: 'Porcentajes',
  amount: 'Montos',
  weight: 'Proporciones'
};

export const PAY_METHODS: { id: PayMethod; label: string }[] = [
  { id: 'transferencia', label: 'Transferencia' },
  { id: 'mercadopago', label: 'Mercado Pago' },
  { id: 'efectivo', label: 'Efectivo' },
  { id: 'otro', label: 'Otro' }
];

export const MENU_KINDS: { id: MenuKind; label: string; emoji: string }[] = [
  { id: 'asado', label: 'Asado', emoji: '🥩' },
  { id: 'pizza', label: 'Pizza', emoji: '🍕' },
  { id: 'hamburguesas', label: 'Hamburguesas', emoji: '🍔' },
  { id: 'empanadas', label: 'Empanadas', emoji: '🥟' },
  { id: 'picada', label: 'Picada', emoji: '🧀' },
  { id: 'otro', label: 'Otro', emoji: '🍽️' }
];
export const VENUE_KINDS: { id: VenueKind; label: string; emoji: string }[] = [
  { id: 'casa', label: 'Casa de un integrante', emoji: '🏡' },
  { id: 'quincho', label: 'Quincho', emoji: '🛖' },
  { id: 'restaurante', label: 'Restaurante', emoji: '🍽️' },
  { id: 'otro', label: 'Otro', emoji: '📍' }
];
export const REMINDER_PRESETS = [7, 15, 30, 45, 60];
