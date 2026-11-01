import type { SplitMethod } from '../lib/money';
import type {
  AppNotification, ExpenseCategory, GatheringStatus, GroupSettings, GroupSnapshot, GroupSummary, Invitation,
  MenuKind, PayMethod, Profile, Role, Rsvp, VenueKind, VoteValue
} from '../lib/types';

export interface SessionUser {
  id: string;
  email: string | null;
}

export interface ExpenseInput {
  id?: string;
  gathering_id: string;
  description: string;
  category: ExpenseCategory;
  amount_cents: number;
  currency?: string;
  split_method: SplitMethod;
  spent_on: string;
  receipt_path?: string | null;
  notes?: string | null;
  payers: { participant_id: string; amount_cents: number }[];
  splits: { participant_id: string; share: number; amount_cents: number }[];
}

export interface GatheringInput {
  group_id: string;
  title: string;
  starts_at: string | null;
  location: string | null;
  description: string | null;
  notes: string | null;
  status: Extract<GatheringStatus, 'proposed' | 'confirmed'>;
  invite_all: boolean;
  date_options: string[];
}

export interface SettlementInput {
  gathering_id: string;
  from: string;
  to: string;
  amount_cents: number;
  method: PayMethod;
  paid_on: string;
  notes?: string | null;
  receipt_path?: string | null;
  client_ref: string;
}

export type FileBucket = 'receipts' | 'photos' | 'avatars';

/**
 * Contrato común para los dos modos:
 *  - "supabase": datos reales, multiusuario, en la nube.
 *  - "demo": datos ficticios guardados solo en este navegador.
 */
export interface Backend {
  readonly mode: 'supabase' | 'demo';

  // Autenticación
  getUser(): Promise<SessionUser | null>;
  onAuthChange(cb: (u: SessionUser | null, event?: string) => void): () => void;
  signUp(email: string, password: string, displayName: string): Promise<{ needsConfirmation: boolean }>;
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  sendPasswordReset(email: string): Promise<void>;
  updatePassword(password: string): Promise<void>;

  // Perfil
  getProfile(userId: string): Promise<Profile | null>;
  updateProfile(patch: Partial<Pick<Profile, 'display_name' | 'alias' | 'avatar_url'>>): Promise<void>;

  // Grupos
  listGroups(): Promise<GroupSummary[]>;
  getSnapshot(groupId: string): Promise<GroupSnapshot>;
  findGroupOfGathering(gatheringId: string): Promise<string | null>;
  createGroup(name: string, description: string | null, imageUrl?: string | null): Promise<string>;
  updateGroup(groupId: string, patch: { name?: string; description?: string | null; image_url?: string | null }): Promise<void>;
  updateSettings(groupId: string, patch: Partial<Pick<GroupSettings, 'reminder_days' | 'reminders_enabled'>>): Promise<void>;
  listInvitations(groupId: string): Promise<Invitation[]>;
  createInvitation(groupId: string, days: number, maxUses: number | null): Promise<{ code: string; expires_at: string }>;
  revokeInvitation(id: string): Promise<void>;
  previewInvitation(code: string): Promise<{ group_name: string | null; member_count: number; is_valid: boolean; already_member: boolean }>;
  acceptInvitation(code: string): Promise<string>;
  leaveGroup(groupId: string): Promise<void>;
  removeMember(groupId: string, userId: string): Promise<void>;
  setMemberRole(groupId: string, userId: string, role: Role): Promise<void>;

  // Juntadas
  createGathering(input: GatheringInput): Promise<string>;
  updateGathering(id: string, patch: Partial<{ title: string; starts_at: string | null; location: string | null; description: string | null; notes: string | null; status: GatheringStatus }>): Promise<void>;
  deleteGathering(id: string): Promise<void>;
  addParticipant(gatheringId: string, who: { userId?: string; guestName?: string }): Promise<string>;
  removeParticipant(participantId: string): Promise<void>;
  setRsvp(gatheringId: string, rsvp: Rsvp): Promise<void>;

  // Gastos y pagos
  saveExpense(input: ExpenseInput): Promise<string>;
  deleteExpense(id: string): Promise<void>;
  reportSettlement(input: SettlementInput): Promise<string>;
  reviewSettlement(id: string, accept: boolean): Promise<void>;

  // Votaciones
  addDateOption(gatheringId: string, startsAt: string): Promise<void>;
  deleteDateOption(id: string): Promise<void>;
  voteDate(proposalId: string, vote: VoteValue | null): Promise<void>;
  confirmDate(proposalId: string): Promise<void>;
  addMenuOption(gatheringId: string, kind: MenuKind, label: string): Promise<void>;
  addVenueOption(gatheringId: string, kind: VenueKind, label: string): Promise<void>;
  deleteOption(type: 'menu' | 'venue', id: string): Promise<void>;
  voteOption(type: 'menu' | 'venue', gatheringId: string, proposalId: string | null): Promise<void>;

  // Archivos
  uploadFile(bucket: FileBucket, folder: string, file: Blob): Promise<string>;
  fileUrl(path: string): Promise<string | null>;
  addPhoto(gatheringId: string, path: string, caption: string | null): Promise<void>;
  deletePhoto(id: string): Promise<void>;

  // Notificaciones
  listNotifications(): Promise<AppNotification[]>;
  markNotificationsRead(ids: string[] | 'all'): Promise<void>;
  savePushSubscription(sub: PushSubscriptionJSON): Promise<void>;
  deletePushSubscription(endpoint: string): Promise<void>;

  // Tiempo real
  subscribeGroup(groupId: string, onChange: () => void): () => void;
  subscribeNotifications(userId: string, onChange: () => void): () => void;
}

/** Errores de Postgres/RPC → mensajes claros en español. */
export function friendlyError(e: unknown): string {
  const msg = (e as { message?: string })?.message ?? String(e);
  if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) return 'No hay conexión. Revisá tu internet e intentá de nuevo.';
  if (/Invalid login credentials/i.test(msg)) return 'Email o contraseña incorrectos.';
  if (/Email not confirmed/i.test(msg)) return 'Todavía no confirmaste tu email. Revisá tu casilla.';
  if (/User already registered/i.test(msg)) return 'Ya existe una cuenta con ese email.';
  if (/Password should be at least/i.test(msg)) return 'La contraseña debe tener al menos 6 caracteres.';
  if (/rate limit/i.test(msg)) return 'Demasiados intentos. Esperá unos minutos.';
  if (/permission denied|row-level security/i.test(msg)) return 'No tenés permiso para hacer eso.';
  const centavos = msg.match(/pendiente: (\d+) centavos/);
  if (centavos) {
    const n = Number(centavos[1]);
    return msg.replace(/\(pendiente: \d+ centavos\)/, `(pendiente: $ ${(n / 100).toLocaleString('es-AR')})`);
  }
  return msg.replace(/^.*?ERROR:\s*/, '');
}
