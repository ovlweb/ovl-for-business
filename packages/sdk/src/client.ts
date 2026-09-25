import type {
  AdminStats,
  AdminUser,
  ApiKey,
  Application,
  AuditLog,
  AuthResult,
  CashApproval,
  CashOperation,
  CashOperationInput,
  CashRequest,
  CashRequestInput,
  CashRequestStatus,
  Chat,
  ChatMember,
  Contact,
  ExchangeInfo,
  ExchangeInput,
  ExchangeQuote,
  ExchangeResult,
  CreateApplicationInput,
  CreateInvoiceInput,
  CreateInvoiceScheduleInput,
  CreateStoryInput,
  FileInfo,
  FundLock,
  Holding,
  IdentityCheck,
  IdentitySubmitInput,
  Investment,
  Invoice,
  InvoiceSchedule,
  InvoiceStatus,
  LedgerEntry,
  LoginInput,
  Me,
  Message,
  Organization,
  Passkey,
  PaymentApproval,
  PayrollInput,
  PayrollRun,
  OrgMember,
  Preferences,
  OrgRole,
  RegisterInput,
  RegistryEntry,
  RegistrySearchQuery,
  Session,
  MonthlyStatement,
  StatementLink,
  StatementLinkInput,
  StatementRange,
  TwoFactorSetup,
  TwoFactorStatus,
  ReviewInput,
  Role,
  StockListing,
  StockListingDetail,
  Story,
  TransferInput,
  UpdateMeInput,
  UserProfile,
  UserSummary,
  Wallet,
} from '@ovl/shared';
import { RealtimeConnection } from './realtime';

export interface Tokens {
  accessToken: string;
  refreshToken: string;
}

/** Where the client keeps its tokens (localStorage on the web, secure storage on mobile/desktop…). */
export interface TokenStore {
  get(): Tokens | null;
  set(tokens: Tokens | null): void;
}

export class MemoryTokenStore implements TokenStore {
  private tokens: Tokens | null = null;
  get() {
    return this.tokens;
  }
  set(tokens: Tokens | null) {
    this.tokens = tokens;
  }
}

export class OvlApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface OvlClientOptions {
  /** API origin, e.g. "https://api.example.com" or "" for same-origin. */
  baseUrl: string;
  tokenStore?: TokenStore;
  /** Developer key for the public registry / stock endpoints (server-to-server use). */
  apiKey?: string;
  fetch?: typeof fetch;
  /** Called when the session ends (refresh failed or logout). */
  onSignedOut?: () => void;
}

type Query = Record<string, string | number | boolean | undefined | null>;

function qs(query?: Query): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query))
    if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
  const s = params.toString();
  return s ? `?${s}` : '';
}

export class OvlClient {
  readonly baseUrl: string;
  readonly tokens: TokenStore;
  private readonly apiKey?: string;
  private readonly fetchImpl: typeof fetch;
  private readonly onSignedOut?: () => void;
  private refreshing: Promise<boolean> | null = null;

  constructor(options: OvlClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.tokens = options.tokenStore ?? new MemoryTokenStore();
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.onSignedOut = options.onSignedOut;
  }

  get isSignedIn(): boolean {
    return !!this.tokens.get();
  }

  // ---------------------------------------------------------------------------
  // Transport
  // ---------------------------------------------------------------------------

  private async send(
    method: string,
    path: string,
    body?: unknown,
    retry = true,
    accept = 'application/json',
  ): Promise<Response> {
    const headers: Record<string, string> = { accept };
    const tokens = this.tokens.get();
    if (tokens) headers.authorization = `Bearer ${tokens.accessToken}`;
    if (this.apiKey) headers['x-api-key'] = this.apiKey;
    // A Blob (a file upload) goes as it is, with its own type; everything else is JSON.
    const raw = typeof Blob !== 'undefined' && body instanceof Blob;
    if (raw) headers['content-type'] = (body as Blob).type || 'application/octet-stream';
    else if (body !== undefined) headers['content-type'] = 'application/json';

    const res = await this.fetchImpl(`${this.baseUrl}/api/v1${path}`, {
      method,
      headers,
      body: raw ? (body as Blob) : body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (res.status === 401 && retry && tokens && !path.startsWith('/auth/')) {
      if (await this.refresh()) return this.send(method, path, body, false, accept);
    }
    return res;
  }

  private static async fail(res: Response, text?: string): Promise<never> {
    const body = text ?? (await res.text());
    let data: { error?: string; message?: string; details?: unknown } | undefined;
    try {
      data = body ? JSON.parse(body) : undefined;
    } catch {
      data = undefined;
    }
    throw new OvlApiError(res.status, data?.error ?? 'error', data?.message ?? res.statusText, data?.details);
  }

  async request<T>(method: string, path: string, body?: unknown, retry = true): Promise<T> {
    const res = await this.send(method, path, body, retry);
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    if (!res.ok) return OvlClient.fail(res, text);
    return (text ? JSON.parse(text) : undefined) as T;
  }

  /** Fetch a file (such as a CSV statement) with the same authentication as every other call. */
  async download(path: string, query?: Query): Promise<{ blob: Blob; filename: string | null }> {
    const res = await this.send('GET', path + qs(query), undefined, true, '*/*');
    if (!res.ok) return OvlClient.fail(res);
    const disposition = res.headers.get('content-disposition') ?? '';
    return { blob: await res.blob(), filename: /filename="([^"]+)"/.exec(disposition)?.[1] ?? null };
  }

  private get<T>(path: string, query?: Query) {
    return this.request<T>('GET', path + qs(query));
  }
  private post<T>(path: string, body: unknown = {}) {
    return this.request<T>('POST', path, body);
  }
  private put<T>(path: string, body: unknown) {
    return this.request<T>('PUT', path, body);
  }
  private patch<T>(path: string, body: unknown) {
    return this.request<T>('PATCH', path, body);
  }
  private del<T = void>(path: string) {
    return this.request<T>('DELETE', path);
  }

  /** Exchange the refresh token for a new pair. Concurrent callers share one request. */
  refresh(): Promise<boolean> {
    if (!this.refreshing) {
      this.refreshing = (async () => {
        const tokens = this.tokens.get();
        if (!tokens) return false;
        try {
          const result = await this.request<AuthResult>(
            'POST',
            '/auth/refresh',
            { refreshToken: tokens.refreshToken },
            false,
          );
          this.tokens.set({ accessToken: result.accessToken, refreshToken: result.refreshToken });
          return true;
        } catch {
          // Another tab or process may have refreshed with the same token a moment earlier;
          // if the store now holds newer tokens, use those instead of signing out.
          const latest = this.tokens.get();
          if (latest && latest.refreshToken !== tokens.refreshToken) return true;
          this.tokens.set(null);
          this.onSignedOut?.();
          return false;
        } finally {
          setTimeout(() => (this.refreshing = null), 0);
        }
      })();
    }
    return this.refreshing;
  }

  private storeAuth(result: AuthResult): Me {
    this.tokens.set({ accessToken: result.accessToken, refreshToken: result.refreshToken });
    return result.user;
  }

  /** Live events (messages, application updates, stories, wallet changes). */
  realtime(): RealtimeConnection {
    return new RealtimeConnection(this);
  }

  // ---------------------------------------------------------------------------
  // API surface
  // ---------------------------------------------------------------------------

  meta = () => this.get<Record<string, unknown>>('/meta');

  auth = {
    register: async (input: RegisterInput) =>
      this.storeAuth(await this.post<AuthResult>('/auth/register', input)),
    login: async (input: LoginInput) => this.storeAuth(await this.post<AuthResult>('/auth/login', input)),
    /** Passkey sign-in, step 1: options for navigator.credentials.get(). */
    passkeyOptions: () =>
      this.post<{ challengeId: string; options: Record<string, unknown> }>('/auth/passkey/options'),
    /** Passkey sign-in, step 2: send the browser's answer. */
    passkeyLogin: async (challengeId: string, response: unknown) =>
      this.storeAuth(await this.post<AuthResult>('/auth/passkey', { challengeId, response })),
    /** Single sign-on (admin panel): whether it is offered, then start and finish it. */
    sso: () => this.get<{ enabled: boolean; label: string }>('/auth/sso'),
    ssoStart: () => this.post<{ url: string }>('/auth/sso/start'),
    ssoCallback: async (code: string, state: string) =>
      this.storeAuth(await this.post<AuthResult>('/auth/sso/callback', { code, state })),
    /** Confirm an email address with the token from the link. */
    verifyEmail: (token: string) => this.post<{ email: string }>('/auth/verify-email', { token }),
    /** Email a reset link (always succeeds, so it never reveals whether an address is registered). */
    forgotPassword: (email: string) => this.post<void>('/auth/password/forgot', { email }),
    resetPassword: (token: string, password: string) =>
      this.post<void>('/auth/password/reset', { token, password }),
    logout: async () => {
      const tokens = this.tokens.get();
      this.tokens.set(null);
      if (tokens)
        await this.post('/auth/logout', { refreshToken: tokens.refreshToken }).catch(() => undefined);
    },
  };

  me = {
    get: () => this.get<Me>('/me'),
    update: (input: UpdateMeInput) => this.patch<Me>('/me', input),
    updatePreferences: (input: Preferences) => this.patch<Me>('/me/preferences', input),
    changePassword: (currentPassword: string, newPassword: string) =>
      this.post<void>('/me/password', { currentPassword, newPassword }),
    /** Change the email address; the new one must be confirmed through the emailed link. */
    changeEmail: (email: string, password: string) => this.post<Me>('/me/email', { email, password }),
    resendVerification: () => this.post<void>('/me/email/verification'),
    /** Your latest identity check (KYC), or null. */
    identity: () => this.get<IdentityCheck | null>('/me/identity'),
    submitIdentity: (input: IdentitySubmitInput) => this.post<IdentityCheck>('/me/identity', input),
    passkeys: {
      list: () => this.get<Passkey[]>('/me/passkeys'),
      options: () =>
        this.post<{ challengeId: string; options: Record<string, unknown> }>('/me/passkeys/options'),
      add: (challengeId: string, name: string, response: unknown) =>
        this.post<Passkey>('/me/passkeys', { challengeId, name, response }),
      remove: (id: string) => this.del(`/me/passkeys/${encodeURIComponent(id)}`),
    },
    /** Two-factor authentication (authenticator app + recovery codes). */
    twoFactor: {
      status: () => this.get<TwoFactorStatus>('/me/2fa'),
      setup: () => this.post<TwoFactorSetup>('/me/2fa/setup'),
      enable: (code: string) => this.post<{ recoveryCodes: string[] }>('/me/2fa/enable', { code }),
      disable: (password: string, code: string) => this.post<void>('/me/2fa/disable', { password, code }),
      newRecoveryCodes: (code: string) =>
        this.post<{ recoveryCodes: string[] }>('/me/2fa/recovery-codes', { code }),
    },
    /** Devices signed in to this account. */
    sessions: () => this.get<Session[]>('/me/sessions'),
    signOutSession: (id: string) => this.del(`/me/sessions/${id}`),
    signOutOtherSessions: () => this.post<{ signedOut: number }>('/me/sessions/sign-out-others'),
  };

  users = {
    search: (q: string) => this.get<UserSummary[]>('/users/search', { q }),
    get: (username: string) => this.get<UserProfile>(`/users/${encodeURIComponent(username)}`),
  };

  contacts = {
    list: () => this.get<Contact[]>('/contacts'),
    add: (username: string) => this.post<Contact>('/contacts', { username }),
    remove: (userId: string) => this.del(`/contacts/${userId}`),
  };

  wallets = {
    list: () => this.get<Wallet[]>('/wallets'),
    open: (currency: string) => this.post<Wallet>('/wallets', { currency }),
    get: (id: string) => this.get<Wallet>(`/wallets/${id}`),
    entries: (id: string, query?: { limit?: number; offset?: number }) =>
      this.get<Page<LedgerEntry>>(`/wallets/${id}/entries`, query),
    locks: (id: string) => this.get<FundLock[]>(`/wallets/${id}/locks`),
    /** Company payments of at least the approval limit come back as a PaymentApproval (HTTP 202). */
    transfer: (input: TransferInput) => this.post<Wallet | PaymentApproval>('/wallets/transfer', input),
    cashRequests: (id: string) => this.get<CashRequest[]>(`/wallets/${id}/cash-requests`),
    /** Ask a finance manager for a deposit or a payout (a payout holds the amount meanwhile). */
    requestCash: (id: string, input: CashRequestInput) =>
      this.post<CashRequest>(`/wallets/${id}/cash-requests`, input),
    cancelCashRequest: (requestId: string) => this.post<CashRequest>(`/cash-requests/${requestId}/cancel`),
    /** The statement as a CSV file, optionally limited to ISO dates. */
    statementCsv: (id: string, range?: { from?: string; to?: string }) =>
      this.download(`/wallets/${id}/statement.csv`, range),
    /** The statement as a printable PDF, optionally limited to ISO dates. */
    statementPdf: (id: string, range?: { from?: string; to?: string }) =>
      this.download(`/wallets/${id}/statement.pdf`, range),
    /** A 5-minute link to the CSV (or `format: 'pdf'`) that works without a token (to open in a browser). */
    statementLink: (id: string, input: StatementLinkInput = {}) =>
      this.post<StatementLink>(`/wallets/${id}/statement-link`, input),
    /** Calendar months with activity: opening and closing balance, money in and out. */
    statements: (id: string) => this.get<MonthlyStatement[]>(`/wallets/${id}/statements`),
  };

  invoices = {
    list: (query?: { direction?: 'incoming' | 'outgoing'; status?: InvoiceStatus }) =>
      this.get<Invoice[]>('/invoices', query),
    get: (id: string) => this.get<Invoice>(`/invoices/${id}`),
    create: (input: CreateInvoiceInput) => this.post<Invoice>('/invoices', input),
    /** Pay in full from one of the recipient's balances in the invoice currency. */
    /** Everything still due, or `amount` of it. */
    pay: (id: string, walletId: string, amount?: string) =>
      this.post<Invoice | PaymentApproval>(
        `/invoices/${id}/pay`,
        amount ? { walletId, amount } : { walletId },
      ),
    cancel: (id: string, reason?: string) => this.post<Invoice>(`/invoices/${id}/cancel`, { reason }),
    schedules: () => this.get<InvoiceSchedule[]>('/invoice-schedules'),
    /** A recurring invoice; starting today sends the first one at once. */
    createSchedule: (input: CreateInvoiceScheduleInput) =>
      this.post<InvoiceSchedule>('/invoice-schedules', input),
    setScheduleStatus: (id: string, status: 'active' | 'paused' | 'ended') =>
      this.patch<InvoiceSchedule>(`/invoice-schedules/${id}`, { status }),
  };

  organizations = {
    mine: () => this.get<Organization[]>('/organizations/mine'),
    get: (slug: string) => this.get<Organization>(`/organizations/${encodeURIComponent(slug)}`),
    /** approvalLimit: payments of at least this much need two people ("" turns it off). */
    update: (id: string, input: { description?: string; website?: string; approvalLimit?: string }) =>
      this.patch<Organization>(`/organizations/${id}`, input),
    members: (id: string) => this.get<OrgMember[]>(`/organizations/${id}/members`),
    addMember: (id: string, username: string, role: Exclude<OrgRole, 'owner'>) =>
      this.post<OrgMember>(`/organizations/${id}/members`, { username, role }),
    removeMember: (id: string, userId: string) => this.del(`/organizations/${id}/members/${userId}`),
    wallets: (id: string) => this.get<Wallet[]>(`/organizations/${id}/wallets`),
    openWallet: (id: string, currency: string) =>
      this.post<Wallet>(`/organizations/${id}/wallets`, { currency }),
    paymentApprovals: (id: string, status?: 'pending' | 'approved' | 'rejected') =>
      this.get<PaymentApproval[]>(`/organizations/${id}/payment-approvals`, { status }),
    approvePayment: (id: string, approvalId: string) =>
      this.post<PaymentApproval>(`/organizations/${id}/payment-approvals/${approvalId}/approve`),
    payroll: (id: string) => this.get<PayrollRun[]>(`/organizations/${id}/payroll`),
    /** Pay many people at once; above the approval limit the run comes back "pending". */
    runPayroll: (id: string, input: PayrollInput) =>
      this.post<PayrollRun>(`/organizations/${id}/payroll`, input),
    /** Decline a waiting payment, or withdraw your own. */
    rejectPayment: (id: string, approvalId: string, reason: string) =>
      this.post<PaymentApproval>(`/organizations/${id}/payment-approvals/${approvalId}/reject`, { reason }),
  };

  exchange = {
    info: () => this.get<ExchangeInfo>('/exchange'),
    quote: (input: ExchangeInput) => this.post<ExchangeQuote>('/exchange/quote', input),
    /** Company exchanges of at least the approval limit come back as a PaymentApproval (HTTP 202). */
    execute: (input: ExchangeInput) => this.post<ExchangeResult | PaymentApproval>('/exchange', input),
  };

  files = {
    /** Upload a file (it stays private until attached, e.g. to an application). */
    upload: async (file: Blob, name: string) => {
      const res = await this.send('POST', `/files${qs({ name })}`, file);
      const text = await res.text();
      if (!res.ok) return OvlClient.fail(res, text);
      return JSON.parse(text) as FileInfo;
    },
    remove: (id: string) => this.del(`/files/${id}`),
    /** Absolute URL of a file link from the API (signed links work in <img> and <a>). */
    url: (path: string) => `${this.baseUrl}${path}`,
  };

  applications = {
    submit: (input: CreateApplicationInput & { attachments?: string[] }) =>
      this.post<Application>('/applications', input),
    /** Send a corrected application after a reviewer asked for changes. */
    resubmit: (id: string, payload: Record<string, unknown>, attachments?: string[]) =>
      this.post<Application>(`/applications/${id}/resubmit`, { payload, attachments }),
    mine: () => this.get<Application[]>('/applications/mine'),
    queue: () => this.get<Application[]>('/applications/queue'),
    list: (query?: { status?: string; type?: string; limit?: number; offset?: number }) =>
      this.get<Page<Application>>('/applications', query),
    get: (id: string) => this.get<Application>(`/applications/${id}`),
    review: (id: string, input: ReviewInput) => this.post<Application>(`/applications/${id}/review`, input),
    withdraw: (id: string) => this.post<Application>(`/applications/${id}/withdraw`),
  };

  registry = {
    search: (query: RegistrySearchQuery = {}) => this.get<Page<RegistryEntry>>('/registry', query as Query),
    get: (idOrNumber: string) => this.get<RegistryEntry>(`/registry/${encodeURIComponent(idOrNumber)}`),
    /** The public certificate PDF (no token needed): open it in a browser tab or download it. */
    certificateUrl: (idOrNumber: string, download = false) =>
      `${this.baseUrl}/api/v1/registry/${encodeURIComponent(idOrNumber)}/certificate.pdf${download ? '?download=1' : ''}`,
  };

  stock = {
    listings: (status?: 'active' | 'halted' | 'delisted') =>
      this.get<StockListing[]>('/stock/listings', { status }),
    listing: (ticker: string) =>
      this.get<StockListingDetail>(`/stock/listings/${encodeURIComponent(ticker)}`),
    invest: (ticker: string, amount: string) =>
      this.post<Investment>(`/stock/listings/${encodeURIComponent(ticker)}/invest`, { amount }),
    portfolio: () => this.get<{ holdings: Holding[]; investments: Investment[] }>('/stock/portfolio'),
  };

  chats = {
    list: () => this.get<Chat[]>('/chats'),
    get: (id: string) => this.get<Chat>(`/chats/${id}`),
    direct: (userId: string) => this.post<Chat>('/chats/direct', { userId }),
    createGroup: (input: { title: string; description?: string; memberIds: string[] }) =>
      this.post<Chat>('/chats/groups', input),
    createChannel: (input: { title: string; handle: string; description?: string; ownerId?: string }) =>
      this.post<Chat>('/chats/channels', input),
    discoverChannels: (q?: string) => this.get<Chat[]>('/channels', { q }),
    update: (id: string, input: { title?: string; description?: string }) =>
      this.patch<Chat>(`/chats/${id}`, input),
    pin: (id: string, pinned: boolean) => this.patch<void>(`/chats/${id}/pin`, { pinned }),
    members: (id: string) => this.get<ChatMember[]>(`/chats/${id}/members`),
    invite: (id: string, userIds: string[]) => this.post<Chat>(`/chats/${id}/members`, { userIds }),
    removeMember: (id: string, userId: string) => this.del(`/chats/${id}/members/${userId}`),
    join: (id: string) => this.post<Chat>(`/chats/${id}/join`),
    messages: (id: string, query?: { before?: number; limit?: number }) =>
      this.get<Message[]>(`/chats/${id}/messages`, query),
    send: (id: string, body: string, replyToId?: number) =>
      this.post<Message>(`/chats/${id}/messages`, { body, replyToId }),
    edit: (id: string, messageId: number, body: string) =>
      this.patch<Message>(`/chats/${id}/messages/${messageId}`, { body }),
    deleteMessage: (id: string, messageId: number) => this.del(`/chats/${id}/messages/${messageId}`),
    read: (id: string, messageId: number) => this.post<void>(`/chats/${id}/read`, { messageId }),
  };

  support = {
    create: (subject: string, body: string) => this.post<Chat>('/support/tickets', { subject, body }),
    mine: () => this.get<Chat[]>('/support/tickets'),
    desk: (status: 'open' | 'closed' = 'open') => this.get<Chat[]>('/support/desk', { status }),
    setStatus: (id: string, status: 'open' | 'closed') =>
      this.post<Chat>(`/support/tickets/${id}/status`, { status }),
  };

  stories = {
    list: () => this.get<Story[]>('/stories'),
    publish: (input: CreateStoryInput) => this.post<Story>('/stories', input),
    view: (id: string) => this.post<void>(`/stories/${id}/view`),
    delete: (id: string) => this.del(`/stories/${id}`),
  };

  apiKeys = {
    list: () => this.get<ApiKey[]>('/api-keys'),
    create: (name: string) => this.post<ApiKey & { key: string }>('/api-keys', { name }),
    revoke: (id: string) => this.del(`/api-keys/${id}`),
  };

  admin = {
    stats: () => this.get<AdminStats>('/admin/stats'),
    users: (query?: { q?: string; role?: Role; status?: string; limit?: number; offset?: number }) =>
      this.get<Page<AdminUser>>('/admin/users', query),
    updateUser: (id: string, input: { role?: Role; status?: 'active' | 'suspended' }) =>
      this.patch<AdminUser>(`/admin/users/${id}`, input),
    organizations: (query?: { q?: string; limit?: number; offset?: number }) =>
      this.get<Page<Organization>>('/admin/organizations', query),
    setOrganizationStatus: (id: string, status: 'active' | 'suspended') =>
      this.patch<Organization>(`/admin/organizations/${id}`, { status }),
    findOwners: (q: string) =>
      this.get<{ type: 'user' | 'organization'; id: string; name: string; handle: string }[]>(
        '/admin/owners',
        { q },
      ),
    wallets: (ownerType: 'user' | 'organization', ownerId: string) =>
      this.get<Wallet[]>('/admin/wallets', { ownerType, ownerId }),
    cashOperations: (query?: { limit?: number; offset?: number }) =>
      this.get<Page<CashOperation>>('/admin/cash-operations', query),
    /** Large amounts come back as a CashApproval waiting for a second manager (HTTP 202). */
    cashOperation: (input: CashOperationInput) =>
      this.post<CashOperation | CashApproval>('/admin/cash-operations', input),
    cashApprovals: (status?: 'pending' | 'approved' | 'rejected') =>
      this.get<CashApproval[]>('/admin/cash-approvals', { status }),
    /** Base currency, fee and rates; a null rate removes a currency. */
    setExchange: (input: {
      base?: string;
      feePercent?: string;
      rates?: { currency: string; rate: string | null }[];
    }) => this.put<ExchangeInfo>('/admin/exchange', input),
    approveCash: (id: string) => this.post<CashApproval>(`/admin/cash-approvals/${id}/approve`),
    rejectCash: (id: string, reason: string) =>
      this.post<CashApproval>(`/admin/cash-approvals/${id}/reject`, { reason }),
    cashRequests: (status?: CashRequestStatus) => this.get<CashRequest[]>('/admin/cash-requests', { status }),
    identityChecks: (status?: 'pending' | 'approved' | 'rejected' | 'revoked') =>
      this.get<IdentityCheck[]>('/admin/identity-checks', { status }),
    decideIdentity: (id: string, action: 'approve' | 'reject' | 'revoke', reason?: string) =>
      this.post<IdentityCheck>(`/admin/identity-checks/${id}/${action}`, reason ? { reason } : {}),
    completeCashRequest: (id: string, input: { reference: string; note?: string }) =>
      this.post<CashRequest>(`/admin/cash-requests/${id}/complete`, input),
    declineCashRequest: (id: string, reason: string) =>
      this.post<CashRequest>(`/admin/cash-requests/${id}/decline`, { reason }),
    setRegistryStatus: (id: string, status: 'active' | 'suspended' | 'revoked', reason?: string) =>
      this.patch<RegistryEntry>(`/admin/registry/${id}`, { status, reason }),
    updateListing: (
      id: string,
      input: {
        sharePrice?: string;
        status?: 'active' | 'halted' | 'delisted';
        freezePercent?: number;
        lockDays?: number;
      },
    ) => this.patch<StockListing>(`/admin/stock/listings/${id}`, input),
    auditLogs: (query?: { action?: string; limit?: number; offset?: number }) =>
      this.get<Page<AuditLog>>('/admin/audit-logs', query),
    apiKeys: (query?: { limit?: number; offset?: number }) =>
      this.get<Page<ApiKey>>('/admin/api-keys', query),
    revokeApiKey: (id: string) => this.del(`/admin/api-keys/${id}`),
    signOutUser: (id: string) => this.post<{ signedOut: number }>(`/admin/users/${id}/sign-out`),
  };
}
