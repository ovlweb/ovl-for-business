/**
 * Request / response schemas of the public HTTP API (v1).
 * The server validates against these, the SDK and every client derive their types from them,
 * and the OpenAPI document at /api/docs is generated from them.
 */
import { z } from 'zod';
import { BADGES, ROLES } from './roles';
import { THEME_IDS } from './themes';
import {
  APPLICATION_STATUSES,
  APPLICATION_TYPES,
  LICENSE_TYPES,
  currencyCodeSchema,
  decimalAmountSchema,
  handleSchema,
} from './workflows';

const isoDate = z.string().describe('ISO 8601 timestamp');
const uuid = z.uuid();

export const roleSchema = z.enum(ROLES);
export const badgeSchema = z.enum(BADGES);

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z][a-z0-9_]{2,31}$/, '3-32 characters: letters, digits and underscore, starting with a letter');

export const paginationQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export function pageOf<T extends z.ZodType>(item: T) {
  return z.object({
    items: z.array(item),
    total: z.number().int(),
    limit: z.number().int(),
    offset: z.number().int(),
  });
}

export const errorSchema = z.object({
  error: z.string(),
  message: z.string(),
  details: z.unknown().optional(),
});

// ---------------------------------------------------------------------------
// Users & auth
// ---------------------------------------------------------------------------

export const userSummarySchema = z.object({
  id: uuid,
  username: z.string(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
  role: roleSchema,
  badges: z.array(badgeSchema),
});
export type UserSummary = z.infer<typeof userSummarySchema>;

export const userProfileSchema = userSummarySchema.extend({
  bio: z.string(),
  createdAt: isoDate,
  isContact: z.boolean(),
});
export type UserProfile = z.infer<typeof userProfileSchema>;

/** What the user wants to do on the platform (asked during onboarding). */
export const GOALS = ['company', 'invest', 'license', 'chat', 'channel', 'staff'] as const;

/** Per-account settings synced across the web client, the admin panel and the native apps. */
export const preferencesSchema = z.object({
  theme: z
    .string()
    .refine((t) => t === 'system' || THEME_IDS.includes(t), 'Unknown theme')
    .optional(),
  onboardingCompleted: z.boolean().optional(),
  goals: z.array(z.enum(GOALS)).max(GOALS.length).optional(),
  compactSidebar: z.boolean().optional(),
  /** Email a PDF statement of every balance at the start of each month. */
  statementEmails: z.boolean().optional(),
});
export type Preferences = z.infer<typeof preferencesSchema>;

export const meSchema = userSummarySchema.extend({
  email: z.string(),
  bio: z.string(),
  status: z.enum(['active', 'suspended']),
  permissions: z.array(z.string()),
  preferences: preferencesSchema,
  twoFactorEnabled: z.boolean(),
  emailVerified: z.boolean(),
  identityVerified: z.boolean().describe('Identity documents checked by staff (KYC)'),
  strongSession: z
    .boolean()
    .optional()
    .describe('On /me and sign-in answers: signed in with a passkey or single sign-on (counts as two-step)'),
  createdAt: isoDate,
});
export type Me = z.infer<typeof meSchema>;

export const registerSchema = z.object({
  username: usernameSchema,
  email: z.email().trim().toLowerCase(),
  password: z.string().min(8).max(128),
  displayName: z.string().trim().min(1).max(64),
});
export type RegisterInput = z.input<typeof registerSchema>;

export const loginSchema = z.object({
  login: z.string().trim().min(1).max(254).describe('Username or email'),
  password: z.string().min(1).max(128),
  code: z
    .string()
    .trim()
    .max(32)
    .optional()
    .describe('Authenticator code or a recovery code, for accounts with two-factor authentication'),
});
export type LoginInput = z.input<typeof loginSchema>;

export const refreshSchema = z.object({ refreshToken: z.string().min(10) });

export const authResultSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresIn: z.number().int().describe('Access token lifetime in seconds'),
  user: meSchema,
});
export type AuthResult = z.infer<typeof authResultSchema>;

export const updateMeSchema = z.object({
  displayName: z.string().trim().min(1).max(64).optional(),
  bio: z.string().trim().max(500).optional(),
  avatarUrl: z
    .url({ protocol: /^https?$/ })
    .nullable()
    .optional(),
});
export type UpdateMeInput = z.input<typeof updateMeSchema>;

export const verifyEmailSchema = z.object({ token: z.string().min(16).max(128) });
export const forgotPasswordSchema = z.object({ email: z.email().trim().toLowerCase() });
export const resetPasswordSchema = z.object({
  token: z.string().min(16).max(128),
  password: z.string().min(8).max(128),
});
export const changeEmailSchema = z.object({
  email: z.email().trim().toLowerCase(),
  password: z.string().min(1).max(128),
});

export const passkeySchema = z.object({
  id: z.string(),
  name: z.string(),
  backedUp: z.boolean().describe('Synced by the password manager (usable on other devices)'),
  createdAt: isoDate,
  lastUsedAt: isoDate.nullable(),
});
export type Passkey = z.infer<typeof passkeySchema>;

/** WebAuthn options for the browser, plus the id of the server-side challenge to send back. */
export const passkeyOptionsSchema = z.object({
  challengeId: z.uuid(),
  options: z.record(z.string(), z.unknown()),
});
export const addPasskeySchema = z.object({
  challengeId: z.uuid(),
  name: z.string().trim().min(1).max(64),
  response: z.record(z.string(), z.unknown()).describe('RegistrationResponseJSON from the browser'),
});
export const passkeyLoginSchema = z.object({
  challengeId: z.uuid(),
  response: z.record(z.string(), z.unknown()).describe('AuthenticationResponseJSON from the browser'),
});

/** Security rules of this server, published in /meta so clients can guide people. */
export const securityPolicySchema = z.object({
  twoFactorForStaff: z.boolean(),
  twoFactorForCompanyFinance: z.boolean(),
  verifiedEmailForApplications: z.boolean(),
  identityForCompanies: z.boolean().describe('Company owners pass an identity check before approval'),
});
export type SecurityPolicy = z.infer<typeof securityPolicySchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(128),
});

// Two-factor authentication (TOTP authenticator apps + one-time recovery codes)

export const twoFactorStatusSchema = z.object({
  enabled: z.boolean(),
  enabledAt: isoDate.nullable(),
  recoveryCodesLeft: z.number().int(),
});
export type TwoFactorStatus = z.infer<typeof twoFactorStatusSchema>;

export const twoFactorSetupSchema = z.object({
  secret: z.string().describe('Base32 secret for manual entry'),
  otpauthUrl: z.string(),
  qr: z.string().describe('PNG data URL of the otpauth QR code'),
});
export type TwoFactorSetup = z.infer<typeof twoFactorSetupSchema>;

export const twoFactorCodeSchema = z.object({ code: z.string().trim().min(6).max(32) });
export const disableTwoFactorSchema = z.object({
  password: z.string().min(1).max(128),
  code: z.string().trim().min(6).max(32),
});
export const recoveryCodesSchema = z.object({
  recoveryCodes: z.array(z.string()).describe('Shown once. Each code signs in one time.'),
});

/** A signed-in device. Every sign-in starts a session; refreshing tokens keeps it alive. */
export const sessionSchema = z.object({
  id: uuid,
  device: z.string().describe('Human description, e.g. "Chrome on Windows"'),
  kind: z.enum(['desktop', 'mobile', 'tablet', 'app', 'api', 'unknown']),
  ip: z.string().nullable(),
  createdAt: isoDate,
  lastUsedAt: isoDate,
  current: z.boolean().describe('The session making this request'),
});
export type Session = z.infer<typeof sessionSchema>;

export const contactSchema = userSummarySchema.extend({ addedAt: isoDate });
export type Contact = z.infer<typeof contactSchema>;

// ---------------------------------------------------------------------------
// Wallets
// ---------------------------------------------------------------------------

export const walletOwnerTypeSchema = z.enum(['user', 'organization']);

export const walletSchema = z.object({
  id: uuid,
  ownerType: walletOwnerTypeSchema,
  ownerId: uuid,
  currency: z.string(),
  balance: z.string().describe('Total balance, decimal string'),
  frozen: z.string().describe('Part of the balance locked until its unlock date'),
  available: z.string().describe('balance - frozen'),
  createdAt: isoDate,
});
export type Wallet = z.infer<typeof walletSchema>;

export const LEDGER_KINDS = [
  'deposit',
  'withdrawal',
  'transfer_in',
  'transfer_out',
  'investment_in',
  'investment_out',
  'exchange_in',
  'exchange_out',
  'payroll_in',
  'payroll_out',
  'issuance',
  'redemption',
  'adjustment',
] as const;

export const ledgerEntrySchema = z.object({
  id: z.number().int(),
  walletId: uuid,
  amount: z.string().describe('Signed decimal string'),
  balanceAfter: z.string(),
  currency: z.string(),
  kind: z.enum(LEDGER_KINDS),
  description: z.string(),
  referenceType: z.string().nullable(),
  referenceId: z.string().nullable(),
  createdAt: isoDate,
});
export type LedgerEntry = z.infer<typeof ledgerEntrySchema>;

export const fundLockSchema = z.object({
  id: uuid,
  amount: z.string(),
  currency: z.string(),
  reason: z.string(),
  unlocksAt: isoDate,
  createdAt: isoDate,
});
export type FundLock = z.infer<typeof fundLockSchema>;

export const transferSchema = z.object({
  fromWalletId: uuid,
  to: z.discriminatedUnion('type', [
    z.object({ type: z.literal('user'), username: usernameSchema }),
    z.object({ type: z.literal('organization'), slug: z.string().trim().toLowerCase() }),
  ]),
  amount: decimalAmountSchema,
  note: z.string().trim().max(500).optional(),
});
export type TransferInput = z.input<typeof transferSchema>;

export const CASH_METHODS = ['manager_transfer', 'physical_cash'] as const;

export const cashOperationInputSchema = z.object({
  ownerType: walletOwnerTypeSchema,
  ownerId: uuid,
  currency: currencyCodeSchema,
  amount: decimalAmountSchema,
  type: z.enum(['deposit', 'withdrawal']),
  method: z.enum(CASH_METHODS),
  reference: z.string().trim().min(1).max(128).describe('Bank reference, receipt number, cash desk slip…'),
  note: z.string().trim().max(1000).optional(),
});
export type CashOperationInput = z.input<typeof cashOperationInputSchema>;

export const cashOperationSchema = z.object({
  id: uuid,
  walletId: uuid,
  ownerType: walletOwnerTypeSchema,
  ownerId: uuid,
  ownerName: z.string(),
  type: z.enum(['deposit', 'withdrawal']),
  method: z.enum(CASH_METHODS),
  amount: z.string(),
  currency: z.string(),
  reference: z.string(),
  note: z.string(),
  processedBy: userSummarySchema.pick({ id: true, username: true, displayName: true }),
  createdAt: isoDate,
});
export type CashOperation = z.infer<typeof cashOperationSchema>;

/** Someone asks a finance manager to deposit to or pay out from one of their balances. */
export const CASH_REQUEST_STATUSES = ['pending', 'completed', 'declined', 'cancelled'] as const;

export const cashRequestInputSchema = z.object({
  type: z.enum(['deposit', 'withdrawal']),
  method: z.enum(CASH_METHODS),
  amount: decimalAmountSchema,
  note: z
    .string()
    .trim()
    .max(1000)
    .optional()
    .describe('Where the money comes from or goes to, e.g. bank details or a preferred cash desk time'),
});
export type CashRequestInput = z.input<typeof cashRequestInputSchema>;

export const cashRequestSchema = z.object({
  id: uuid,
  walletId: uuid,
  ownerType: walletOwnerTypeSchema,
  ownerId: uuid,
  ownerName: z.string(),
  type: z.enum(['deposit', 'withdrawal']),
  method: z.enum(CASH_METHODS),
  amount: z.string(),
  currency: z.string(),
  note: z.string(),
  status: z.enum(CASH_REQUEST_STATUSES),
  requestedBy: userSummarySchema.pick({ id: true, username: true, displayName: true }),
  handledBy: userSummarySchema.pick({ id: true, username: true, displayName: true }).nullable(),
  awaitingApproval: z.boolean().describe('A manager completed it; a second one has to confirm'),
  reference: z.string().nullable().describe('Reference of the cash operation that fulfilled the request'),
  declineReason: z.string().nullable(),
  createdAt: isoDate,
  handledAt: isoDate.nullable(),
});
export type CashRequest = z.infer<typeof cashRequestSchema>;
export type CashRequestStatus = (typeof CASH_REQUEST_STATUSES)[number];

/** A large cash operation waiting for a second finance manager ("four eyes"). */
export const cashApprovalSchema = z.object({
  id: uuid,
  kind: z.enum(['operation', 'request']).describe('A cash desk operation, or completing a cash request'),
  cashRequestId: uuid.nullable(),
  walletId: uuid,
  ownerType: walletOwnerTypeSchema,
  ownerName: z.string(),
  type: z.enum(['deposit', 'withdrawal']),
  method: z.enum(CASH_METHODS),
  amount: z.string(),
  currency: z.string(),
  reference: z.string(),
  note: z.string(),
  status: z.enum(['pending', 'approved', 'rejected']),
  requestedBy: userSummarySchema.pick({ id: true, username: true, displayName: true }),
  decidedBy: userSummarySchema.pick({ id: true, username: true, displayName: true }).nullable(),
  rejectReason: z.string().nullable(),
  createdAt: isoDate,
  decidedAt: isoDate.nullable(),
});
export type CashApproval = z.infer<typeof cashApprovalSchema>;

export const completeCashRequestSchema = z.object({
  reference: z.string().trim().min(1).max(128).describe('Bank reference, receipt number, cash desk slip…'),
  note: z.string().trim().max(1000).optional(),
});
export const declineCashRequestSchema = z.object({ reason: z.string().trim().min(3).max(500) });

export const statementRangeSchema = z.object({
  from: z.iso.date().optional().describe('First day to include (YYYY-MM-DD)'),
  to: z.iso.date().optional().describe('Last day to include (YYYY-MM-DD)'),
});
export type StatementRange = z.infer<typeof statementRangeSchema>;
export const statementLinkInputSchema = statementRangeSchema.extend({
  format: z.enum(['csv', 'pdf']).default('csv'),
});
export type StatementLinkInput = z.input<typeof statementLinkInputSchema>;

/** One calendar month (UTC) of a balance, for the monthly statements list. */
export const monthlyStatementSchema = z.object({
  month: z.string().describe('YYYY-MM'),
  from: z.iso.date(),
  to: z.iso.date(),
  opening: z.string(),
  moneyIn: z.string(),
  moneyOut: z.string(),
  closing: z.string(),
  operations: z.number().int(),
});
export type MonthlyStatement = z.infer<typeof monthlyStatementSchema>;
export const statementLinkSchema = z.object({
  path: z.string().describe('Append to the server address; works without an Authorization header'),
  expiresAt: isoDate,
});
export type StatementLink = z.infer<typeof statementLinkSchema>;

// ---------------------------------------------------------------------------
// Currency exchange
// ---------------------------------------------------------------------------

export const exchangeRateSchema = z.object({
  currency: z.string(),
  rate: z.string().describe('How much one unit is worth in the base currency'),
  updatedAt: isoDate,
});
export const exchangeInfoSchema = z.object({
  base: z.string().describe('Rates are quoted against this currency'),
  feePercent: z.string().describe('Taken from the amount before converting'),
  rates: z.array(exchangeRateSchema),
});
export type ExchangeInfo = z.infer<typeof exchangeInfoSchema>;

export const exchangeInputSchema = z.object({
  fromWalletId: uuid,
  toCurrency: currencyCodeSchema,
  amount: decimalAmountSchema.describe('How much to exchange, in the source currency'),
});
export type ExchangeInput = z.input<typeof exchangeInputSchema>;

export const exchangeQuoteSchema = z.object({
  fromCurrency: z.string(),
  toCurrency: z.string(),
  amount: z.string(),
  fee: z.string().describe('In the source currency'),
  receive: z.string().describe('In the target currency'),
  rate: z.string().describe('Target units per source unit'),
});
export type ExchangeQuote = z.infer<typeof exchangeQuoteSchema>;
export const exchangeResultSchema = exchangeQuoteSchema.extend({
  id: uuid,
  fromWalletId: uuid,
  toWalletId: uuid,
  createdAt: isoDate,
});
export type ExchangeResult = z.infer<typeof exchangeResultSchema>;

export const setExchangeSchema = z.object({
  base: currencyCodeSchema.optional(),
  feePercent: z
    .string()
    .regex(/^\d{1,2}(\.\d{1,2})?$/, 'A percentage such as "0.5"')
    .optional(),
  rates: z
    .array(
      z.object({
        currency: currencyCodeSchema,
        rate: z
          .string()
          .regex(/^\d{1,12}(\.\d{1,12})?$/, 'A positive decimal')
          .nullable()
          .describe('null removes the currency from exchange'),
      }),
    )
    .max(200)
    .optional(),
});

// ---------------------------------------------------------------------------
// Multi-signature company payments
// ---------------------------------------------------------------------------

export const PAYMENT_APPROVAL_KINDS = ['transfer', 'invoice', 'exchange', 'payroll'] as const;
export const paymentApprovalSchema = z.object({
  id: uuid,
  organizationId: uuid,
  walletId: uuid,
  kind: z.enum(PAYMENT_APPROVAL_KINDS),
  amount: z.string(),
  currency: z.string(),
  description: z.string(),
  status: z.enum(['pending', 'approved', 'rejected']),
  requestedBy: userSummarySchema.pick({ id: true, username: true, displayName: true }),
  decidedBy: userSummarySchema.pick({ id: true, username: true, displayName: true }).nullable(),
  reason: z.string().nullable(),
  createdAt: isoDate,
  decidedAt: isoDate.nullable(),
});
export type PaymentApproval = z.infer<typeof paymentApprovalSchema>;

// ---------------------------------------------------------------------------
// Invoices
// ---------------------------------------------------------------------------

export const INVOICE_STATUSES = ['open', 'paid', 'cancelled'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

/** A person or a company on an invoice. */
export const invoicePartySchema = z.object({
  type: walletOwnerTypeSchema,
  id: uuid,
  name: z.string(),
  handle: z.string().describe('@username or company slug'),
});
export type InvoiceParty = z.infer<typeof invoicePartySchema>;

export const invoiceItemInputSchema = z.object({
  description: z.string().trim().min(1).max(200),
  quantity: z.number().int().min(1).max(1_000_000),
  unitPrice: decimalAmountSchema,
});

export const createInvoiceSchema = z.object({
  from: z
    .discriminatedUnion('type', [
      z.object({ type: z.literal('user') }),
      z.object({ type: z.literal('organization'), organizationId: uuid }),
    ])
    .describe('Yourself, or a company where you are an owner, director or accountant'),
  to: transferSchema.shape.to,
  currency: currencyCodeSchema,
  dueDate: z.iso.date(),
  items: z.array(invoiceItemInputSchema).min(1).max(50),
  note: z.string().trim().max(1000).optional(),
});
export type CreateInvoiceInput = z.input<typeof createInvoiceSchema>;

export const invoiceSchema = z.object({
  id: uuid,
  number: z.string().describe('Per issuer and year, e.g. INV-2026-0007'),
  direction: z
    .enum(['incoming', 'outgoing'])
    .describe('Seen from the caller: outgoing when they can act for the issuer'),
  issuer: invoicePartySchema,
  recipient: invoicePartySchema,
  currency: z.string(),
  items: z.array(
    z.object({
      description: z.string(),
      quantity: z.number().int(),
      unitPrice: z.string(),
      amount: z.string(),
    }),
  ),
  total: z.string(),
  amountPaid: z.string().describe('Paid so far (invoices can be paid in parts)'),
  amountDue: z.string().describe('Still to pay'),
  payments: z.array(
    z.object({
      id: uuid,
      amount: z.string(),
      paidBy: userSummarySchema.pick({ id: true, username: true, displayName: true }),
      createdAt: isoDate,
    }),
  ),
  note: z.string(),
  dueDate: z.iso.date(),
  status: z.enum(INVOICE_STATUSES),
  overdue: z.boolean(),
  recurring: z
    .object({ scheduleId: uuid, interval: z.string() })
    .nullable()
    .describe('Issued by a recurring schedule'),
  createdBy: userSummarySchema.pick({ id: true, username: true, displayName: true }),
  createdAt: isoDate,
  paidAt: isoDate.nullable().describe('When it was paid in full'),
  paidBy: userSummarySchema.pick({ id: true, username: true, displayName: true }).nullable(),
  cancelledAt: isoDate.nullable(),
  cancelReason: z.string().nullable(),
});
export type Invoice = z.infer<typeof invoiceSchema>;

export const invoiceQuerySchema = z.object({
  direction: z.enum(['incoming', 'outgoing']).optional(),
  status: z.enum(INVOICE_STATUSES).optional(),
});
export const payInvoiceSchema = z.object({
  walletId: uuid.describe("One of the recipient's balances in the invoice currency"),
  amount: decimalAmountSchema.optional().describe('Pay part of it (by default: everything still due)'),
});

export const INVOICE_INTERVALS = ['weekly', 'monthly', 'quarterly', 'yearly'] as const;
export type InvoiceInterval = (typeof INVOICE_INTERVALS)[number];
export const INVOICE_SCHEDULE_STATUSES = ['active', 'paused', 'ended'] as const;

export const createInvoiceScheduleSchema = createInvoiceSchema.omit({ dueDate: true }).extend({
  interval: z.enum(INVOICE_INTERVALS),
  startDate: z.iso.date().describe('The first invoice goes out on this day (today: at once)'),
  endDate: z.iso.date().optional().describe('No invoices after this day'),
  dueDays: z.number().int().min(0).max(365).default(14).describe('Each invoice is due this many days later'),
});
export type CreateInvoiceScheduleInput = z.input<typeof createInvoiceScheduleSchema>;

export const invoiceScheduleSchema = z.object({
  id: uuid,
  issuer: invoicePartySchema,
  recipient: invoicePartySchema,
  currency: z.string(),
  items: invoiceSchema.shape.items,
  total: z.string(),
  note: z.string(),
  interval: z.enum(INVOICE_INTERVALS),
  dueDays: z.number().int(),
  startDate: z.iso.date(),
  endDate: z.iso.date().nullable(),
  nextRunOn: z.iso.date().nullable().describe('When the next invoice goes out; null once ended'),
  status: z.enum(INVOICE_SCHEDULE_STATUSES),
  invoiceCount: z.number().int(),
  lastInvoiceId: uuid.nullable(),
  createdBy: userSummarySchema.pick({ id: true, username: true, displayName: true }),
  createdAt: isoDate,
});
export type InvoiceSchedule = z.infer<typeof invoiceScheduleSchema>;
export const updateInvoiceScheduleSchema = z.object({
  status: z.enum(INVOICE_SCHEDULE_STATUSES).describe('Pause, resume, or end for good'),
});

// ---------------------------------------------------------------------------
// Payroll
// ---------------------------------------------------------------------------

export const PAYROLL_STATUSES = ['pending', 'paid', 'rejected'] as const;
export const payrollInputSchema = z.object({
  walletId: uuid.describe('The company balance that pays'),
  title: z.string().trim().min(1).max(120).describe('For example "Salaries — March"'),
  items: z
    .array(
      z.object({
        username: usernameSchema,
        amount: decimalAmountSchema,
        note: z.string().trim().max(200).optional(),
      }),
    )
    .min(1)
    .max(200),
});
export type PayrollInput = z.input<typeof payrollInputSchema>;
export const payrollRunSchema = z.object({
  id: uuid,
  organizationId: uuid,
  walletId: uuid,
  currency: z.string(),
  title: z.string(),
  total: z.string(),
  status: z.enum(PAYROLL_STATUSES).describe('pending: waiting for a second signature'),
  items: z.array(
    z.object({
      user: userSummarySchema.pick({ id: true, username: true, displayName: true }),
      amount: z.string(),
      note: z.string(),
    }),
  ),
  approvalId: uuid.nullable(),
  createdBy: userSummarySchema.pick({ id: true, username: true, displayName: true }),
  createdAt: isoDate,
  paidAt: isoDate.nullable(),
});
export type PayrollRun = z.infer<typeof payrollRunSchema>;
export const cancelInvoiceSchema = z.object({ reason: z.string().trim().max(500).optional() });

// ---------------------------------------------------------------------------
// Organizations
// ---------------------------------------------------------------------------

export const ORG_ROLES = ['owner', 'director', 'accountant', 'member'] as const;
export const orgRoleSchema = z.enum(ORG_ROLES);
export type OrgRole = z.infer<typeof orgRoleSchema>;
/** Organization roles that may view and move company money. */
export const ORG_FINANCE_ROLES: readonly OrgRole[] = ['owner', 'director', 'accountant'];

export const organizationSchema = z.object({
  id: uuid,
  name: z.string(),
  slug: z.string(),
  description: z.string(),
  website: z.string().nullable(),
  country: z.string().nullable(),
  baseCurrency: z.string(),
  status: z.enum(['active', 'suspended']),
  registryNumber: z.string().nullable(),
  ticker: z.string().nullable(),
  owner: userSummarySchema,
  memberCount: z.number().int(),
  myRole: orgRoleSchema.nullable(),
  verified: z.boolean().describe('Verified business: its owner passed an identity check'),
  approvalLimit: z
    .string()
    .nullable()
    .describe('Payments of at least this much (in the base currency) need a second finance member'),
  createdAt: isoDate,
});
export type Organization = z.infer<typeof organizationSchema>;

export const orgMemberSchema = z.object({ user: userSummarySchema, role: orgRoleSchema, joinedAt: isoDate });
export type OrgMember = z.infer<typeof orgMemberSchema>;

export const addOrgMemberSchema = z.object({
  username: usernameSchema,
  role: orgRoleSchema.exclude(['owner']),
});

export const updateOrganizationSchema = z.object({
  description: z.string().trim().min(10).max(5000).optional(),
  website: z.union([z.url({ protocol: /^https?$/ }), z.literal('')]).optional(),
  approvalLimit: z
    .union([decimalAmountSchema, z.literal('')])
    .optional()
    .describe('Owners and directors: payments of at least this much need two people ("" turns it off)'),
});

// ---------------------------------------------------------------------------
// Applications (registration suggestions)
// ---------------------------------------------------------------------------

export const applicationReviewSchema = z.object({
  id: uuid,
  stageKey: z.string(),
  reviewer: userSummarySchema,
  reviewerRole: roleSchema,
  decision: z.enum(['approve', 'reject', 'request_changes']),
  comment: z.string(),
  checklist: z.array(z.string()).nullable(),
  round: z.number().int(),
  createdAt: isoDate,
});
export type ApplicationReview = z.infer<typeof applicationReviewSchema>;

/** An uploaded file; `url` is a signed link for the caller (works in <img> and <a>, about an hour). */
export const fileSchema = z.object({
  id: uuid,
  name: z.string(),
  contentType: z.string(),
  size: z.number().int(),
  url: z.string(),
  createdAt: isoDate,
});
export type FileInfo = z.infer<typeof fileSchema>;

// Identity verification (KYC)

export const IDENTITY_STATUSES = ['pending', 'approved', 'rejected', 'revoked'] as const;
export const IDENTITY_DOCUMENTS = ['passport', 'id_card', 'driver_license', 'residence_permit'] as const;

export const identitySubmitSchema = z.object({
  legalName: z.string().trim().min(2).max(120),
  dateOfBirth: z.iso.date(),
  country: z.string().trim().min(2).max(80),
  documentType: z.enum(IDENTITY_DOCUMENTS),
  documentNumber: z.string().trim().min(4).max(40),
  documentFileId: uuid.describe('A photo or scan of the document (uploaded with POST /files)'),
  selfieFileId: uuid.optional().describe('A photo of you holding the document'),
});
export type IdentitySubmitInput = z.infer<typeof identitySubmitSchema>;

export const identityCheckSchema = z.object({
  id: uuid,
  user: userSummarySchema,
  status: z.enum(IDENTITY_STATUSES),
  legalName: z.string(),
  dateOfBirth: z.iso.date(),
  country: z.string(),
  documentType: z.enum(IDENTITY_DOCUMENTS),
  documentLast4: z.string().describe('Only the last four characters of the number are kept'),
  files: z.array(fileSchema),
  duplicate: z.boolean().describe('The same document number is on another verified account'),
  rejectionReason: z.string().nullable(),
  reviewedBy: userSummarySchema.pick({ id: true, username: true, displayName: true }).nullable(),
  createdAt: isoDate,
  reviewedAt: isoDate.nullable(),
});
export type IdentityCheck = z.infer<typeof identityCheckSchema>;
export const identityDecisionSchema = z.object({ reason: z.string().trim().min(3).max(500) });

/** Types people can upload: images, PDF, text and office documents (no SVG or HTML). */
export const UPLOAD_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.oasis.opendocument.spreadsheet',
  'application/zip',
] as const;

export const applicationSchema = z.object({
  id: uuid,
  type: z.enum(APPLICATION_TYPES),
  status: z.enum(APPLICATION_STATUSES),
  stageIndex: z.number().int(),
  currentStage: z.string().nullable(),
  applicant: userSummarySchema,
  payload: z.record(z.string(), z.unknown()),
  result: z.record(z.string(), z.unknown()).nullable(),
  rejectionReason: z.string().nullable(),
  /** Set while the applicant is asked to change something. */
  changesRequested: z.string().nullable(),
  round: z.number().int(),
  attachments: z.array(fileSchema),
  reviews: z.array(applicationReviewSchema),
  createdAt: isoDate,
  updatedAt: isoDate,
  decidedAt: isoDate.nullable(),
});
export type Application = z.infer<typeof applicationSchema>;

export const reviewInputSchema = z.object({
  decision: z.enum(['approve', 'reject', 'request_changes']),
  comment: z.string().trim().max(5000).optional(),
  checklist: z.array(z.string()).optional().describe('Checklist keys the reviewer confirms they reviewed'),
});
export type ReviewInput = z.input<typeof reviewInputSchema>;

/** Attach uploaded files (up to 10 per application) when submitting or resubmitting. */
export const attachmentIdsSchema = z.array(uuid).max(10).optional();
export const resubmitApplicationSchema = z.object({
  payload: z
    .record(z.string(), z.unknown())
    .describe('The corrected application, same shape as at submission'),
  attachments: attachmentIdsSchema.describe('More files to attach'),
});

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const REGISTRY_KINDS = ['organization', 'license', 'virtual_country'] as const;
export const REGISTRY_STATUSES = ['active', 'suspended', 'revoked', 'expired'] as const;

export const registryEntrySchema = z.object({
  id: uuid,
  number: z.string(),
  kind: z.enum(REGISTRY_KINDS),
  licenseType: z.enum(LICENSE_TYPES).nullable(),
  title: z.string(),
  description: z.string(),
  website: z.string().nullable(),
  status: z.enum(REGISTRY_STATUSES),
  holder: z.object({
    type: z.enum(['user', 'organization']),
    id: uuid,
    name: z.string(),
    handle: z.string().describe('Username or organization slug'),
    verified: z.boolean().describe('A verified business (organizations only)'),
  }),
  issuedAt: isoDate,
  expiresAt: isoDate.nullable().describe('Licences run for a term and are renewed; companies do not expire'),
  currency: z.string().nullable().describe('The currency a virtual country issues'),
  updatedAt: isoDate,
});
export type RegistryEntry = z.infer<typeof registryEntrySchema>;

// ---------------------------------------------------------------------------
// Virtual-country currencies
// ---------------------------------------------------------------------------

export const currencyInfoSchema = z.object({
  code: z.string(),
  name: z.string(),
  decimals: z.number().int(),
  virtual: z.boolean(),
  issuer: z
    .object({ registryNumber: z.string(), country: z.string(), status: z.string() })
    .nullable()
    .describe('The virtual country that issues it'),
});
export type CurrencyInfo = z.infer<typeof currencyInfoSchema>;

export const createVirtualCurrencySchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, 'Three letters, e.g. "HLX"'),
  name: z.string().trim().min(2).max(64),
  decimals: z.number().int().min(0).max(4).default(2),
});
export type CreateVirtualCurrencyInput = z.input<typeof createVirtualCurrencySchema>;

export const virtualCurrencySchema = z.object({
  code: z.string(),
  name: z.string(),
  decimals: z.number().int(),
  status: z.enum(['active', 'suspended']),
  registryEntryId: uuid,
  registryNumber: z.string(),
  country: z.string(),
  supply: z.string().describe('Issued minus redeemed'),
  holders: z.number().int().describe('Balances that hold some'),
  issuerWalletId: uuid.nullable(),
  createdAt: isoDate,
});
export type VirtualCurrency = z.infer<typeof virtualCurrencySchema>;
export const issueCurrencySchema = z.object({
  amount: decimalAmountSchema,
  note: z.string().trim().max(200).optional(),
});

/** A licence you hold (yourself or through a company you own or direct). */
export const myLicenceSchema = registryEntrySchema.extend({
  renewalApplicationId: uuid.nullable().describe('A renewal waiting for moderation'),
});
export type MyLicence = z.infer<typeof myLicenceSchema>;

export const registrySearchQuery = paginationQuery.extend({
  q: z.string().trim().max(200).optional(),
  kind: z.enum(REGISTRY_KINDS).optional(),
  licenseType: z.enum(LICENSE_TYPES).optional(),
  status: z.enum(REGISTRY_STATUSES).optional(),
});
export type RegistrySearchQuery = z.input<typeof registrySearchQuery>;

// ---------------------------------------------------------------------------
// Stock exchange
// ---------------------------------------------------------------------------

export const LISTING_STATUSES = ['active', 'halted', 'delisted'] as const;

export const stockListingSchema = z.object({
  id: uuid,
  ticker: z.string(),
  organization: z.object({
    id: uuid,
    name: z.string(),
    slug: z.string(),
    registryNumber: z.string().nullable(),
    verified: z.boolean(),
  }),
  currency: z.string(),
  sharePrice: z.string(),
  totalShares: z.string(),
  sharesSold: z.string(),
  sharesAvailable: z.string(),
  marketCap: z.string().describe('sharePrice × totalShares'),
  raised: z.string().describe('Total money invested so far'),
  investorsCount: z.number().int(),
  freezePercent: z.number().describe('Share of every investment frozen on the company balance'),
  lockDays: z.number().int().describe('How long the frozen part stays locked'),
  status: z.enum(LISTING_STATUSES),
  listedAt: isoDate,
});
export type StockListing = z.infer<typeof stockListingSchema>;

export const pricePointSchema = z.object({ price: z.string(), at: isoDate });

export const stockListingDetailSchema = stockListingSchema.extend({
  description: z.string(),
  priceHistory: z.array(pricePointSchema),
});
export type StockListingDetail = z.infer<typeof stockListingDetailSchema>;

export const investInputSchema = z.object({
  amount: decimalAmountSchema.describe('Money to invest; converted to whole shares at the current price'),
});

export const investmentSchema = z.object({
  id: uuid,
  ticker: z.string(),
  organizationName: z.string(),
  shares: z.string(),
  amount: z.string(),
  currency: z.string(),
  frozenAmount: z.string(),
  unlocksAt: isoDate,
  createdAt: isoDate,
});
export type Investment = z.infer<typeof investmentSchema>;

export const holdingSchema = z.object({
  ticker: z.string(),
  organizationName: z.string(),
  organizationSlug: z.string(),
  currency: z.string(),
  shares: z.string(),
  invested: z.string(),
  currentValue: z.string(),
});
export type Holding = z.infer<typeof holdingSchema>;

export const updateListingSchema = z.object({
  sharePrice: decimalAmountSchema.optional(),
  status: z.enum(LISTING_STATUSES).optional(),
  freezePercent: z.number().min(0).max(100).optional(),
  lockDays: z.number().int().min(1).max(3650).optional(),
});

// ---------------------------------------------------------------------------
// Chats
// ---------------------------------------------------------------------------

export const CHAT_TYPES = ['direct', 'group', 'channel', 'support', 'council', 'moderation'] as const;
export const chatTypeSchema = z.enum(CHAT_TYPES);
export type ChatType = z.infer<typeof chatTypeSchema>;

export const messageSchema = z.object({
  id: z.number().int(),
  chatId: uuid,
  sender: userSummarySchema.nullable(),
  kind: z.enum(['text', 'system']),
  body: z.string(),
  meta: z.record(z.string(), z.unknown()),
  replyToId: z.number().int().nullable(),
  editedAt: isoDate.nullable(),
  deleted: z.boolean(),
  createdAt: isoDate,
});
export type Message = z.infer<typeof messageSchema>;

export const chatSchema = z.object({
  id: uuid,
  type: chatTypeSchema,
  title: z.string(),
  description: z.string(),
  handle: z.string().nullable(),
  isPublic: z.boolean(),
  memberCount: z.number().int(),
  myRole: z.enum(['owner', 'admin', 'member']).nullable(),
  pinned: z.boolean(),
  unreadCount: z.number().int(),
  lastMessage: messageSchema.nullable(),
  peer: userSummarySchema.nullable().describe('The other participant of a direct chat'),
  support: z
    .object({ status: z.enum(['open', 'closed']), requester: userSummarySchema })
    .nullable()
    .describe('Set for tech-support tickets'),
  createdAt: isoDate,
});
export type Chat = z.infer<typeof chatSchema>;

export const chatMemberSchema = z.object({
  user: userSummarySchema,
  role: z.enum(['owner', 'admin', 'member']),
  joinedAt: isoDate,
});
export type ChatMember = z.infer<typeof chatMemberSchema>;

export const sendMessageSchema = z.object({
  body: z.string().trim().min(1).max(4000),
  replyToId: z.number().int().positive().optional(),
});

export const createGroupSchema = z.object({
  title: z.string().trim().min(1).max(128),
  description: z.string().trim().max(2000).optional(),
  memberIds: z.array(uuid).max(200).default([]).describe('Must be people from your contacts'),
});

export const createChannelSchema = z.object({
  title: z.string().trim().min(2).max(128),
  handle: handleSchema,
  description: z.string().trim().max(2000).optional(),
  ownerId: uuid.optional().describe('Hand the channel to another user (defaults to you)'),
});

export const updateChatSchema = z.object({
  title: z.string().trim().min(1).max(128).optional(),
  description: z.string().trim().max(2000).optional(),
});

export const messagesQuery = z.object({
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const createTicketSchema = z.object({
  subject: z.string().trim().min(3).max(128),
  body: z.string().trim().min(1).max(4000),
});

// ---------------------------------------------------------------------------
// Service stories
// ---------------------------------------------------------------------------

export const storySchema = z.object({
  id: uuid,
  author: userSummarySchema,
  text: z.string(),
  mediaUrl: z.string().nullable(),
  linkUrl: z.string().nullable(),
  background: z.string(),
  viewed: z.boolean(),
  viewsCount: z.number().int(),
  createdAt: isoDate,
  expiresAt: isoDate,
});
export type Story = z.infer<typeof storySchema>;

export const createStorySchema = z.object({
  text: z.string().trim().min(1).max(500),
  mediaUrl: z.url({ protocol: /^https?$/ }).optional(),
  linkUrl: z.url({ protocol: /^https?$/ }).optional(),
  background: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default('#2d6cdf'),
  durationHours: z.number().int().min(1).max(168).default(24),
});
export type CreateStoryInput = z.input<typeof createStorySchema>;

// ---------------------------------------------------------------------------
// Developer API keys
// ---------------------------------------------------------------------------

export const API_KEY_SCOPES = ['registry:read', 'stock:read'] as const;

export const apiKeySchema = z.object({
  id: uuid,
  name: z.string(),
  prefix: z.string(),
  scopes: z.array(z.enum(API_KEY_SCOPES)),
  owner: userSummarySchema.pick({ id: true, username: true }),
  createdAt: isoDate,
  lastUsedAt: isoDate.nullable(),
  revokedAt: isoDate.nullable(),
});
export type ApiKey = z.infer<typeof apiKeySchema>;

export const createApiKeySchema = z.object({
  name: z.string().trim().min(1).max(64),
  scopes: z.array(z.enum(API_KEY_SCOPES)).min(1).default(['registry:read', 'stock:read']),
});

export const createdApiKeySchema = apiKeySchema.extend({
  key: z.string().describe('Shown only once. Send it as the X-API-Key header.'),
});

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

export const adminUserSchema = userSummarySchema.extend({
  email: z.string(),
  status: z.enum(['active', 'suspended']),
  createdAt: isoDate,
  lastSeenAt: isoDate.nullable(),
});
export type AdminUser = z.infer<typeof adminUserSchema>;

export const adminUpdateUserSchema = z.object({
  role: roleSchema.optional(),
  status: z.enum(['active', 'suspended']).optional(),
});

export const auditLogSchema = z.object({
  id: z.number().int(),
  actor: userSummarySchema.pick({ id: true, username: true }).nullable(),
  action: z.string(),
  targetType: z.string().nullable(),
  targetId: z.string().nullable(),
  data: z.record(z.string(), z.unknown()),
  ip: z.string().nullable(),
  createdAt: isoDate,
});
export type AuditLog = z.infer<typeof auditLogSchema>;

export const adminStatsSchema = z.object({
  users: z.record(z.string(), z.number()),
  organizations: z.number(),
  pendingApplications: z.number(),
  openTickets: z.number(),
  activeListings: z.number(),
  registryEntries: z.number(),
  pendingCashRequests: z.number(),
  pendingIdentityChecks: z.number(),
  pendingCashApprovals: z.number(),
  balances: z.array(z.object({ currency: z.string(), total: z.string(), wallets: z.number() })),
  /** The last 14 days, oldest first (UTC dates). */
  activity: z.array(
    z.object({ date: z.string(), signups: z.number(), messages: z.number(), applications: z.number() }),
  ),
});
export type AdminStats = z.infer<typeof adminStatsSchema>;

// ---------------------------------------------------------------------------
// Realtime (WebSocket /api/v1/realtime?token=ACCESS_TOKEN)
// ---------------------------------------------------------------------------

export type RealtimeEvent =
  | { type: 'ready'; userId: string }
  | { type: 'message.created'; chatId: string; message: Message }
  | { type: 'message.updated'; chatId: string; message: Message }
  | { type: 'chat.updated'; chatId: string }
  | { type: 'chat.removed'; chatId: string }
  | { type: 'typing'; chatId: string; userId: string }
  | { type: 'application.updated'; applicationId: string; status: string; stageIndex: number }
  | { type: 'story.created'; storyId: string }
  | { type: 'wallet.updated'; walletId: string }
  | { type: 'cash_request.updated'; requestId: string; walletId: string; status: string }
  | { type: 'invoice.updated'; invoiceId: string; status: string }
  | { type: 'identity.updated'; status: string }
  | { type: 'payment_approval.updated'; organizationId: string; approvalId: string; status: string }
  | { type: 'payroll.updated'; organizationId: string; runId: string; status: string };

/** Messages a client may send over the realtime socket. */
export type RealtimeClientMessage = { type: 'typing'; chatId: string } | { type: 'ping' };
