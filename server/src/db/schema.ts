import {
  APPLICATION_STATUSES,
  APPLICATION_TYPES,
  CASH_METHODS,
  CASH_REQUEST_STATUSES,
  INVOICE_STATUSES,
  CHAT_TYPES,
  LEDGER_KINDS,
  LISTING_STATUSES,
  ORG_ROLES,
  REGISTRY_KINDS,
  REGISTRY_STATUSES,
  ROLES,
} from '@ovl/shared';
import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  boolean,
  char,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const money = (name: string) => bigint(name, { mode: 'bigint' });

export const roleEnum = pgEnum('role', ROLES);
export const accountStatusEnum = pgEnum('account_status', ['active', 'suspended']);
export const orgRoleEnum = pgEnum('org_role', ORG_ROLES);
export const walletOwnerEnum = pgEnum('wallet_owner', ['user', 'organization']);
export const ledgerKindEnum = pgEnum('ledger_kind', LEDGER_KINDS);
export const cashTypeEnum = pgEnum('cash_type', ['deposit', 'withdrawal']);
export const cashMethodEnum = pgEnum('cash_method', CASH_METHODS);
export const applicationTypeEnum = pgEnum('application_type', APPLICATION_TYPES);
export const applicationStatusEnum = pgEnum('application_status', APPLICATION_STATUSES);
export const reviewDecisionEnum = pgEnum('review_decision', ['approve', 'reject', 'request_changes']);
export const registryKindEnum = pgEnum('registry_kind', REGISTRY_KINDS);
export const registryStatusEnum = pgEnum('registry_status', REGISTRY_STATUSES);
export const listingStatusEnum = pgEnum('listing_status', LISTING_STATUSES);
export const chatTypeEnum = pgEnum('chat_type', CHAT_TYPES);
export const chatMemberRoleEnum = pgEnum('chat_member_role', ['owner', 'admin', 'member']);
export const supportStatusEnum = pgEnum('support_status', ['open', 'closed']);
export const messageKindEnum = pgEnum('message_kind', ['text', 'system']);

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  username: varchar('username', { length: 32 }).notNull().unique(),
  email: varchar('email', { length: 254 }).notNull().unique(),
  displayName: varchar('display_name', { length: 64 }).notNull(),
  passwordHash: text('password_hash').notNull(),
  role: roleEnum('role').notNull().default('user'),
  status: accountStatusEnum('status').notNull().default('active'),
  bio: text('bio').notNull().default(''),
  avatarUrl: text('avatar_url'),
  preferences: jsonb('preferences').$type<Record<string, unknown>>().notNull().default({}),
  // Two-factor authentication (TOTP). Secrets are sealed with AES-GCM (see lib/totp.ts).
  totpSecret: text('totp_secret'),
  totpPendingSecret: text('totp_pending_secret'),
  totpEnabledAt: timestamp('totp_enabled_at', { withTimezone: true }),
  /** Last accepted time step: a code cannot be used twice. */
  totpLastStep: integer('totp_last_step'),
  emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
  createdAt: createdAt(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
});

/** WebAuthn credentials ("passkeys") for signing in without a password. */
export const passkeys = pgTable(
  'passkeys',
  {
    /** The credential ID (base64url), as the browser reports it. */
    id: text('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 64 }).notNull(),
    publicKey: text('public_key').notNull(),
    counter: bigint('counter', { mode: 'number' }).notNull().default(0),
    transports: jsonb('transports').$type<string[]>().notNull().default([]),
    backedUp: boolean('backed_up').notNull().default(false),
    createdAt: createdAt(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  },
  (t) => [index('passkeys_user_idx').on(t.userId)],
);

/** Pending WebAuthn challenges (a few minutes each). */
export const webauthnChallenges = pgTable('webauthn_challenges', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  purpose: varchar('purpose', { length: 16 }).notNull(),
  challenge: text('challenge').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
});

export const emailTokenPurposeEnum = pgEnum('email_token_purpose', ['verify_email', 'reset_password']);

/** Links sent by email (confirm the address, reset the password). Only hashes are stored. */
export const emailTokens = pgTable(
  'email_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    purpose: emailTokenPurposeEnum('purpose').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    /** The address the link was sent to: a link stops working if the email changes. */
    email: varchar('email', { length: 254 }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('email_tokens_user_idx').on(t.userId, t.purpose)],
);

/** One-time codes for signing in without the authenticator. Only hashes are stored. */
export const recoveryCodes = pgTable(
  'recovery_codes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    codeHash: text('code_hash').notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('recovery_codes_user_idx').on(t.userId)],
);

/** A signed-in device. Refresh tokens rotate inside it; signing it out revokes all of them. */
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    userAgent: text('user_agent'),
    ip: text('ip'),
    createdAt: createdAt(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    sessionId: uuid('session_id').references(() => sessions.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [index('refresh_tokens_user_idx').on(t.userId), index('refresh_tokens_session_idx').on(t.sessionId)],
);

export const contacts = pgTable(
  'contacts',
  {
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    contactId: uuid('contact_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.ownerId, t.contactId] })],
);

// ---------------------------------------------------------------------------
// Organizations
// ---------------------------------------------------------------------------

export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 120 }).notNull(),
  slug: varchar('slug', { length: 64 }).notNull().unique(),
  description: text('description').notNull().default(''),
  website: text('website'),
  country: varchar('country', { length: 120 }),
  baseCurrency: char('base_currency', { length: 3 }).notNull(),
  status: accountStatusEnum('status').notNull().default('active'),
  ownerId: uuid('owner_id')
    .notNull()
    .references(() => users.id),
  registryNumber: varchar('registry_number', { length: 32 }),
  applicationId: uuid('application_id'),
  createdAt: createdAt(),
});

export const organizationMembers = pgTable(
  'organization_members',
  {
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: orgRoleEnum('role').notNull().default('member'),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.userId] }), index('org_members_user_idx').on(t.userId)],
);

// ---------------------------------------------------------------------------
// Money: wallets, immutable ledger, cash desk, fund locks
// ---------------------------------------------------------------------------

export const wallets = pgTable(
  'wallets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerType: walletOwnerEnum('owner_type').notNull(),
    userId: uuid('user_id').references(() => users.id),
    organizationId: uuid('organization_id').references(() => organizations.id),
    currency: char('currency', { length: 3 }).notNull(),
    balance: money('balance')
      .notNull()
      .default(sql`0`),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('wallets_user_currency_uq').on(t.userId, t.currency),
    uniqueIndex('wallets_org_currency_uq').on(t.organizationId, t.currency),
    check('wallets_balance_non_negative', sql`${t.balance} >= 0`),
    check('wallets_single_owner', sql`(${t.userId} is null) <> (${t.organizationId} is null)`),
  ],
);

export const ledgerEntries = pgTable(
  'ledger_entries',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    walletId: uuid('wallet_id')
      .notNull()
      .references(() => wallets.id),
    amount: money('amount').notNull(),
    balanceAfter: money('balance_after').notNull(),
    kind: ledgerKindEnum('kind').notNull(),
    description: text('description').notNull().default(''),
    counterpartyWalletId: uuid('counterparty_wallet_id'),
    referenceType: varchar('reference_type', { length: 32 }),
    referenceId: text('reference_id'),
    actorId: uuid('actor_id'),
    createdAt: createdAt(),
  },
  (t) => [index('ledger_wallet_idx').on(t.walletId, t.id)],
);

export const cashOperations = pgTable(
  'cash_operations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    walletId: uuid('wallet_id')
      .notNull()
      .references(() => wallets.id),
    type: cashTypeEnum('type').notNull(),
    method: cashMethodEnum('method').notNull(),
    amount: money('amount').notNull(),
    currency: char('currency', { length: 3 }).notNull(),
    reference: varchar('reference', { length: 128 }).notNull(),
    note: text('note').notNull().default(''),
    processedBy: uuid('processed_by')
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index('cash_operations_created_idx').on(t.createdAt)],
);

export const cashRequestStatusEnum = pgEnum('cash_request_status', CASH_REQUEST_STATUSES);

/** A person's request for a deposit or a payout, fulfilled by a finance manager. */
export const cashRequests = pgTable(
  'cash_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    walletId: uuid('wallet_id')
      .notNull()
      .references(() => wallets.id),
    type: cashTypeEnum('type').notNull(),
    method: cashMethodEnum('method').notNull(),
    amount: money('amount').notNull(),
    currency: char('currency', { length: 3 }).notNull(),
    note: text('note').notNull().default(''),
    status: cashRequestStatusEnum('status').notNull().default('pending'),
    requestedBy: uuid('requested_by')
      .notNull()
      .references(() => users.id),
    handledBy: uuid('handled_by').references(() => users.id),
    cashOperationId: uuid('cash_operation_id').references(() => cashOperations.id),
    declineReason: text('decline_reason'),
    createdAt: createdAt(),
    handledAt: timestamp('handled_at', { withTimezone: true }),
  },
  (t) => [
    index('cash_requests_status_idx').on(t.status, t.createdAt),
    index('cash_requests_wallet_idx').on(t.walletId),
  ],
);

export const invoiceStatusEnum = pgEnum('invoice_status', INVOICE_STATUSES);

/** One line of an invoice; the unit price is in minor units (as a string, since jsonb has no bigint). */
export interface InvoiceItemRow {
  description: string;
  quantity: number;
  unitPrice: string;
}

/** An invoice from a person or company to another; paid from one of the recipient's balances. */
export const invoices = pgTable(
  'invoices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    number: varchar('number', { length: 32 }).notNull(),
    issuerType: walletOwnerEnum('issuer_type').notNull(),
    issuerUserId: uuid('issuer_user_id').references(() => users.id),
    issuerOrgId: uuid('issuer_org_id').references(() => organizations.id),
    recipientType: walletOwnerEnum('recipient_type').notNull(),
    recipientUserId: uuid('recipient_user_id').references(() => users.id),
    recipientOrgId: uuid('recipient_org_id').references(() => organizations.id),
    currency: char('currency', { length: 3 }).notNull(),
    items: jsonb('items').$type<InvoiceItemRow[]>().notNull(),
    total: money('total').notNull(),
    note: text('note').notNull().default(''),
    dueDate: date('due_date').notNull(),
    status: invoiceStatusEnum('status').notNull().default('open'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    paidBy: uuid('paid_by').references(() => users.id),
    paidFromWalletId: uuid('paid_from_wallet_id').references(() => wallets.id),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelReason: text('cancel_reason'),
  },
  (t) => [
    uniqueIndex('invoices_issuer_user_number_uq').on(t.issuerUserId, t.number),
    uniqueIndex('invoices_issuer_org_number_uq').on(t.issuerOrgId, t.number),
    index('invoices_recipient_user_idx').on(t.recipientUserId, t.createdAt),
    index('invoices_recipient_org_idx').on(t.recipientOrgId, t.createdAt),
    check('invoices_single_issuer', sql`(${t.issuerUserId} is null) <> (${t.issuerOrgId} is null)`),
    check('invoices_single_recipient', sql`(${t.recipientUserId} is null) <> (${t.recipientOrgId} is null)`),
    check('invoices_total_positive', sql`${t.total} > 0`),
  ],
);

export const fundLocks = pgTable(
  'fund_locks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    walletId: uuid('wallet_id')
      .notNull()
      .references(() => wallets.id),
    amount: money('amount').notNull(),
    reason: varchar('reason', { length: 32 }).notNull(),
    referenceId: uuid('reference_id'),
    unlocksAt: timestamp('unlocks_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('fund_locks_wallet_idx').on(t.walletId, t.unlocksAt)],
);

// ---------------------------------------------------------------------------
// Applications (registration suggestions) and reviews
// ---------------------------------------------------------------------------

export const applications = pgTable(
  'applications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    type: applicationTypeEnum('type').notNull(),
    applicantId: uuid('applicant_id')
      .notNull()
      .references(() => users.id),
    status: applicationStatusEnum('status').notNull().default('pending'),
    stageIndex: integer('stage_index').notNull().default(0),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    result: jsonb('result').$type<Record<string, unknown>>(),
    rejectionReason: text('rejection_reason'),
    /** Bumped each time the applicant resubmits after "request changes"; reviews count per round. */
    round: integer('round').notNull().default(1),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
  },
  (t) => [
    index('applications_status_idx').on(t.status, t.type),
    index('applications_applicant_idx').on(t.applicantId),
  ],
);

export const applicationReviews = pgTable(
  'application_reviews',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    applicationId: uuid('application_id')
      .notNull()
      .references(() => applications.id, { onDelete: 'cascade' }),
    stageKey: varchar('stage_key', { length: 32 }).notNull(),
    reviewerId: uuid('reviewer_id')
      .notNull()
      .references(() => users.id),
    reviewerRole: roleEnum('reviewer_role').notNull(),
    decision: reviewDecisionEnum('decision').notNull(),
    comment: text('comment').notNull().default(''),
    checklist: jsonb('checklist').$type<string[]>(),
    round: integer('round').notNull().default(1),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('application_reviews_once_uq').on(t.applicationId, t.stageKey, t.reviewerId, t.round)],
);

/**
 * Uploaded files. A file starts private to its uploader and is attached to something (an
 * application, a chat message…) through `scope` + `scopeId`, which decides who may read it.
 */
export const files = pgTable(
  'files',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id),
    storageKey: text('storage_key').notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    contentType: varchar('content_type', { length: 127 }).notNull(),
    size: integer('size').notNull(),
    sha256: varchar('sha256', { length: 64 }).notNull(),
    scope: varchar('scope', { length: 24 }),
    scopeId: uuid('scope_id'),
    createdAt: createdAt(),
  },
  (t) => [index('files_scope_idx').on(t.scope, t.scopeId), index('files_owner_idx').on(t.ownerId)],
);

// ---------------------------------------------------------------------------
// Public registry
// ---------------------------------------------------------------------------

export const registryCounters = pgTable('registry_counters', {
  kind: varchar('kind', { length: 32 }).primaryKey(),
  value: bigint('value', { mode: 'number' }).notNull(),
});

export const registryEntries = pgTable(
  'registry_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    number: varchar('number', { length: 32 }).notNull().unique(),
    kind: registryKindEnum('kind').notNull(),
    licenseType: varchar('license_type', { length: 32 }),
    title: varchar('title', { length: 200 }).notNull(),
    description: text('description').notNull().default(''),
    website: text('website'),
    holderUserId: uuid('holder_user_id').references(() => users.id),
    holderOrganizationId: uuid('holder_organization_id').references(() => organizations.id),
    status: registryStatusEnum('status').notNull().default('active'),
    applicationId: uuid('application_id'),
    data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
    issuedAt: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('registry_kind_idx').on(t.kind, t.status),
    index('registry_title_idx').on(sql`lower(${t.title})`),
  ],
);

// ---------------------------------------------------------------------------
// Developer API keys (public registry / stock API)
// ---------------------------------------------------------------------------

export const apiKeys = pgTable('api_keys', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 64 }).notNull(),
  prefix: varchar('prefix', { length: 16 }).notNull(),
  keyHash: text('key_hash').notNull().unique(),
  scopes: text('scopes').array().notNull(),
  createdAt: createdAt(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
});

// ---------------------------------------------------------------------------
// Stock exchange
// ---------------------------------------------------------------------------

export const stockListings = pgTable(
  'stock_listings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .unique()
      .references(() => organizations.id),
    ticker: varchar('ticker', { length: 8 }).notNull().unique(),
    currency: char('currency', { length: 3 }).notNull(),
    sharePrice: money('share_price').notNull(),
    totalShares: bigint('total_shares', { mode: 'bigint' }).notNull(),
    sharesSold: bigint('shares_sold', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    /** Frozen share of each investment in basis points (3000 = 30%). */
    freezeBps: integer('freeze_bps').notNull(),
    lockDays: integer('lock_days').notNull(),
    status: listingStatusEnum('status').notNull().default('active'),
    listedAt: timestamp('listed_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check('stock_listings_shares_sold', sql`${t.sharesSold} between 0 and ${t.totalShares}`)],
);

export const stockPriceHistory = pgTable(
  'stock_price_history',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    listingId: uuid('listing_id')
      .notNull()
      .references(() => stockListings.id, { onDelete: 'cascade' }),
    price: money('price').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('price_history_listing_idx').on(t.listingId, t.createdAt)],
);

export const investments = pgTable(
  'investments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    listingId: uuid('listing_id')
      .notNull()
      .references(() => stockListings.id),
    investorId: uuid('investor_id')
      .notNull()
      .references(() => users.id),
    fromWalletId: uuid('from_wallet_id')
      .notNull()
      .references(() => wallets.id),
    amount: money('amount').notNull(),
    shares: bigint('shares', { mode: 'bigint' }).notNull(),
    frozenAmount: money('frozen_amount').notNull(),
    unlocksAt: timestamp('unlocks_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('investments_listing_idx').on(t.listingId),
    index('investments_investor_idx').on(t.investorId),
  ],
);

// ---------------------------------------------------------------------------
// Chats: direct, groups, news channels, tech support, council & moderation
// ---------------------------------------------------------------------------

export const chats = pgTable(
  'chats',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    type: chatTypeEnum('type').notNull(),
    title: varchar('title', { length: 128 }).notNull().default(''),
    description: text('description').notNull().default(''),
    ownerId: uuid('owner_id').references(() => users.id),
    /** "<smaller user id>:<bigger user id>" for direct chats. */
    directKey: varchar('direct_key', { length: 80 }).unique(),
    /** Public handle of news channels. */
    handle: varchar('handle', { length: 32 }).unique(),
    isPublic: boolean('is_public').notNull().default(false),
    supportStatus: supportStatusEnum('support_status'),
    createdAt: createdAt(),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }),
  },
  (t) => [index('chats_type_idx').on(t.type)],
);

export const chatMembers = pgTable(
  'chat_members',
  {
    chatId: uuid('chat_id')
      .notNull()
      .references(() => chats.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: chatMemberRoleEnum('role').notNull().default('member'),
    pinned: boolean('pinned').notNull().default(false),
    lastReadMessageId: bigint('last_read_message_id', { mode: 'number' }).notNull().default(0),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.chatId, t.userId] }), index('chat_members_user_idx').on(t.userId)],
);

export const messages = pgTable(
  'messages',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    chatId: uuid('chat_id')
      .notNull()
      .references(() => chats.id, { onDelete: 'cascade' }),
    senderId: uuid('sender_id').references(() => users.id),
    kind: messageKindEnum('kind').notNull().default('text'),
    body: text('body').notNull(),
    meta: jsonb('meta').$type<Record<string, unknown>>().notNull().default({}),
    replyToId: bigint('reply_to_id', { mode: 'number' }),
    editedAt: timestamp('edited_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('messages_chat_idx').on(t.chatId, t.id)],
);

// ---------------------------------------------------------------------------
// Service stories
// ---------------------------------------------------------------------------

export const stories = pgTable(
  'stories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id),
    text: varchar('text', { length: 500 }).notNull(),
    mediaUrl: text('media_url'),
    linkUrl: text('link_url'),
    background: varchar('background', { length: 16 }).notNull(),
    createdAt: createdAt(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [index('stories_expires_idx').on(t.expiresAt)],
);

export const storyViews = pgTable(
  'story_views',
  {
    storyId: uuid('story_id')
      .notNull()
      .references(() => stories.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    viewedAt: timestamp('viewed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.storyId, t.userId] })],
);

// ---------------------------------------------------------------------------
// Audit log of every privileged action
// ---------------------------------------------------------------------------

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    actorId: uuid('actor_id'),
    action: varchar('action', { length: 64 }).notNull(),
    targetType: varchar('target_type', { length: 32 }),
    targetId: text('target_id'),
    data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
    ip: varchar('ip', { length: 64 }),
    createdAt: createdAt(),
  },
  (t) => [index('audit_logs_created_idx').on(t.createdAt)],
);
