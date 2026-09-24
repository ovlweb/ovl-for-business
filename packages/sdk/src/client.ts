import type {
  AdminStats,
  AdminUser,
  ApiKey,
  Application,
  AuditLog,
  AuthResult,
  CashOperation,
  CashOperationInput,
  Chat,
  ChatMember,
  Contact,
  CreateApplicationInput,
  CreateStoryInput,
  FundLock,
  Holding,
  Investment,
  LedgerEntry,
  LoginInput,
  Me,
  Message,
  Organization,
  OrgMember,
  Preferences,
  OrgRole,
  RegisterInput,
  RegistryEntry,
  RegistrySearchQuery,
  Session,
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

  async request<T>(method: string, path: string, body?: unknown, retry = true): Promise<T> {
    const headers: Record<string, string> = { accept: 'application/json' };
    const tokens = this.tokens.get();
    if (tokens) headers.authorization = `Bearer ${tokens.accessToken}`;
    if (this.apiKey) headers['x-api-key'] = this.apiKey;
    if (body !== undefined) headers['content-type'] = 'application/json';

    const res = await this.fetchImpl(`${this.baseUrl}/api/v1${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (res.status === 401 && retry && tokens && !path.startsWith('/auth/')) {
      if (await this.refresh()) return this.request<T>(method, path, body, false);
    }
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    const data = text ? JSON.parse(text) : undefined;
    if (!res.ok) {
      throw new OvlApiError(
        res.status,
        data?.error ?? 'error',
        data?.message ?? res.statusText,
        data?.details,
      );
    }
    return data as T;
  }

  private get<T>(path: string, query?: Query) {
    return this.request<T>('GET', path + qs(query));
  }
  private post<T>(path: string, body: unknown = {}) {
    return this.request<T>('POST', path, body);
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
    transfer: (input: TransferInput) => this.post<Wallet>('/wallets/transfer', input),
  };

  organizations = {
    mine: () => this.get<Organization[]>('/organizations/mine'),
    get: (slug: string) => this.get<Organization>(`/organizations/${encodeURIComponent(slug)}`),
    update: (id: string, input: { description?: string; website?: string }) =>
      this.patch<Organization>(`/organizations/${id}`, input),
    members: (id: string) => this.get<OrgMember[]>(`/organizations/${id}/members`),
    addMember: (id: string, username: string, role: Exclude<OrgRole, 'owner'>) =>
      this.post<OrgMember>(`/organizations/${id}/members`, { username, role }),
    removeMember: (id: string, userId: string) => this.del(`/organizations/${id}/members/${userId}`),
    wallets: (id: string) => this.get<Wallet[]>(`/organizations/${id}/wallets`),
    openWallet: (id: string, currency: string) =>
      this.post<Wallet>(`/organizations/${id}/wallets`, { currency }),
  };

  applications = {
    submit: (input: CreateApplicationInput) => this.post<Application>('/applications', input),
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
    cashOperation: (input: CashOperationInput) => this.post<CashOperation>('/admin/cash-operations', input),
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
