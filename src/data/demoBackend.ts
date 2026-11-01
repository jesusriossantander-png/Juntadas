/**
 * Backend de DEMOSTRACIÓN: datos ficticios guardados solo en este navegador
 * (localStorage). Replica las mismas reglas de autorización que las RPC de
 * Supabase para que la demo se comporte igual que la app real.
 * Nunca se mezcla con datos reales: usa claves de almacenamiento propias.
 */
import type { Backend, ExpenseInput, FileBucket, GatheringInput, SettlementInput, SessionUser } from './backend';
import type {
  AppNotification, DateProposal, DateVote, Expense, Gathering, GroupMember, GroupSettings, GroupSnapshot, GroupSummary,
  Invitation, MenuKind, OptionProposal, OptionVote, Participant, Photo, Profile, Role, Rsvp, Settlement, VenueKind, Group
} from '../lib/types';
import { computeBalances } from '../lib/balances';
import { reminderState } from '../lib/insights';
import { buildDemoDB } from './demoSeed';

export const DEMO_DB_KEY = 'la-juntada:demo:db:v1';
const DEMO_USER_KEY = 'la-juntada:demo:user';
const DEMO_FILES_KEY = 'la-juntada:demo:files';
const CHANNEL = 'la-juntada-demo';

type DbExpense = Expense & { deleted_at: string | null };
type DbSettlement = Settlement & { client_ref: string | null };
type DbNotification = AppNotification & { dedupe_key: string };

export interface DemoDB {
  version: 1;
  users: { id: string; email: string; password: string }[];
  profiles: Profile[];
  groups: Group[];
  settings: GroupSettings[];
  members: GroupMember[];
  invitations: Invitation[];
  gatherings: Gathering[];
  participants: Participant[];
  expenses: DbExpense[];
  settlements: DbSettlement[];
  dateProposals: DateProposal[];
  dateVotes: DateVote[];
  menuProposals: OptionProposal<MenuKind>[];
  menuVotes: OptionVote[];
  venueProposals: OptionProposal<VenueKind>[];
  venueVotes: OptionVote[];
  photos: Photo[];
  notifications: DbNotification[];
  audit: { id: number; group_id: string | null; actor_id: string | null; action: string; entity: string; entity_id: string | null; created_at: string }[];
}

const now = () => new Date().toISOString();
const uuid = () => crypto.randomUUID();
const delay = () => new Promise((r) => setTimeout(r, 60));

class DemoError extends Error {}
const fail = (msg: string): never => {
  throw new DemoError(msg);
};

export class DemoBackend implements Backend {
  readonly mode = 'demo' as const;
  private db: DemoDB;
  private listeners = new Set<() => void>();
  private authListeners = new Set<(u: SessionUser | null, e?: string) => void>();
  private channel: BroadcastChannel | null = null;

  constructor() {
    this.db = this.load();
    if (typeof BroadcastChannel !== 'undefined') {
      this.channel = new BroadcastChannel(CHANNEL);
      this.channel.onmessage = () => {
        this.db = this.load();
        this.listeners.forEach((l) => l());
      };
    }
  }

  // ---------------------------------------------------------------- storage
  private load(): DemoDB {
    try {
      const raw = localStorage.getItem(DEMO_DB_KEY);
      if (raw) {
        const db = JSON.parse(raw) as DemoDB;
        if (db.version === 1) return db;
      }
    } catch {
      /* datos corruptos: se regeneran */
    }
    const db = buildDemoDB();
    localStorage.setItem(DEMO_DB_KEY, JSON.stringify(db));
    return db;
  }
  private save() {
    localStorage.setItem(DEMO_DB_KEY, JSON.stringify(this.db));
    this.channel?.postMessage('change');
    queueMicrotask(() => this.listeners.forEach((l) => l()));
  }
  /** Restaura los datos de demostración originales. */
  reset() {
    localStorage.removeItem(DEMO_DB_KEY);
    localStorage.removeItem(DEMO_FILES_KEY);
    this.db = this.load();
    this.save();
  }
  demoUsers() {
    return this.db.users.slice(0, 5).map((u) => ({ ...u, profile: this.db.profiles.find((p) => p.id === u.id)! }));
  }

  // ------------------------------------------------------------------- auth
  /** Usuario de la demo: por pestaña (sessionStorage) para poder probar con varios amigos a la vez. */
  private currentId(): string | null {
    return sessionStorage.getItem(DEMO_USER_KEY) ?? localStorage.getItem(DEMO_USER_KEY);
  }
  private me(): string {
    const id = this.currentId();
    if (!id || !this.db.users.some((u) => u.id === id)) fail('Tenés que iniciar sesión');
    return id!;
  }
  async getUser(): Promise<SessionUser | null> {
    const id = this.currentId();
    const u = this.db.users.find((x) => x.id === id);
    return u ? { id: u.id, email: u.email } : null;
  }
  onAuthChange(cb: (u: SessionUser | null, e?: string) => void) {
    this.authListeners.add(cb);
    return () => void this.authListeners.delete(cb);
  }
  private emitAuth(event: string) {
    this.getUser().then((u) => this.authListeners.forEach((l) => l(u, event)));
  }
  async loginAs(userId: string) {
    sessionStorage.setItem(DEMO_USER_KEY, userId);
    localStorage.setItem(DEMO_USER_KEY, userId);
    this.emitAuth('SIGNED_IN');
  }
  async signUp(email: string, password: string, displayName: string) {
    await delay();
    email = email.trim().toLowerCase();
    if (this.db.users.some((u) => u.email === email)) fail('Ya existe una cuenta con ese email.');
    if (password.length < 6) fail('La contraseña debe tener al menos 6 caracteres.');
    const id = uuid();
    this.db.users.push({ id, email, password });
    this.db.profiles.push({ id, display_name: displayName.trim() || email.split('@')[0], alias: null, avatar_url: null });
    this.save();
    await this.loginAs(id);
    return { needsConfirmation: false };
  }
  async signIn(email: string, password: string) {
    await delay();
    const u = this.db.users.find((x) => x.email === email.trim().toLowerCase());
    if (!u || u.password !== password) fail('Email o contraseña incorrectos.');
    await this.loginAs(u!.id);
  }
  async signOut() {
    sessionStorage.removeItem(DEMO_USER_KEY);
    localStorage.removeItem(DEMO_USER_KEY);
    this.emitAuth('SIGNED_OUT');
  }
  async sendPasswordReset() {
    await delay();
  }
  async updatePassword(password: string) {
    const u = this.db.users.find((x) => x.id === this.me())!;
    if (password.length < 6) fail('La contraseña debe tener al menos 6 caracteres.');
    u.password = password;
    this.save();
  }

  // ---------------------------------------------------------------- helpers
  private isMember(g: string, u = this.me()) {
    return this.db.members.some((m) => m.group_id === g && m.user_id === u);
  }
  private isAdmin(g: string, u = this.me()) {
    return this.db.members.some((m) => m.group_id === g && m.user_id === u && m.role === 'admin');
  }
  private gathering(id: string) {
    return this.db.gatherings.find((g) => g.id === id) ?? fail('La juntada no existe');
  }
  private canAccess(gid: string) {
    const g = this.db.gatherings.find((x) => x.id === gid);
    if (!g) return false;
    return this.isMember(g.group_id) || this.db.participants.some((p) => p.gathering_id === gid && p.user_id === this.me());
  }
  private canManage(gid: string) {
    const g = this.gathering(gid);
    return g.created_by === this.me() || this.isAdmin(g.group_id);
  }
  private requireAccess(gid: string) {
    if (!this.canAccess(gid)) fail('No tenés acceso a esta juntada');
  }
  private audit(group_id: string | null, action: string, entity: string, entity_id: string | null) {
    this.db.audit.push({ id: this.db.audit.length + 1, group_id, actor_id: this.me(), action, entity, entity_id, created_at: now() });
  }
  private notify(user_id: string, n: Omit<DbNotification, 'id' | 'user_id' | 'read_at' | 'created_at'>) {
    if (this.db.notifications.some((x) => x.user_id === user_id && x.dedupe_key === n.dedupe_key)) return;
    this.db.notifications.push({ ...n, id: uuid(), user_id, read_at: null, created_at: now() });
  }
  private notifyGroup(group_id: string, except: string | null, n: Omit<DbNotification, 'id' | 'user_id' | 'read_at' | 'created_at' | 'group_id'>) {
    this.db.members.filter((m) => m.group_id === group_id && m.user_id !== except).forEach((m) => this.notify(m.user_id, { ...n, group_id }));
  }
  private name(userId: string) {
    const p = this.db.profiles.find((x) => x.id === userId);
    return p?.alias || p?.display_name || 'Alguien';
  }
  /** Simula el cron diario: genera recordatorios vencidos sin duplicar. */
  private runReminders() {
    let changed = false;
    for (const s of this.db.settings) {
      const group = this.db.groups.find((g) => g.id === s.group_id);
      if (!group) continue;
      const gatherings = this.db.gatherings.filter((g) => g.group_id === s.group_id);
      const st = reminderState({ group, settings: s, gatherings });
      if (!st.due) continue;
      const cycle = Math.floor(st.days / st.threshold);
      const before = this.db.notifications.length;
      this.notifyGroup(s.group_id, null, {
        gathering_id: null, kind: 'reminder', title: `🍻 ¡Hace ${st.days} días que no se juntan!`,
        body: `Ya va siendo hora de organizar otro asado con ${group.name}.`, link: `/juntadas/nueva?grupo=${s.group_id}`,
        dedupe_key: `reminder:${s.group_id}:${cycle}:${gatherings.length}`
      });
      if (this.db.notifications.length > before) {
        s.last_reminder_at = now();
        changed = true;
      }
    }
    if (changed) localStorage.setItem(DEMO_DB_KEY, JSON.stringify(this.db));
  }

  // ---------------------------------------------------------------- profile
  async getProfile(userId: string) {
    return this.db.profiles.find((p) => p.id === userId) ?? null;
  }
  async updateProfile(patch: Partial<Pick<Profile, 'display_name' | 'alias' | 'avatar_url'>>) {
    const p = this.db.profiles.find((x) => x.id === this.me())!;
    Object.assign(p, patch);
    this.save();
  }

  // ----------------------------------------------------------------- groups
  async listGroups(): Promise<GroupSummary[]> {
    await delay();
    const me = this.me();
    return this.db.members
      .filter((m) => m.user_id === me)
      .map((m) => ({
        group: this.db.groups.find((g) => g.id === m.group_id)!,
        role: m.role,
        member_count: this.db.members.filter((x) => x.group_id === m.group_id).length
      }))
      .filter((x) => x.group)
      .sort((a, b) => a.group.name.localeCompare(b.group.name, 'es'));
  }
  async findGroupOfGathering(id: string) {
    const g = this.db.gatherings.find((x) => x.id === id);
    return g && this.canAccess(id) ? g.group_id : null;
  }
  async getSnapshot(groupId: string): Promise<GroupSnapshot> {
    await delay();
    if (!this.isMember(groupId)) fail('No pertenecés a este grupo');
    this.runReminders();
    const db = this.db;
    const gatherings = db.gatherings.filter((g) => g.group_id === groupId);
    const gids = new Set(gatherings.map((g) => g.id));
    const members = db.members.filter((m) => m.group_id === groupId);
    const participants = db.participants.filter((p) => gids.has(p.gathering_id));
    const ids = new Set([...members.map((m) => m.user_id), ...participants.map((p) => p.user_id).filter(Boolean) as string[]]);
    const pids = new Set(db.dateProposals.filter((p) => gids.has(p.gathering_id)).map((p) => p.id));
    const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
    return clone({
      group: db.groups.find((g) => g.id === groupId)!,
      settings: db.settings.find((s) => s.group_id === groupId)!,
      members,
      profiles: Object.fromEntries(db.profiles.filter((p) => ids.has(p.id)).map((p) => [p.id, p])),
      gatherings: [...gatherings].sort((a, b) => (b.starts_at ?? '9').localeCompare(a.starts_at ?? '9')),
      participants,
      expenses: db.expenses.filter((e) => gids.has(e.gathering_id) && !e.deleted_at),
      settlements: db.settlements.filter((s) => gids.has(s.gathering_id)),
      dateProposals: db.dateProposals.filter((p) => gids.has(p.gathering_id)),
      dateVotes: db.dateVotes.filter((v) => pids.has(v.proposal_id)),
      menuProposals: db.menuProposals.filter((p) => gids.has(p.gathering_id)),
      menuVotes: db.menuVotes.filter((v) => gids.has(v.gathering_id)),
      venueProposals: db.venueProposals.filter((p) => gids.has(p.gathering_id)),
      venueVotes: db.venueVotes.filter((v) => gids.has(v.gathering_id)),
      photos: db.photos.filter((p) => gids.has(p.gathering_id))
    });
  }
  async createGroup(name: string, description: string | null, imageUrl: string | null = null) {
    const me = this.me();
    if (!name.trim()) fail('Poné un nombre para el grupo');
    const id = uuid();
    this.db.groups.push({ id, name: name.trim(), description: description?.trim() || null, image_url: imageUrl, created_by: me, created_at: now() });
    this.db.members.push({ group_id: id, user_id: me, role: 'admin', joined_at: now() });
    this.db.settings.push({ group_id: id, reminder_days: 30, reminders_enabled: true, last_reminder_at: null });
    this.audit(id, 'create', 'group', id);
    this.save();
    return id;
  }
  async updateGroup(groupId: string, patch: { name?: string; description?: string | null; image_url?: string | null }) {
    if (!this.isAdmin(groupId)) fail('Solo un administrador puede editar el grupo');
    Object.assign(this.db.groups.find((g) => g.id === groupId)!, patch);
    this.save();
  }
  async updateSettings(groupId: string, patch: Partial<Pick<GroupSettings, 'reminder_days' | 'reminders_enabled'>>) {
    if (!this.isAdmin(groupId)) fail('Solo un administrador puede cambiar la configuración');
    if (patch.reminder_days != null && (patch.reminder_days < 1 || patch.reminder_days > 365)) fail('La frecuencia debe ser entre 1 y 365 días');
    Object.assign(this.db.settings.find((s) => s.group_id === groupId)!, patch);
    this.save();
  }
  async listInvitations(groupId: string) {
    if (!this.isMember(groupId)) return [];
    return this.db.invitations.filter((i) => i.group_id === groupId).sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  async createInvitation(groupId: string, days: number, maxUses: number | null) {
    if (!this.isMember(groupId)) fail('No pertenecés a este grupo');
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const bytes = crypto.getRandomValues(new Uint8Array(8));
    const code = Array.from(bytes, (b) => alphabet[b % 32]).join('');
    const inv: Invitation = {
      id: uuid(), group_id: groupId, code, created_by: this.me(), created_at: now(),
      expires_at: new Date(Date.now() + days * 86_400_000).toISOString(), max_uses: maxUses, uses: 0, revoked_at: null
    };
    this.db.invitations.push(inv);
    this.save();
    return { code, expires_at: inv.expires_at };
  }
  async revokeInvitation(id: string) {
    const inv = this.db.invitations.find((i) => i.id === id) ?? fail('La invitación no existe');
    if (!(this.isAdmin(inv.group_id) || inv.created_by === this.me())) fail('No tenés permiso');
    inv.revoked_at = now();
    this.save();
  }
  private validInvitation(inv: Invitation) {
    return !inv.revoked_at && Date.parse(inv.expires_at) > Date.now() && (inv.max_uses == null || inv.uses < inv.max_uses);
  }
  async previewInvitation(code: string) {
    await delay();
    const inv = this.db.invitations.find((i) => i.code === code.trim().toUpperCase());
    if (!inv) return { group_name: null, member_count: 0, is_valid: false, already_member: false };
    return {
      group_name: this.db.groups.find((g) => g.id === inv.group_id)?.name ?? null,
      member_count: this.db.members.filter((m) => m.group_id === inv.group_id).length,
      is_valid: this.validInvitation(inv),
      already_member: this.isMember(inv.group_id)
    };
  }
  async acceptInvitation(code: string) {
    const me = this.me();
    const inv = this.db.invitations.find((i) => i.code === code.trim().toUpperCase()) ?? fail('El código de invitación no existe');
    if (this.isMember(inv.group_id)) return inv.group_id;
    if (inv.revoked_at) fail('Esta invitación fue anulada');
    if (Date.parse(inv.expires_at) <= Date.now()) fail('Esta invitación venció');
    if (inv.max_uses != null && inv.uses >= inv.max_uses) fail('Esta invitación ya no tiene cupo');
    this.db.members.push({ group_id: inv.group_id, user_id: me, role: 'member', joined_at: now() });
    inv.uses++;
    this.audit(inv.group_id, 'join', 'group_member', me);
    this.notifyGroup(inv.group_id, me, {
      gathering_id: null, kind: 'member_joined', title: `${this.name(me)} se sumó al grupo`, body: null,
      link: `/grupos/${inv.group_id}`, dedupe_key: `join:${inv.group_id}:${me}`
    });
    this.save();
    return inv.group_id;
  }
  async leaveGroup(groupId: string) {
    const me = this.me();
    const m = this.db.members.find((x) => x.group_id === groupId && x.user_id === me) ?? fail('No pertenecés a este grupo');
    this.db.members = this.db.members.filter((x) => x !== m);
    const rest = this.db.members.filter((x) => x.group_id === groupId);
    if (!rest.length) {
      this.db.groups = this.db.groups.filter((g) => g.id !== groupId);
    } else if (m.role === 'admin' && !rest.some((x) => x.role === 'admin')) {
      rest.sort((a, b) => a.joined_at.localeCompare(b.joined_at))[0].role = 'admin';
    }
    this.audit(groupId, 'leave', 'group_member', me);
    this.save();
  }
  async removeMember(groupId: string, userId: string) {
    if (!this.isAdmin(groupId)) fail('Solo un administrador puede quitar integrantes');
    if (userId === this.me()) fail('Para salir del grupo usá "Abandonar grupo"');
    this.db.members = this.db.members.filter((x) => !(x.group_id === groupId && x.user_id === userId));
    this.save();
  }
  async setMemberRole(groupId: string, userId: string, role: Role) {
    if (!this.isAdmin(groupId)) fail('Solo un administrador puede cambiar roles');
    const m = this.db.members.find((x) => x.group_id === groupId && x.user_id === userId) ?? fail('Esa persona no es integrante del grupo');
    const prev = m.role;
    m.role = role;
    if (!this.db.members.some((x) => x.group_id === groupId && x.role === 'admin')) {
      m.role = prev;
      fail('El grupo necesita al menos un administrador');
    }
    this.save();
  }

  // ------------------------------------------------------------- gatherings
  async createGathering(i: GatheringInput) {
    const me = this.me();
    if (!this.isMember(i.group_id)) fail('No pertenecés a este grupo');
    if (!i.title.trim()) fail('Poné un nombre para la juntada');
    if (i.status === 'confirmed' && !i.starts_at) fail('Una juntada confirmada necesita fecha');
    const id = uuid();
    this.db.gatherings.push({
      id, group_id: i.group_id, title: i.title.trim(), starts_at: i.starts_at, location: i.location, description: i.description,
      notes: i.notes, status: i.status, currency: 'ARS', created_by: me, created_at: now(),
      confirmed_at: i.status === 'confirmed' ? now() : null
    });
    this.db.participants.push({ id: uuid(), gathering_id: id, user_id: me, guest_name: null, rsvp: 'yes', added_by: me });
    if (i.invite_all) {
      this.db.members
        .filter((m) => m.group_id === i.group_id && m.user_id !== me)
        .forEach((m) => this.db.participants.push({ id: uuid(), gathering_id: id, user_id: m.user_id, guest_name: null, rsvp: 'pending', added_by: me }));
    }
    [...new Set(i.date_options)].forEach((d) => this.db.dateProposals.push({ id: uuid(), gathering_id: id, starts_at: d, created_by: me }));
    this.audit(i.group_id, 'create', 'gathering', id);
    this.notifyGroup(i.group_id, me, {
      gathering_id: id,
      kind: i.status === 'proposed' ? 'gathering_proposed' : 'gathering_confirmed',
      title: i.status === 'proposed' ? `🍻 ${this.name(me)} propuso: ${i.title.trim()}` : `🔥 Nueva juntada confirmada: ${i.title.trim()}`,
      body: i.status === 'proposed' ? 'Entrá a votar fecha, menú y lugar.' : 'Confirmá tu asistencia.',
      link: `/juntadas/${id}`, dedupe_key: `gathering:${id}:created`
    });
    this.save();
    return id;
  }
  async updateGathering(id: string, patch: Partial<Gathering>) {
    if (!this.canManage(id)) fail('Solo el organizador o un admin puede modificar la juntada');
    const g = this.gathering(id);
    const allowed: (keyof Gathering)[] = ['title', 'starts_at', 'location', 'description', 'notes', 'status'];
    for (const k of allowed) if (k in patch) (g as unknown as Record<string, unknown>)[k] = patch[k];
    if (patch.status === 'confirmed') g.confirmed_at = now();
    this.save();
  }
  async deleteGathering(id: string) {
    const g = this.gathering(id);
    if (!this.isAdmin(g.group_id)) fail('Solo un administrador puede eliminar la juntada');
    this.db.gatherings = this.db.gatherings.filter((x) => x.id !== id);
    this.save();
  }
  async addParticipant(gatheringId: string, who: { userId?: string; guestName?: string }) {
    const me = this.me();
    const g = this.gathering(gatheringId);
    const guest = who.guestName?.trim();
    if (!!who.userId === !!guest) fail('Indicá un integrante o el nombre de un invitado');
    if (who.userId) {
      if (!this.isMember(g.group_id)) fail('No pertenecés a este grupo');
      if (who.userId !== me && !this.canManage(gatheringId)) fail('Solo el organizador o un admin puede sumar a otras personas');
      if (!this.isMember(g.group_id, who.userId)) fail('Esa persona no es integrante del grupo');
      const ex = this.db.participants.find((p) => p.gathering_id === gatheringId && p.user_id === who.userId);
      if (ex) return ex.id;
    } else if (!this.canManage(gatheringId)) {
      fail('Solo el organizador o un admin puede sumar invitados');
    }
    const id = uuid();
    this.db.participants.push({ id, gathering_id: gatheringId, user_id: who.userId ?? null, guest_name: guest || null, rsvp: guest ? 'yes' : 'pending', added_by: me });
    this.save();
    return id;
  }
  async removeParticipant(pid: string) {
    const p = this.db.participants.find((x) => x.id === pid) ?? fail('El asistente no existe');
    if (!(this.canManage(p.gathering_id) || p.user_id === this.me())) fail('No tenés permiso para quitar a este asistente');
    const used =
      this.db.expenses.some((e) => !e.deleted_at && (e.payers.some((x) => x.participant_id === pid) || e.splits.some((x) => x.participant_id === pid && x.amount_cents > 0))) ||
      this.db.settlements.some((s) => s.status !== 'rejected' && (s.from_participant === pid || s.to_participant === pid));
    if (used) fail('No se puede quitar: tiene gastos o pagos registrados. Marcá que no asiste.');
    this.db.participants = this.db.participants.filter((x) => x.id !== pid);
    this.save();
  }
  async setRsvp(gatheringId: string, rsvp: Rsvp) {
    const me = this.me();
    this.requireAccess(gatheringId);
    const p = this.db.participants.find((x) => x.gathering_id === gatheringId && x.user_id === me);
    if (p) p.rsvp = rsvp;
    else this.db.participants.push({ id: uuid(), gathering_id: gatheringId, user_id: me, guest_name: null, rsvp, added_by: me });
    this.save();
  }

  // ------------------------------------------------------------------ money
  async saveExpense(i: ExpenseInput) {
    const me = this.me();
    await delay();
    const g = this.gathering(i.gathering_id);
    this.requireAccess(g.id);
    if (g.status === 'cancelled') fail('La juntada está cancelada');
    if (!Number.isSafeInteger(i.amount_cents) || i.amount_cents <= 0) fail('El importe debe ser mayor a cero');
    const valid = (pid: string) => this.db.participants.some((p) => p.id === pid && p.gathering_id === g.id);
    if (!i.payers.length) fail('Indicá quién pagó');
    if (i.payers.some((p) => p.amount_cents <= 0 || !valid(p.participant_id))) fail('Hay pagadores inválidos');
    const paid = i.payers.reduce((a, p) => a + p.amount_cents, 0);
    if (paid !== i.amount_cents) fail(`Lo pagado no coincide con el total`);
    if (!i.splits.length) fail('Elegí entre quiénes se divide');
    if (i.splits.some((s) => s.amount_cents < 0 || !valid(s.participant_id))) fail('Hay repartos inválidos');
    if (i.splits.reduce((a, s) => a + s.amount_cents, 0) !== i.amount_cents) fail('El reparto no coincide con el total');
    if (new Set(i.splits.map((s) => s.participant_id)).size !== i.splits.length) fail('Hay participantes repetidos en el reparto');
    if (new Set(i.payers.map((s) => s.participant_id)).size !== i.payers.length) fail('Hay pagadores repetidos');

    let id = i.id;
    if (id) {
      const e = this.db.expenses.find((x) => x.id === id && !x.deleted_at) ?? fail('El gasto no existe');
      if (!(e.created_by === me || this.canManage(g.id))) fail('Solo quien cargó el gasto o un admin puede editarlo');
      Object.assign(e, {
        description: i.description.trim(), category: i.category, amount_cents: i.amount_cents, split_method: i.split_method,
        spent_on: i.spent_on, receipt_path: i.receipt_path ?? null, notes: i.notes ?? null, updated_at: now(),
        payers: i.payers.map((p) => ({ ...p, expense_id: id! })), splits: i.splits.map((s) => ({ ...s, expense_id: id! }))
      });
      this.audit(g.group_id, 'update', 'expense', id);
    } else {
      id = uuid();
      this.db.expenses.push({
        id, gathering_id: g.id, description: i.description.trim(), category: i.category, amount_cents: i.amount_cents,
        currency: 'ARS', split_method: i.split_method, spent_on: i.spent_on, receipt_path: i.receipt_path ?? null,
        notes: i.notes ?? null, created_by: me, created_at: now(), updated_at: now(), deleted_at: null,
        payers: i.payers.map((p) => ({ ...p, expense_id: id! })), splits: i.splits.map((s) => ({ ...s, expense_id: id! }))
      });
      this.audit(g.group_id, 'create', 'expense', id);
    }
    this.save();
    return id;
  }
  async deleteExpense(id: string) {
    const e = this.db.expenses.find((x) => x.id === id && !x.deleted_at) ?? fail('El gasto no existe');
    if (!(e.created_by === this.me() || this.canManage(e.gathering_id))) fail('Solo quien cargó el gasto o un admin puede eliminarlo');
    e.deleted_at = now();
    this.audit(this.gathering(e.gathering_id).group_id, 'delete', 'expense', id);
    this.save();
  }
  private nets(gid: string, includeReported: boolean) {
    const parts = this.db.participants.filter((p) => p.gathering_id === gid);
    const sets = this.db.settlements
      .filter((s) => s.gathering_id === gid)
      .map((s) => (includeReported && s.status === 'reported' ? { ...s, status: 'confirmed' as const } : s));
    return computeBalances(parts.map((p) => p.id), this.db.expenses.filter((e) => e.gathering_id === gid && !e.deleted_at), sets);
  }
  async reportSettlement(i: SettlementInput) {
    const me = this.me();
    await delay();
    const g = this.gathering(i.gathering_id);
    this.requireAccess(g.id);
    const dup = this.db.settlements.find((s) => s.client_ref === i.client_ref);
    if (dup) return dup.id;
    if (!Number.isSafeInteger(i.amount_cents) || i.amount_cents <= 0) fail('El importe debe ser mayor a cero');
    const f = this.db.participants.find((p) => p.id === i.from && p.gathering_id === g.id) ?? fail('Quien paga no participa de la juntada');
    const t = this.db.participants.find((p) => p.id === i.to && p.gathering_id === g.id) ?? fail('Quien cobra no participa de la juntada');
    if (f.id === t.id) fail('No podés pagarte a vos mismo');
    const admin = this.canManage(g.id);
    if (!(f.user_id === me || t.user_id === me || admin)) fail('Solo quien paga, quien cobra o un admin puede registrar este pago');
    const nets = this.nets(g.id, true);
    const fn = nets.find((b) => b.participantId === f.id)!.net;
    const tn = nets.find((b) => b.participantId === t.id)!.net;
    if (-fn < i.amount_cents) fail(`El pago supera lo que debe (pendiente: $ ${(Math.max(-fn, 0) / 100).toLocaleString('es-AR')})`);
    if (tn < i.amount_cents) fail(`El pago supera lo que le deben a quien cobra (pendiente: $ ${(Math.max(tn, 0) / 100).toLocaleString('es-AR')})`);
    const confirmed = t.user_id === me || (t.user_id === null && admin);
    const id = uuid();
    this.db.settlements.push({
      id, gathering_id: g.id, from_participant: f.id, to_participant: t.id, amount_cents: i.amount_cents, method: i.method,
      paid_on: i.paid_on, receipt_path: i.receipt_path ?? null, notes: i.notes ?? null, status: confirmed ? 'confirmed' : 'reported',
      created_by: me, created_at: now(), confirmed_by: confirmed ? me : null, confirmed_at: confirmed ? now() : null, client_ref: i.client_ref
    });
    this.audit(g.group_id, 'report', 'settlement', id);
    if (!confirmed && t.user_id) {
      this.notify(t.user_id, { group_id: g.group_id, gathering_id: g.id, kind: 'settlement_reported', title: '💸 Te informaron un pago',
        body: 'Revisá y confirmá si lo recibiste.', link: `/juntadas/${g.id}/cuentas`, dedupe_key: `settlement:${id}:reported` });
    } else if (confirmed && f.user_id && f.user_id !== me) {
      this.notify(f.user_id, { group_id: g.group_id, gathering_id: g.id, kind: 'settlement_confirmed', title: '✅ Pago confirmado',
        body: 'Se registró tu pago como recibido.', link: `/juntadas/${g.id}/cuentas`, dedupe_key: `settlement:${id}:confirmed` });
    }
    this.save();
    return id;
  }
  async reviewSettlement(id: string, accept: boolean) {
    const me = this.me();
    const s = this.db.settlements.find((x) => x.id === id) ?? fail('El pago no existe');
    if (s.status !== 'reported') fail('Este pago ya fue revisado');
    const f = this.db.participants.find((p) => p.id === s.from_participant)!;
    const t = this.db.participants.find((p) => p.id === s.to_participant)!;
    const g = this.gathering(s.gathering_id);
    if (!(t.user_id === me || (this.isAdmin(g.group_id) && f.user_id !== me))) fail('Solo quien recibe el pago o un admin puede confirmarlo');
    s.status = accept ? 'confirmed' : 'rejected';
    s.confirmed_by = me;
    s.confirmed_at = now();
    if (f.user_id) {
      this.notify(f.user_id, { group_id: g.group_id, gathering_id: g.id, kind: accept ? 'settlement_confirmed' : 'settlement_rejected',
        title: accept ? '✅ Confirmaron tu pago' : '⚠️ Rechazaron un pago informado', body: null,
        link: `/juntadas/${g.id}/cuentas`, dedupe_key: `settlement:${id}:reviewed` });
    }
    this.save();
  }

  // ------------------------------------------------------------------ votes
  async addDateOption(gatheringId: string, startsAt: string) {
    this.requireAccess(gatheringId);
    if (this.db.dateProposals.some((d) => d.gathering_id === gatheringId && d.starts_at === startsAt)) fail('Esa fecha ya está propuesta');
    this.db.dateProposals.push({ id: uuid(), gathering_id: gatheringId, starts_at: startsAt, created_by: this.me() });
    this.save();
  }
  async deleteDateOption(id: string) {
    const d = this.db.dateProposals.find((x) => x.id === id) ?? fail('La opción no existe');
    if (!(d.created_by === this.me() || this.canManage(d.gathering_id))) fail('No tenés permiso');
    this.db.dateProposals = this.db.dateProposals.filter((x) => x.id !== id);
    this.db.dateVotes = this.db.dateVotes.filter((v) => v.proposal_id !== id);
    this.save();
  }
  async voteDate(proposalId: string, vote: DateVote['vote'] | null) {
    const me = this.me();
    const d = this.db.dateProposals.find((x) => x.id === proposalId) ?? fail('La opción no existe');
    this.requireAccess(d.gathering_id);
    this.db.dateVotes = this.db.dateVotes.filter((v) => !(v.proposal_id === proposalId && v.user_id === me));
    if (vote) this.db.dateVotes.push({ proposal_id: proposalId, user_id: me, vote });
    this.save();
  }
  async confirmDate(proposalId: string) {
    const d = this.db.dateProposals.find((x) => x.id === proposalId) ?? fail('La opción de fecha no existe');
    if (!this.canManage(d.gathering_id)) fail('Solo el organizador o un admin puede confirmar la fecha');
    const g = this.gathering(d.gathering_id);
    if (!['proposed', 'confirmed'].includes(g.status)) fail('La juntada ya no admite cambios de fecha');
    g.starts_at = d.starts_at;
    g.status = 'confirmed';
    g.confirmed_at = now();
    this.notifyGroup(g.group_id, this.me(), {
      gathering_id: g.id, kind: 'gathering_confirmed', title: `🔥 Se confirmó: ${g.title}`, body: '¡Confirmá tu asistencia!',
      link: `/juntadas/${g.id}`, dedupe_key: `gathering:${g.id}:confirmed:${d.id}`
    });
    this.save();
  }
  async addMenuOption(gatheringId: string, kind: MenuKind, label: string) {
    this.requireAccess(gatheringId);
    if (!label.trim()) fail('Escribí la opción');
    this.db.menuProposals.push({ id: uuid(), gathering_id: gatheringId, kind, label: label.trim(), created_by: this.me() });
    this.save();
  }
  async addVenueOption(gatheringId: string, kind: VenueKind, label: string) {
    this.requireAccess(gatheringId);
    if (!label.trim()) fail('Escribí la opción');
    this.db.venueProposals.push({ id: uuid(), gathering_id: gatheringId, kind, label: label.trim(), created_by: this.me() });
    this.save();
  }
  async deleteOption(type: 'menu' | 'venue', id: string) {
    const list = type === 'menu' ? this.db.menuProposals : this.db.venueProposals;
    const o = list.find((x) => x.id === id) ?? fail('La opción no existe');
    if (!(o.created_by === this.me() || this.canManage(o.gathering_id))) fail('No tenés permiso');
    if (type === 'menu') {
      this.db.menuProposals = this.db.menuProposals.filter((x) => x.id !== id);
      this.db.menuVotes = this.db.menuVotes.filter((x) => x.proposal_id !== id);
    } else {
      this.db.venueProposals = this.db.venueProposals.filter((x) => x.id !== id);
      this.db.venueVotes = this.db.venueVotes.filter((x) => x.proposal_id !== id);
    }
    this.save();
  }
  async voteOption(type: 'menu' | 'venue', gatheringId: string, proposalId: string | null) {
    const me = this.me();
    this.requireAccess(gatheringId);
    const key = type === 'menu' ? 'menuVotes' : 'venueVotes';
    const props = type === 'menu' ? this.db.menuProposals : this.db.venueProposals;
    if (proposalId && !props.some((p) => p.id === proposalId && p.gathering_id === gatheringId)) fail('Opción inválida');
    this.db[key] = this.db[key].filter((v) => !(v.gathering_id === gatheringId && v.user_id === me));
    if (proposalId) this.db[key].push({ gathering_id: gatheringId, user_id: me, proposal_id: proposalId });
    this.save();
  }

  // ------------------------------------------------------------------ files
  async uploadFile(_bucket: FileBucket, _folder: string, file: Blob) {
    const dataUrl = await new Promise<string>((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result as string);
      r.onerror = () => rej(new Error('No se pudo leer el archivo'));
      r.readAsDataURL(file);
    });
    const files = JSON.parse(localStorage.getItem(DEMO_FILES_KEY) || '{}') as Record<string, string>;
    const path = `demo/${uuid()}`;
    files[path] = dataUrl;
    try {
      localStorage.setItem(DEMO_FILES_KEY, JSON.stringify(files));
    } catch {
      fail('No hay más espacio para archivos en la demo. Restaurá la demo desde Ajustes.');
    }
    return path;
  }
  async fileUrl(path: string) {
    if (/^(https?:|data:|blob:)/.test(path) || path.startsWith('demo-assets/')) return path.startsWith('demo-assets/') ? `${import.meta.env.BASE_URL}${path}` : path;
    const files = JSON.parse(localStorage.getItem(DEMO_FILES_KEY) || '{}') as Record<string, string>;
    return files[path] ?? null;
  }
  async addPhoto(gatheringId: string, path: string, caption: string | null) {
    this.requireAccess(gatheringId);
    this.db.photos.push({ id: uuid(), gathering_id: gatheringId, storage_path: path, caption, uploaded_by: this.me(), created_at: now() });
    this.save();
  }
  async deletePhoto(id: string) {
    const p = this.db.photos.find((x) => x.id === id) ?? fail('La foto no existe');
    if (!(p.uploaded_by === this.me() || this.canManage(p.gathering_id))) fail('No tenés permiso');
    this.db.photos = this.db.photos.filter((x) => x.id !== id);
    this.save();
  }

  // ---------------------------------------------------------- notifications
  async listNotifications() {
    const me = this.me();
    this.runReminders();
    return this.db.notifications.filter((n) => n.user_id === me).sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 100);
  }
  async markNotificationsRead(ids: string[] | 'all') {
    const me = this.me();
    this.db.notifications.filter((n) => n.user_id === me && !n.read_at && (ids === 'all' || ids.includes(n.id))).forEach((n) => (n.read_at = now()));
    this.save();
  }
  async savePushSubscription() {
    /* En la demo no hay servidor que envíe push. */
  }
  async deletePushSubscription() {}

  // --------------------------------------------------------------- realtime
  subscribeGroup(_groupId: string, onChange: () => void) {
    this.listeners.add(onChange);
    return () => void this.listeners.delete(onChange);
  }
  subscribeNotifications(_userId: string, onChange: () => void) {
    this.listeners.add(onChange);
    return () => void this.listeners.delete(onChange);
  }
}
