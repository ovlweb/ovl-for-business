import {
  APPLICATION_STATUSES,
  APPLICATION_TYPES,
  CASH_METHODS,
  CASH_REQUEST_STATUSES,
  IDENTITY_STATUSES,
  INVOICE_INTERVALS,
  INVOICE_SCHEDULE_STATUSES,
  INVOICE_STATUSES,
  CHAT_TYPES,
  LEDGER_KINDS,
  LISTING_STATUSES,
  ORG_ROLES,
  PAYROLL_STATUSES,
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
  /** Identity documents checked by staff (KYC). */
  identityVerifiedAt: timestamp('identity_verified_at', { withTimezone: true }),
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

export const identityStatusEnum = pgEnum('identity_status', IDENTITY_STATUSES);

/** Identity checks (KYC). The document number itself is not kept: only its last four characters
 * and a keyed hash, so staff can spot one document used by several accounts. */
export const identityChecks = pgTable(
  'identity_checks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: identityStatusEnum('status').notNull().default('pending'),
    legalName: varchar('legal_name', { length: 120 }).notNull(),
    dateOfBirth: date('date_of_birth').notNull(),
    country: varchar('country', { length: 80 }).notNull(),
    documentType: varchar('document_type', { length: 24 }).notNull(),
    documentLast4: varchar('document_last4', { length: 4 }).notNull(),
    documentHash: varchar('document_hash', { length: 64 }).notNull(),
    rejectionReason: text('rejection_reason'),
    reviewedBy: uuid('reviewed_by').references(() => users.id),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('identity_checks_user_idx').on(t.userId), index('identity_checks_status_idx').on(t.status)],
);

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
    /** How it signed in: password (+ code), passkey or single sign-on. */
    method: varchar('method', { length: 16 }).notNull().default('password'),
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
  /** Verified business: set while the owner's identity is verified. */
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
  /** Payments of at least this much (base currency, minor units) need a second finance member. */
  approvalLimit: money('approval_limit'),
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
    /** Invoices can be paid in parts; `paidAt` is set once this reaches the total. */
    amountPaid: money('amount_paid')
      .notNull()
      .default(sql`0`),
    scheduleId: uuid('schedule_id'),
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

/** Monthly statement emails already sent (one per person and month, across all instances). */
export const statementNotices = pgTable(
  'statement_notices',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    month: char('month', { length: 7 }).notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.month] })],
);

export const invoicePayments = pgTable(
  'invoice_payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id),
    walletId: uuid('wallet_id')
      .notNull()
      .references(() => wallets.id),
    amount: money('amount').notNull(),
    paidBy: uuid('paid_by')
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index('invoice_payments_invoice_idx').on(t.invoiceId)],
);

export const invoiceScheduleStatusEnum = pgEnum('invoice_schedule_status', INVOICE_SCHEDULE_STATUSES);

/** Recurring invoices: the scheduler issues one every period from `startDate`. */
export const invoiceSchedules = pgTable(
  'invoice_schedules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
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
    interval: varchar('interval', { length: 16 }).$type<(typeof INVOICE_INTERVALS)[number]>().notNull(),
    dueDays: integer('due_days').notNull(),
    startDate: date('start_date').notNull(),
    endDate: date('end_date'),
    /** Periods since the start that are done (issued or skipped); the next run follows from it. */
    periods: integer('periods').notNull().default(0),
    nextRunOn: date('next_run_on'),
    status: invoiceScheduleStatusEnum('status').notNull().default('active'),
    invoiceCount: integer('invoice_count').notNull().default(0),
    lastInvoiceId: uuid('last_invoice_id'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index('invoice_schedules_due_idx').on(t.status, t.nextRunOn)],
);

export const payrollStatusEnum = pgEnum('payroll_status', PAYROLL_STATUSES);

/** A company paying many people at once from one balance. */
export const payrollRuns = pgTable(
  'payroll_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    walletId: uuid('wallet_id')
      .notNull()
      .references(() => wallets.id),
    currency: char('currency', { length: 3 }).notNull(),
    title: varchar('title', { length: 120 }).notNull(),
    total: money('total').notNull(),
    status: payrollStatusEnum('status').notNull(),
    items: jsonb('items').$type<{ userId: string; amount: string; note: string }[]>().notNull(),
    approvalId: uuid('approval_id'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
    paidAt: timestamp('paid_at', { withTimezone: true }),
  },
  (t) => [index('payroll_runs_org_idx').on(t.organizationId, t.createdAt)],
);

export const cashApprovalStatusEnum = pgEnum('cash_approval_status', ['pending', 'approved', 'rejected']);

/** Four eyes: a large cash operation (or request completion) waiting for a second manager. */
export const cashApprovals = pgTable(
  'cash_approvals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: varchar('kind', { length: 16 }).$type<'operation' | 'request'>().notNull(),
    cashRequestId: uuid('cash_request_id').references(() => cashRequests.id),
    walletId: uuid('wallet_id')
      .notNull()
      .references(() => wallets.id),
    type: cashTypeEnum('type').notNull(),
    method: cashMethodEnum('method').notNull(),
    amount: money('amount').notNull(),
    currency: char('currency', { length: 3 }).notNull(),
    reference: varchar('reference', { length: 128 }).notNull(),
    note: text('note').notNull().default(''),
    status: cashApprovalStatusEnum('status').notNull().default('pending'),
    requestedBy: uuid('requested_by')
      .notNull()
      .references(() => users.id),
    decidedBy: uuid('decided_by').references(() => users.id),
    rejectReason: text('reject_reason'),
    cashOperationId: uuid('cash_operation_id').references(() => cashOperations.id),
    createdAt: createdAt(),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
  },
  (t) => [index('cash_approvals_status_idx').on(t.status, t.createdAt)],
);

/** Platform-wide settings edited in the admin panel (exchange fee, governance…). */
export const platformSettings = pgTable('platform_settings', {
  key: varchar('key', { length: 64 }).primaryKey(),
  value: jsonb('value').$type<Record<string, unknown>>().notNull(),
  updatedBy: uuid('updated_by').references(() => users.id),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Managed exchange rates: what one unit of `currency` is worth in the base currency. */
export const exchangeRates = pgTable('exchange_rates', {
  currency: char('currency', { length: 3 }).primaryKey(),
  rate: varchar('rate', { length: 32 }).notNull(),
  updatedBy: uuid('updated_by').references(() => users.id),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const exchanges = pgTable(
  'exchanges',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => users.id),
    fromWalletId: uuid('from_wallet_id')
      .notNull()
      .references(() => wallets.id),
    toWalletId: uuid('to_wallet_id')
      .notNull()
      .references(() => wallets.id),
    fromAmount: money('from_amount').notNull(),
    toAmount: money('to_amount').notNull(),
    fee: money('fee').notNull(),
    rate: varchar('rate', { length: 32 }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('exchanges_from_idx').on(t.fromWalletId)],
);

/** Multi-signature: a company payment above its approval limit, waiting for a second member. */
export const paymentApprovals = pgTable(
  'payment_approvals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    walletId: uuid('wallet_id')
      .notNull()
      .references(() => wallets.id),
    kind: varchar('kind', { length: 16 }).$type<'transfer' | 'invoice' | 'exchange' | 'payroll'>().notNull(),
    action: jsonb('action').$type<Record<string, unknown>>().notNull(),
    amount: money('amount').notNull(),
    currency: char('currency', { length: 3 }).notNull(),
    description: text('description').notNull(),
    status: cashApprovalStatusEnum('status').notNull().default('pending'),
    requestedBy: uuid('requested_by')
      .notNull()
      .references(() => users.id),
    decidedBy: uuid('decided_by').references(() => users.id),
    reason: text('reason'),
    createdAt: createdAt(),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
  },
  (t) => [index('payment_approvals_org_idx').on(t.organizationId, t.status)],
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
    /** Licences run for a term (LICENSE_TERM_MONTHS); null never expires. */
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    /** Expiry reminders sent for the current term: 0 none, 1 the 30-day one, 2 the 7-day one. */
    reminderStage: integer('reminder_stage').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('registry_kind_idx').on(t.kind, t.status),
    index('registry_expiry_idx').on(t.status, t.expiresAt),
    index('registry_title_idx').on(sql`lower(${t.title})`),
  ],
);

export const webhookEndpoints = pgTable('webhook_endpoints', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  url: text('url').notNull(),
  description: varchar('description', { length: 200 }).notNull().default(''),
  events: text('events').array().notNull(),
  /** Sealed with the server secret (it signs deliveries, so it cannot be a hash). */
  secret: text('secret').notNull(),
  active: boolean('active').notNull().default(true),
  failures: integer('failures').notNull().default(0),
  disabledReason: text('disabled_reason'),
  lastDeliveryAt: timestamp('last_delivery_at', { withTimezone: true }),
  createdAt: createdAt(),
});

/** Something happened (a registry entry changed…): one row, delivered to every subscribed endpoint. */
export const webhookEvents = pgTable('webhook_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  type: varchar('type', { length: 40 }).notNull(),
  data: jsonb('data').$type<Record<string, unknown>>().notNull(),
  createdAt: createdAt(),
});

export const webhookDeliveries = pgTable(
  'webhook_deliveries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => webhookEvents.id, { onDelete: 'cascade' }),
    endpointId: uuid('endpoint_id')
      .notNull()
      .references(() => webhookEndpoints.id, { onDelete: 'cascade' }),
    status: varchar('status', { length: 16 })
      .$type<'pending' | 'delivered' | 'failed'>()
      .notNull()
      .default('pending'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    /** A worker holds the delivery while it sends it (so two never send it at once). */
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    responseStatus: integer('response_status'),
    error: text('error'),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index('webhook_deliveries_due_idx').on(t.status, t.nextAttemptAt),
    index('webhook_deliveries_endpoint_idx').on(t.endpointId, t.createdAt),
  ],
);

/** A currency issued by a virtual country (one per country); its holder issues and redeems it. */
export const virtualCurrencies = pgTable('virtual_currencies', {
  code: char('code', { length: 3 }).primaryKey(),
  name: varchar('name', { length: 64 }).notNull(),
  decimals: integer('decimals').notNull(),
  registryEntryId: uuid('registry_entry_id')
    .notNull()
    .unique()
    .references(() => registryEntries.id),
  status: varchar('status', { length: 16 }).$type<'active' | 'suspended'>().notNull().default('active'),
  /** Issued minus redeemed, in minor units. */
  supply: money('supply')
    .notNull()
    .default(sql`0`),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id),
  createdAt: createdAt(),
});

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

/** Who holds how many shares (investments, then trades on the secondary market). */
export const shareholdings = pgTable(
  'shareholdings',
  {
    listingId: uuid('listing_id')
      .notNull()
      .references(() => stockListings.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    shares: bigint('shares', { mode: 'bigint' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.listingId, t.userId] }),
    check('shareholdings_non_negative', sql`${t.shares} >= 0`),
  ],
);

export const orderSideEnum = pgEnum('order_side', ['buy', 'sell']);
export const orderStatusEnum = pgEnum('order_status', ['open', 'filled', 'cancelled']);

/** Limit orders on the secondary market; a buy order holds its money meanwhile. */
export const stockOrders = pgTable(
  'stock_orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    listingId: uuid('listing_id')
      .notNull()
      .references(() => stockListings.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    walletId: uuid('wallet_id')
      .notNull()
      .references(() => wallets.id),
    side: orderSideEnum('side').notNull(),
    price: money('price').notNull(),
    shares: bigint('shares', { mode: 'bigint' }).notNull(),
    filled: bigint('filled', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    status: orderStatusEnum('status').notNull().default('open'),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('stock_orders_book_idx').on(t.listingId, t.side, t.status, t.price, t.createdAt),
    index('stock_orders_user_idx').on(t.userId, t.createdAt),
    check('stock_orders_filled', sql`${t.filled} between 0 and ${t.shares}`),
  ],
);

export const stockTrades = pgTable(
  'stock_trades',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    listingId: uuid('listing_id')
      .notNull()
      .references(() => stockListings.id),
    buyOrderId: uuid('buy_order_id')
      .notNull()
      .references(() => stockOrders.id),
    sellOrderId: uuid('sell_order_id')
      .notNull()
      .references(() => stockOrders.id),
    buyerId: uuid('buyer_id')
      .notNull()
      .references(() => users.id),
    sellerId: uuid('seller_id')
      .notNull()
      .references(() => users.id),
    takerSide: orderSideEnum('taker_side').notNull(),
    price: money('price').notNull(),
    shares: bigint('shares', { mode: 'bigint' }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('stock_trades_listing_idx').on(t.listingId, t.createdAt)],
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
