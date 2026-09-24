import {
  badgesForRole,
  PERMISSIONS,
  type Me,
  type Permission,
  type Role,
  type UserSummary,
} from '@ovl/shared';
import type { users } from '../db/schema';

type UserRow = typeof users.$inferSelect;
type SummarySource = Pick<UserRow, 'id' | 'username' | 'displayName' | 'avatarUrl' | 'role'>;

export const iso = (d: Date) => d.toISOString();
export const isoOrNull = (d: Date | null | undefined) => (d ? d.toISOString() : null);

export function toUserSummary(u: SummarySource): UserSummary {
  return {
    id: u.id,
    username: u.username,
    displayName: u.displayName,
    avatarUrl: u.avatarUrl,
    role: u.role,
    badges: badgesForRole(u.role),
  };
}

export function permissionsFor(role: Role): Permission[] {
  return (Object.keys(PERMISSIONS) as Permission[]).filter((p) =>
    (PERMISSIONS[p] as readonly Role[]).includes(role),
  );
}

export function toMe(u: UserRow): Me {
  return {
    ...toUserSummary(u),
    email: u.email,
    bio: u.bio,
    status: u.status,
    permissions: permissionsFor(u.role),
    createdAt: iso(u.createdAt),
  };
}

/** Columns needed for toUserSummary, for use in select({...}). */
export function summaryColumns(t: typeof users) {
  return { id: t.id, username: t.username, displayName: t.displayName, avatarUrl: t.avatarUrl, role: t.role };
}
