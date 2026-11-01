// Tipos que reflejan las tablas de Supabase (snake_case, igual que la base).
import type { SplitMethod } from './money';

export type Role = 'admin' | 'member';
export type GatheringStatus = 'proposed' | 'confirmed' | 'done' | 'cancelled';
export type Rsvp = 'pending' | 'yes' | 'maybe' | 'no';
export type VoteValue = 'yes' | 'maybe' | 'no';
export type SettlementStatus = 'reported' | 'confirmed' | 'rejected';
export type PayMethod = 'transferencia' | 'efectivo' | 'mercadopago' | 'otro';

export interface Profile {
  id: string;
  display_name: string;
  alias: string | null;
  avatar_url: string | null;
}

export interface Group {
  id: string;
  name: string;
  description: string | null;
  image_url: string | null;
  created_by: string | null;
  created_at: string;
}

export interface GroupSettings {
  group_id: string;
  reminder_days: number;
  reminders_enabled: boolean;
  last_reminder_at: string | null;
}

export interface GroupMember {
  group_id: string;
  user_id: string;
  role: Role;
  joined_at: string;
}

export interface Invitation {
  id: string;
  group_id: string;
  code: string;
  created_by: string | null;
  created_at: string;
  expires_at: string;
  max_uses: number | null;
  uses: number;
  revoked_at: string | null;
}

export interface Gathering {
  id: string;
  group_id: string;
  title: string;
  starts_at: string | null;
  location: string | null;
  description: string | null;
  notes: string | null;
  status: GatheringStatus;
  currency: string;
  created_by: string | null;
  created_at: string;
  confirmed_at: string | null;
}

export interface Participant {
  id: string;
  gathering_id: string;
  user_id: string | null;
  guest_name: string | null;
  rsvp: Rsvp;
  added_by: string | null;
}

export interface ExpensePayer {
  expense_id: string;
  participant_id: string;
  amount_cents: number;
}

export interface ExpenseSplit {
  expense_id: string;
  participant_id: string;
  share: number;
  amount_cents: number;
}

export type ExpenseCategory =
  | 'carne' | 'bebidas' | 'pan' | 'carbon' | 'hielo' | 'verduras' | 'postre' | 'salon' | 'descartables' | 'otros';

export interface Expense {
  id: string;
  gathering_id: string;
  description: string;
  category: ExpenseCategory;
  amount_cents: number;
  currency: string;
  split_method: SplitMethod;
  spent_on: string;
  receipt_path: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  payers: ExpensePayer[];
  splits: ExpenseSplit[];
}

export interface Settlement {
  id: string;
  gathering_id: string;
  from_participant: string;
  to_participant: string;
  amount_cents: number;
  method: PayMethod;
  paid_on: string;
  receipt_path: string | null;
  notes: string | null;
  status: SettlementStatus;
  created_by: string | null;
  created_at: string;
  confirmed_by: string | null;
  confirmed_at: string | null;
}

export interface DateProposal {
  id: string;
  gathering_id: string;
  starts_at: string;
  created_by: string | null;
}
export interface DateVote {
  proposal_id: string;
  user_id: string;
  vote: VoteValue;
}

export type MenuKind = 'asado' | 'pizza' | 'hamburguesas' | 'empanadas' | 'picada' | 'otro';
export type VenueKind = 'casa' | 'quincho' | 'restaurante' | 'otro';

export interface OptionProposal<K extends string = string> {
  id: string;
  gathering_id: string;
  kind: K;
  label: string;
  created_by: string | null;
}
export interface OptionVote {
  gathering_id: string;
  user_id: string;
  proposal_id: string;
}

export interface Photo {
  id: string;
  gathering_id: string;
  storage_path: string;
  caption: string | null;
  uploaded_by: string | null;
  created_at: string;
}

export interface AppNotification {
  id: string;
  user_id: string;
  group_id: string | null;
  gathering_id: string | null;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
}

/** Todo lo que se necesita para dibujar un grupo y sus juntadas. */
export interface GroupSnapshot {
  group: Group;
  settings: GroupSettings;
  members: GroupMember[];
  profiles: Record<string, Profile>;
  gatherings: Gathering[];
  participants: Participant[];
  expenses: Expense[];
  settlements: Settlement[];
  dateProposals: DateProposal[];
  dateVotes: DateVote[];
  menuProposals: OptionProposal<MenuKind>[];
  menuVotes: OptionVote[];
  venueProposals: OptionProposal<VenueKind>[];
  venueVotes: OptionVote[];
  photos: Photo[];
}

export interface GroupSummary {
  group: Group;
  role: Role;
  member_count: number;
}
