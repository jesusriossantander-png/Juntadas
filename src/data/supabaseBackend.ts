import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Backend, ExpenseInput, FileBucket, GatheringInput, SettlementInput, SessionUser } from './backend';
import type {
  AppNotification, DateProposal, DateVote, Expense, Gathering, GroupMember, GroupSettings, GroupSnapshot, GroupSummary,
  Invitation, OptionProposal, OptionVote, Participant, Photo, Profile, Settlement, MenuKind, VenueKind
} from '../lib/types';

function check<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

const uuid = () => crypto.randomUUID();

export class SupabaseBackend implements Backend {
  readonly mode = 'supabase' as const;
  private sb: SupabaseClient;
  private urlCache = new Map<string, { url: string; exp: number }>();

  constructor(url: string, anonKey: string, opts: { storageKey?: string } = {}) {
    this.sb = createClient(url, anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce', storageKey: opts.storageKey }
    });
  }

  private async uid(): Promise<string> {
    const u = await this.getUser();
    if (!u) throw new Error('Tenés que iniciar sesión');
    return u.id;
  }

  // ------------------------------------------------------------------ auth
  async getUser(): Promise<SessionUser | null> {
    const { data } = await this.sb.auth.getSession();
    const u = data.session?.user;
    return u ? { id: u.id, email: u.email ?? null } : null;
  }
  onAuthChange(cb: (u: SessionUser | null, event?: string) => void) {
    const { data } = this.sb.auth.onAuthStateChange((event, session) => {
      const u = session?.user;
      cb(u ? { id: u.id, email: u.email ?? null } : null, event);
    });
    return () => data.subscription.unsubscribe();
  }
  /** Las URLs de retorno van sin "#": Supabase agrega ?code=... y el cliente lo canjea al cargar. */
  private redirect(query = '') {
    return `${location.origin}${location.pathname}${query}`;
  }
  async signUp(email: string, password: string, displayName: string) {
    const { data, error } = await this.sb.auth.signUp({
      email, password, options: { data: { display_name: displayName }, emailRedirectTo: this.redirect() }
    });
    if (error) throw error;
    return { needsConfirmation: !data.session };
  }
  async signIn(email: string, password: string) {
    const { error } = await this.sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }
  async signOut() {
    await this.sb.auth.signOut();
  }
  async sendPasswordReset(email: string) {
    const { error } = await this.sb.auth.resetPasswordForEmail(email, { redirectTo: this.redirect('?reset=1') });
    if (error) throw error;
  }
  async updatePassword(password: string) {
    const { error } = await this.sb.auth.updateUser({ password });
    if (error) throw error;
  }

  // --------------------------------------------------------------- profile
  async getProfile(userId: string) {
    return check(await this.sb.from('profiles').select('id, display_name, alias, avatar_url').eq('id', userId).maybeSingle()) as Profile | null;
  }
  async updateProfile(patch: Partial<Pick<Profile, 'display_name' | 'alias' | 'avatar_url'>>) {
    const id = await this.uid();
    check(await this.sb.from('profiles').update(patch).eq('id', id));
  }

  // ---------------------------------------------------------------- groups
  async listGroups(): Promise<GroupSummary[]> {
    const id = await this.uid();
    const mine = check(await this.sb.from('group_members').select('role, groups(*)').eq('user_id', id)) as unknown as
      { role: GroupSummary['role']; groups: GroupSummary['group'] }[];
    const ids = mine.map((m) => m.groups.id);
    const counts = ids.length
      ? (check(await this.sb.from('group_members').select('group_id').in('group_id', ids)) as { group_id: string }[])
      : [];
    return mine
      .map((m) => ({ group: m.groups, role: m.role, member_count: counts.filter((c) => c.group_id === m.groups.id).length }))
      .sort((a, b) => a.group.name.localeCompare(b.group.name, 'es'));
  }

  async findGroupOfGathering(gatheringId: string) {
    const r = check(await this.sb.from('gatherings').select('group_id').eq('id', gatheringId).maybeSingle()) as { group_id: string } | null;
    return r?.group_id ?? null;
  }

  async getSnapshot(groupId: string): Promise<GroupSnapshot> {
    const [group, settings, members, gatheringsRaw] = await Promise.all([
      this.sb.from('groups').select('*').eq('id', groupId).single().then(check),
      this.sb.from('group_settings').select('*').eq('group_id', groupId).single().then(check),
      this.sb.from('group_members').select('*').eq('group_id', groupId).then(check),
      this.sb
        .from('gatherings')
        .select(`*, gathering_participants(*), expenses(*, expense_payers(*), expense_splits(*)), settlements(*),
                 date_proposals(*, date_votes(*)), menu_proposals(*), menu_votes(*), venue_proposals(*), venue_votes(*),
                 gathering_photos(*)`)
        .eq('group_id', groupId)
        .is('expenses.deleted_at', null)
        .order('starts_at', { ascending: false, nullsFirst: true })
        .then(check)
    ]);
    type Raw = Gathering & {
      gathering_participants: Participant[];
      expenses: (Omit<Expense, 'payers' | 'splits'> & { expense_payers: Expense['payers']; expense_splits: Expense['splits'] })[];
      settlements: Settlement[];
      date_proposals: (DateProposal & { date_votes: DateVote[] })[];
      menu_proposals: OptionProposal<MenuKind>[];
      menu_votes: OptionVote[];
      venue_proposals: OptionProposal<VenueKind>[];
      venue_votes: OptionVote[];
      gathering_photos: Photo[];
    };
    const raws = gatheringsRaw as unknown as Raw[];
    const snap: GroupSnapshot = {
      group: group as GroupSnapshot['group'],
      settings: settings as GroupSettings,
      members: members as GroupMember[],
      profiles: {},
      gatherings: [],
      participants: [],
      expenses: [],
      settlements: [],
      dateProposals: [],
      dateVotes: [],
      menuProposals: [],
      menuVotes: [],
      venueProposals: [],
      venueVotes: [],
      photos: []
    };
    for (const r of raws) {
      const {
        gathering_participants, expenses, settlements, date_proposals, menu_proposals, menu_votes, venue_proposals,
        venue_votes, gathering_photos, ...g
      } = r;
      snap.gatherings.push(g as Gathering);
      snap.participants.push(...gathering_participants);
      for (const e of expenses) {
        const { expense_payers, expense_splits, ...rest } = e;
        snap.expenses.push({
          ...rest,
          amount_cents: Number(rest.amount_cents),
          payers: expense_payers.map((p) => ({ ...p, amount_cents: Number(p.amount_cents) })),
          splits: expense_splits.map((s) => ({ ...s, amount_cents: Number(s.amount_cents), share: Number(s.share) }))
        });
      }
      snap.settlements.push(...settlements.map((s) => ({ ...s, amount_cents: Number(s.amount_cents) })));
      for (const d of date_proposals) {
        const { date_votes, ...p } = d;
        snap.dateProposals.push(p);
        snap.dateVotes.push(...date_votes);
      }
      snap.menuProposals.push(...menu_proposals);
      snap.menuVotes.push(...menu_votes);
      snap.venueProposals.push(...venue_proposals);
      snap.venueVotes.push(...venue_votes);
      snap.photos.push(...gathering_photos);
    }
    const ids = new Set<string>(snap.members.map((m) => m.user_id));
    snap.participants.forEach((p) => p.user_id && ids.add(p.user_id));
    if (ids.size) {
      const profs = check(await this.sb.from('profiles').select('id, display_name, alias, avatar_url').in('id', [...ids])) as Profile[];
      profs.forEach((p) => (snap.profiles[p.id] = p));
    }
    return snap;
  }

  async createGroup(name: string, description: string | null, imageUrl: string | null = null) {
    return check(await this.sb.rpc('create_group', { p_name: name, p_description: description, p_image_url: imageUrl })) as string;
  }
  async updateGroup(groupId: string, patch: { name?: string; description?: string | null; image_url?: string | null }) {
    const res = check(await this.sb.from('groups').update(patch).eq('id', groupId).select('id'));
    if (!res?.length) throw new Error('Solo un administrador puede editar el grupo');
  }
  async updateSettings(groupId: string, patch: Partial<Pick<GroupSettings, 'reminder_days' | 'reminders_enabled'>>) {
    const res = check(await this.sb.from('group_settings').update(patch).eq('group_id', groupId).select('group_id'));
    if (!res?.length) throw new Error('Solo un administrador puede cambiar la configuración');
  }
  async listInvitations(groupId: string) {
    return check(
      await this.sb.from('invitations').select('*').eq('group_id', groupId).order('created_at', { ascending: false })
    ) as Invitation[];
  }
  async createInvitation(groupId: string, days: number, maxUses: number | null) {
    const r = check(await this.sb.rpc('create_invitation', { p_group: groupId, p_days: days, p_max_uses: maxUses })) as
      { code: string; expires_at: string }[];
    return r[0];
  }
  async revokeInvitation(id: string) {
    check(await this.sb.from('invitations').update({ revoked_at: new Date().toISOString() }).eq('id', id));
  }
  async previewInvitation(code: string) {
    const r = check(await this.sb.rpc('invitation_preview', { p_code: code })) as
      { group_name: string | null; member_count: number; is_valid: boolean; already_member: boolean }[];
    return r[0] ?? { group_name: null, member_count: 0, is_valid: false, already_member: false };
  }
  async acceptInvitation(code: string) {
    return check(await this.sb.rpc('accept_invitation', { p_code: code })) as string;
  }
  async leaveGroup(groupId: string) {
    check(await this.sb.rpc('leave_group', { p_group: groupId }));
  }
  async removeMember(groupId: string, userId: string) {
    check(await this.sb.rpc('remove_member', { p_group: groupId, p_user: userId }));
  }
  async setMemberRole(groupId: string, userId: string, role: 'admin' | 'member') {
    check(await this.sb.rpc('set_member_role', { p_group: groupId, p_user: userId, p_role: role }));
  }

  // ------------------------------------------------------------ gatherings
  async createGathering(i: GatheringInput) {
    return check(
      await this.sb.rpc('create_gathering', {
        p_group: i.group_id, p_title: i.title, p_starts_at: i.starts_at, p_location: i.location,
        p_description: i.description, p_notes: i.notes, p_status: i.status, p_invite_all: i.invite_all,
        p_date_options: i.date_options.length ? i.date_options : null
      })
    ) as string;
  }
  async updateGathering(id: string, patch: Record<string, unknown>) {
    const res = check(await this.sb.from('gatherings').update(patch).eq('id', id).select('id'));
    if (!res?.length) throw new Error('Solo el organizador o un admin puede modificar la juntada');
  }
  async deleteGathering(id: string) {
    const res = check(await this.sb.from('gatherings').delete().eq('id', id).select('id'));
    if (!res?.length) throw new Error('Solo un administrador puede eliminar la juntada');
  }
  async addParticipant(gatheringId: string, who: { userId?: string; guestName?: string }) {
    return check(
      await this.sb.rpc('add_participant', { p_gathering: gatheringId, p_user: who.userId ?? null, p_guest_name: who.guestName ?? null })
    ) as string;
  }
  async removeParticipant(participantId: string) {
    check(await this.sb.rpc('remove_participant', { p_participant: participantId }));
  }
  async setRsvp(gatheringId: string, rsvp: Participant['rsvp']) {
    check(await this.sb.rpc('set_rsvp', { p_gathering: gatheringId, p_rsvp: rsvp }));
  }

  // -------------------------------------------------------------- money
  async saveExpense(input: ExpenseInput) {
    return check(await this.sb.rpc('save_expense', { p: input })) as string;
  }
  async deleteExpense(id: string) {
    check(await this.sb.rpc('delete_expense', { p_expense: id }));
  }
  async reportSettlement(i: SettlementInput) {
    return check(
      await this.sb.rpc('report_settlement', {
        p_gathering: i.gathering_id, p_from: i.from, p_to: i.to, p_amount_cents: i.amount_cents, p_method: i.method,
        p_paid_on: i.paid_on, p_notes: i.notes ?? null, p_receipt_path: i.receipt_path ?? null, p_client_ref: i.client_ref
      })
    ) as string;
  }
  async reviewSettlement(id: string, accept: boolean) {
    check(await this.sb.rpc('review_settlement', { p_settlement: id, p_accept: accept }));
  }

  // -------------------------------------------------------------- votes
  async addDateOption(gatheringId: string, startsAt: string) {
    const id = await this.uid();
    check(await this.sb.from('date_proposals').insert({ gathering_id: gatheringId, starts_at: startsAt, created_by: id }));
  }
  async deleteDateOption(id: string) {
    check(await this.sb.from('date_proposals').delete().eq('id', id));
  }
  async voteDate(proposalId: string, vote: DateVote['vote'] | null) {
    const id = await this.uid();
    if (vote === null) {
      check(await this.sb.from('date_votes').delete().eq('proposal_id', proposalId).eq('user_id', id));
    } else {
      check(await this.sb.from('date_votes').upsert({ proposal_id: proposalId, user_id: id, vote, updated_at: new Date().toISOString() }));
    }
  }
  async confirmDate(proposalId: string) {
    check(await this.sb.rpc('confirm_date', { p_proposal: proposalId }));
  }
  async addMenuOption(gatheringId: string, kind: MenuKind, label: string) {
    const id = await this.uid();
    check(await this.sb.from('menu_proposals').insert({ gathering_id: gatheringId, kind, label, created_by: id }));
  }
  async addVenueOption(gatheringId: string, kind: VenueKind, label: string) {
    const id = await this.uid();
    check(await this.sb.from('venue_proposals').insert({ gathering_id: gatheringId, kind, label, created_by: id }));
  }
  async deleteOption(type: 'menu' | 'venue', id: string) {
    check(await this.sb.from(`${type}_proposals`).delete().eq('id', id));
  }
  async voteOption(type: 'menu' | 'venue', gatheringId: string, proposalId: string | null) {
    const id = await this.uid();
    const table = `${type}_votes`;
    if (proposalId === null) {
      check(await this.sb.from(table).delete().eq('gathering_id', gatheringId).eq('user_id', id));
    } else {
      check(await this.sb.from(table).upsert({ gathering_id: gatheringId, user_id: id, proposal_id: proposalId, updated_at: new Date().toISOString() }));
    }
  }

  // -------------------------------------------------------------- files
  async uploadFile(bucket: FileBucket, folder: string, file: Blob) {
    const ext = file.type === 'application/pdf' ? 'pdf' : file.type === 'image/png' ? 'png' : 'jpg';
    const path = `${folder}/${uuid()}.${ext}`;
    check(await this.sb.storage.from(bucket).upload(path, file, { contentType: file.type, upsert: false }));
    return `${bucket}/${path}`;
  }
  async fileUrl(path: string) {
    if (/^(https?:|data:|blob:)/.test(path)) return path;
    const [bucket, ...rest] = path.split('/');
    const key = rest.join('/');
    if (bucket === 'avatars') return this.sb.storage.from(bucket).getPublicUrl(key).data.publicUrl;
    const cached = this.urlCache.get(path);
    if (cached && cached.exp > Date.now()) return cached.url;
    const { data, error } = await this.sb.storage.from(bucket).createSignedUrl(key, 3600);
    if (error || !data) return null;
    this.urlCache.set(path, { url: data.signedUrl, exp: Date.now() + 3_000_000 });
    return data.signedUrl;
  }
  async addPhoto(gatheringId: string, path: string, caption: string | null) {
    const id = await this.uid();
    check(await this.sb.from('gathering_photos').insert({ gathering_id: gatheringId, storage_path: path, caption, uploaded_by: id }));
  }
  async deletePhoto(id: string) {
    check(await this.sb.from('gathering_photos').delete().eq('id', id));
  }

  // ------------------------------------------------------ notifications
  async listNotifications() {
    return check(
      await this.sb.from('notifications').select('*').order('created_at', { ascending: false }).limit(100)
    ) as AppNotification[];
  }
  async markNotificationsRead(ids: string[] | 'all') {
    let q = this.sb.from('notifications').update({ read_at: new Date().toISOString() }).is('read_at', null);
    if (ids !== 'all') q = q.in('id', ids);
    check(await q);
  }
  async savePushSubscription(sub: PushSubscriptionJSON) {
    const id = await this.uid();
    await this.sb.from('push_subscriptions').delete().eq('endpoint', sub.endpoint!);
    check(
      await this.sb.from('push_subscriptions').insert({
        user_id: id, endpoint: sub.endpoint, p256dh: sub.keys?.p256dh, auth: sub.keys?.auth, user_agent: navigator.userAgent.slice(0, 200)
      })
    );
  }
  async deletePushSubscription(endpoint: string) {
    check(await this.sb.from('push_subscriptions').delete().eq('endpoint', endpoint));
  }

  // ----------------------------------------------------------- realtime
  subscribeGroup(groupId: string, onChange: () => void) {
    let t: ReturnType<typeof setTimeout> | undefined;
    const debounced = () => {
      clearTimeout(t);
      t = setTimeout(onChange, 250);
    };
    const ch = this.sb.channel(`group-${groupId}-${uuid()}`);
    // RLS filtra los eventos: solo llegan cambios de filas que el usuario puede ver.
    for (const table of ['gatherings', 'gathering_participants', 'expenses', 'expense_payers', 'expense_splits', 'settlements',
      'date_proposals', 'date_votes', 'menu_proposals', 'menu_votes', 'venue_proposals', 'venue_votes', 'group_members', 'gathering_photos']) {
      ch.on('postgres_changes', { event: '*', schema: 'public', table }, debounced);
    }
    ch.subscribe();
    return () => {
      clearTimeout(t);
      this.sb.removeChannel(ch);
    };
  }
  subscribeNotifications(userId: string, onChange: () => void) {
    const ch = this.sb
      .channel(`notif-${userId}-${uuid()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` }, onChange)
      .subscribe();
    return () => {
      this.sb.removeChannel(ch);
    };
  }
}
