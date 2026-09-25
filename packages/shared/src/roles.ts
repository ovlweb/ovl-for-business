/**
 * Platform roles. Every account has exactly one role; staff roles are granted
 * through registration applications (moderator, council) or by the owner/admins.
 *
 * - user       regular personal account (can own / join companies)
 * - moderator  reviews applications, answers tech support, creates news channels
 * - manager    finance desk: deposits / withdrawals through the admin panel
 * - council    votes on companies, licenses and council/moderator applications
 * - admin      platform administration
 * - owner      platform owner (single account, final license confirmation)
 */
export const ROLES = ['user', 'moderator', 'manager', 'council', 'admin', 'owner'] as const;
export type Role = (typeof ROLES)[number];

export const STAFF_ROLES: readonly Role[] = ['moderator', 'manager', 'council', 'admin', 'owner'];

export const ROLE_LABELS: Record<Role, string> = {
  user: 'User',
  moderator: 'Moderator',
  manager: 'Finance manager',
  council: 'Council member',
  admin: 'Administrator',
  owner: 'Owner',
};

export const PERMISSIONS = {
  /** Sign in to the separate admin panel. */
  'admin.panel': ['moderator', 'manager', 'admin', 'owner'],
  /** Answer tech-support tickets (council is intentionally excluded). */
  'support.answer': ['moderator', 'admin', 'owner'],
  /** Deposit / withdraw money (manager transfer or physical cash). */
  'wallet.cash': ['manager', 'admin', 'owner'],
  /** View any wallet and statement. */
  'wallet.view_all': ['manager', 'admin', 'owner'],
  /** Look up users in the admin panel. */
  'users.view': ['moderator', 'manager', 'admin', 'owner'],
  /** Suspend / reactivate accounts and change roles (see canAssignRole). */
  'users.manage': ['admin', 'owner'],
  /** Publish service stories shown to everyone in every client. */
  'stories.publish': ['council', 'admin', 'owner'],
  /** Create news channels directly (everyone else applies through moderation). */
  'channels.create': ['moderator', 'admin', 'owner'],
  /** Check people's identity documents (KYC) and grant or revoke "verified". */
  'identity.review': ['moderator', 'admin', 'owner'],
  /** See every application, not only the ones waiting for you. */
  'applications.view_all': ['moderator', 'council', 'admin', 'owner'],
  /** Suspend / revoke registry entries. */
  'registry.manage': ['admin', 'owner'],
  /** Change stock listing parameters (price, freeze %, lock period, status). */
  'stock.manage': ['admin', 'owner'],
  /** Suspend / reactivate organizations. */
  'organizations.manage': ['admin', 'owner'],
  /** Read the audit log. */
  'audit.view': ['admin', 'owner'],
  /** Revoke any developer API key. */
  'apikeys.manage': ['admin', 'owner'],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: Role, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}

export function isStaff(role: Role): boolean {
  return role !== 'user';
}

/**
 * Who may move an account from `currentRole` to `nextRole`.
 * The owner role is never assignable; admins can only manage non-privileged roles.
 */
export function canAssignRole(actor: Role, currentRole: Role, nextRole: Role): boolean {
  if (nextRole === 'owner' || currentRole === 'owner') return false;
  if (actor === 'owner') return true;
  if (actor === 'admin') {
    const manageable: Role[] = ['user', 'moderator', 'manager'];
    return manageable.includes(currentRole) && manageable.includes(nextRole);
  }
  return false;
}

/** Staff chats are synced with roles: council chat and moderation chat. */
export const COUNCIL_CHAT_ROLES: readonly Role[] = ['council', 'owner'];
export const MODERATION_CHAT_ROLES: readonly Role[] = ['moderator', 'admin', 'owner'];

export const BADGES = ['owner', 'admin', 'council', 'moderator', 'manager', 'support'] as const;
export type Badge = (typeof BADGES)[number];

export const BADGE_LABELS: Record<Badge, string> = {
  owner: 'Owner',
  admin: 'Admin',
  council: 'Council',
  moderator: 'Moderator',
  manager: 'Finance',
  support: 'Support',
};

/** Badges shown next to a profile in contacts, chats and search. */
export function badgesForRole(role: Role): Badge[] {
  switch (role) {
    case 'owner':
      return ['owner'];
    case 'admin':
      return ['admin'];
    case 'council':
      return ['council'];
    case 'moderator':
      return ['moderator'];
    case 'manager':
      return ['manager'];
    default:
      return [];
  }
}

/** Badge attached to a message written by staff inside a tech-support ticket. */
export function supportBadgeForRole(role: Role): Badge | null {
  if (role === 'owner') return 'owner';
  if (role === 'admin') return 'admin';
  if (role === 'moderator') return 'support';
  return null;
}
