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
});
export type Preferences = z.infer<typeof preferencesSchema>;

export const meSchema = userSummarySchema.extend({
  email: z.string(),
  bio: z.string(),
  status: z.enum(['active', 'suspended']),
  permissions: z.array(z.string()),
  preferences: preferencesSchema,
  twoFactorEnabled: z.boolean(),
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
  reference: z.string().nullable().describe('Reference of the cash operation that fulfilled the request'),
  declineReason: z.string().nullable(),
  createdAt: isoDate,
  handledAt: isoDate.nullable(),
});
export type CashRequest = z.infer<typeof cashRequestSchema>;
export type CashRequestStatus = (typeof CASH_REQUEST_STATUSES)[number];

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
export const statementLinkSchema = z.object({
  path: z.string().describe('Append to the server address; works without an Authorization header'),
  expiresAt: isoDate,
});
export type StatementLink = z.infer<typeof statementLinkSchema>;

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
  note: z.string(),
  dueDate: z.iso.date(),
  status: z.enum(INVOICE_STATUSES),
  overdue: z.boolean(),
  createdBy: userSummarySchema.pick({ id: true, username: true, displayName: true }),
  createdAt: isoDate,
  paidAt: isoDate.nullable(),
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
});
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
});

// ---------------------------------------------------------------------------
// Applications (registration suggestions)
// ---------------------------------------------------------------------------

export const applicationReviewSchema = z.object({
  id: uuid,
  stageKey: z.string(),
  reviewer: userSummarySchema,
  reviewerRole: roleSchema,
  decision: z.enum(['approve', 'reject']),
  comment: z.string(),
  checklist: z.array(z.string()).nullable(),
  createdAt: isoDate,
});
export type ApplicationReview = z.infer<typeof applicationReviewSchema>;

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
  reviews: z.array(applicationReviewSchema),
  createdAt: isoDate,
  updatedAt: isoDate,
  decidedAt: isoDate.nullable(),
});
export type Application = z.infer<typeof applicationSchema>;

export const reviewInputSchema = z.object({
  decision: z.enum(['approve', 'reject']),
  comment: z.string().trim().max(5000).optional(),
  checklist: z.array(z.string()).optional().describe('Checklist keys the reviewer confirms they reviewed'),
});
export type ReviewInput = z.input<typeof reviewInputSchema>;

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const REGISTRY_KINDS = ['organization', 'license', 'virtual_country'] as const;
export const REGISTRY_STATUSES = ['active', 'suspended', 'revoked'] as const;

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
  }),
  issuedAt: isoDate,
  updatedAt: isoDate,
});
export type RegistryEntry = z.infer<typeof registryEntrySchema>;

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
  | { type: 'invoice.updated'; invoiceId: string; status: string };

/** Messages a client may send over the realtime socket. */
export type RealtimeClientMessage = { type: 'typing'; chatId: string } | { type: 'ping' };
