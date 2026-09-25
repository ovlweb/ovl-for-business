import {
  resolveQuorum,
  WORKFLOWS,
  type Application,
  type ApproverGroup,
  type ReviewInput,
  type Role,
  type WorkflowStage,
} from '@ovl/shared';
import { and, count, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Config } from '../../config';
import type { Db } from '../../db/client';
import { applicationReviews, applications, users } from '../../db/schema';
import { badRequest, conflict, forbidden, HttpError, isUniqueViolation, notFound } from '../../lib/errors';
import { iso, isoOrNull, summaryColumns, toUserSummary } from '../../lib/mappers';
import { getStaffChat, insertMessage, type ChatRow, type MessageRow } from '../chats/service';
import { fileDtos, filesOf } from '../files';
import { applyApprovedApplication, type EffectResult } from './effects';
import { loadGovernance } from '../../lib/governance';

export type ApplicationRow = typeof applications.$inferSelect;
type ReviewRow = typeof applicationReviews.$inferSelect;

const OWNER_OVERRIDE: ApproverGroup = { roles: ['owner'], quorum: 1 };

export function currentStage(application: ApplicationRow): WorkflowStage | null {
  if (application.status !== 'pending') return null;
  return WORKFLOWS[application.type].stages[application.stageIndex] ?? null;
}

/** Approver groups of a stage including the owner override. */
function stageGroups(stage: WorkflowStage): ApproverGroup[] {
  return stage.approvers.some((g) => g.roles.includes('owner'))
    ? stage.approvers
    : [...stage.approvers, OWNER_OVERRIDE];
}

export function canReviewStage(stage: WorkflowStage, role: Role): boolean {
  return stageGroups(stage).some((g) => g.roles.includes(role));
}

export async function activeCouncilSize(db: Db): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(users)
    .where(and(eq(users.role, 'council'), eq(users.status, 'active')));
  return row?.n ?? 0;
}

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

export async function applicationDtos(app: FastifyInstance, rows: ApplicationRow[]): Promise<Application[]> {
  if (!rows.length) return [];
  const db = app.db;
  const attachments = await filesOf(
    db,
    'application',
    rows.map((a) => a.id),
  );
  const reviews = await db
    .select({ review: applicationReviews, reviewer: summaryColumns(users) })
    .from(applicationReviews)
    .innerJoin(users, eq(users.id, applicationReviews.reviewerId))
    .where(
      inArray(
        applicationReviews.applicationId,
        rows.map((a) => a.id),
      ),
    )
    .orderBy(applicationReviews.createdAt);
  const applicants = await db
    .select(summaryColumns(users))
    .from(users)
    .where(
      inArray(
        users.id,
        rows.map((a) => a.applicantId),
      ),
    );
  const applicantBy = new Map(applicants.map((u) => [u.id, toUserSummary(u)]));
  return rows.map((a) => ({
    id: a.id,
    type: a.type,
    status: a.status,
    stageIndex: a.stageIndex,
    currentStage: currentStage(a)?.key ?? null,
    applicant: applicantBy.get(a.applicantId)!,
    payload: a.payload,
    result: a.result,
    rejectionReason: a.rejectionReason,
    changesRequested:
      a.status === 'changes_requested'
        ? (reviews
            .filter((r) => r.review.applicationId === a.id && r.review.decision === 'request_changes')
            .at(-1)?.review.comment ?? '')
        : null,
    round: a.round,
    attachments: fileDtos(
      app,
      attachments.filter((f) => f.scopeId === a.id),
    ),
    reviews: reviews
      .filter((r) => r.review.applicationId === a.id)
      .map(({ review, reviewer }) => ({
        id: review.id,
        stageKey: review.stageKey,
        reviewer: toUserSummary(reviewer),
        reviewerRole: review.reviewerRole,
        decision: review.decision,
        comment: review.comment,
        checklist: review.checklist,
        round: review.round,
        createdAt: iso(review.createdAt),
      })),
    createdAt: iso(a.createdAt),
    updatedAt: iso(a.updatedAt),
    decidedAt: isoOrNull(a.decidedAt),
  }));
}

// ---------------------------------------------------------------------------
// Staff chat announcements
// ---------------------------------------------------------------------------

export interface Announcement {
  chat: ChatRow;
  message: MessageRow;
}

function summarize(application: ApplicationRow): string {
  const p = application.payload as Record<string, unknown>;
  const name = (p.name ?? p.title ?? '') as string;
  return name ? `"${name}"` : '';
}

/** Post a card into the council / moderation chat when an application reaches a stage. */
export async function announceStage(db: Db, application: ApplicationRow, applicantUsername: string) {
  const stage = currentStage(application);
  if (!stage) return [];
  const roles = new Set(stage.approvers.flatMap((g) => g.roles));
  const targets = new Set<'council' | 'moderation'>();
  if (roles.has('council') || (roles.size === 1 && roles.has('owner'))) targets.add('council');
  if (roles.has('moderator') || roles.has('admin')) targets.add('moderation');
  const workflow = WORKFLOWS[application.type];
  const announcements: Announcement[] = [];
  for (const type of targets) {
    const chat = await getStaffChat(db, type);
    const message = await insertMessage(db, {
      chatId: chat.id,
      senderId: null,
      kind: 'system',
      body: `${workflow.label} ${summarize(application)} by @${applicantUsername} is waiting for: ${stage.label}`.replace(
        /\s+/g,
        ' ',
      ),
      meta: { applicationId: application.id, applicationType: application.type, stage: stage.key },
    });
    announcements.push({ chat, message });
  }
  return announcements;
}

// ---------------------------------------------------------------------------
// Reviews
// ---------------------------------------------------------------------------

export interface ReviewOutcome {
  application: ApplicationRow;
  effects: EffectResult | null;
  announcements: Announcement[];
}

export async function lockApplication(db: Db, id: string): Promise<ApplicationRow> {
  const [row] = await db.select().from(applications).where(eq(applications.id, id)).for('update');
  if (!row) throw notFound('Application');
  return row;
}

export async function reviewApplication(
  db: Db,
  config: Config,
  applicationId: string,
  reviewer: { id: string; role: Role; username: string },
  input: ReviewInput,
): Promise<ReviewOutcome> {
  const application = await lockApplication(db, applicationId);
  const stage = currentStage(application);
  if (!stage) throw conflict(`This application is already ${application.status}`);
  if (application.applicantId === reviewer.id) throw forbidden('You cannot review your own application');
  if (!canReviewStage(stage, reviewer.role))
    throw forbidden(`Your role cannot review the "${stage.label}" stage`);

  const checklist = input.checklist ?? [];
  if (input.decision === 'approve' && stage.checklist) {
    const missing = stage.checklist.filter((item) => !checklist.includes(item.key));
    if (missing.length) {
      throw badRequest('Confirm that you reviewed every part of the application before approving', {
        missing: missing.map((m) => m.key),
      });
    }
  }
  if (input.decision === 'reject' && !input.comment?.trim())
    throw badRequest('Give a reason for the rejection');
  if (input.decision === 'request_changes' && !input.comment?.trim())
    throw badRequest('Say what the applicant should change');
  if (
    input.decision === 'approve' &&
    application.type === 'company' &&
    config.REQUIRE_IDENTITY_FOR_COMPANIES
  ) {
    const [applicant] = await db
      .select({ identityVerifiedAt: users.identityVerifiedAt })
      .from(users)
      .where(eq(users.id, application.applicantId));
    if (!applicant?.identityVerifiedAt)
      throw new HttpError(
        409,
        'identity_not_verified',
        'The applicant has to pass an identity check first (Settings → Identity). Ask for changes or wait.',
      );
  }

  try {
    await db.insert(applicationReviews).values({
      applicationId,
      stageKey: stage.key,
      reviewerId: reviewer.id,
      reviewerRole: reviewer.role,
      decision: input.decision,
      comment: input.comment?.trim() ?? '',
      checklist: stage.checklist && input.decision === 'approve' ? checklist : null,
      round: application.round,
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw conflict('You already reviewed this stage');
    throw error;
  }

  const reviews: ReviewRow[] = await db
    .select()
    .from(applicationReviews)
    .where(
      and(
        eq(applicationReviews.applicationId, applicationId),
        eq(applicationReviews.stageKey, stage.key),
        eq(applicationReviews.round, application.round),
      ),
    );
  const [councilSize, rules] = await Promise.all([
    activeCouncilSize(db),
    loadGovernance(db, config.COUNCIL_QUORUM),
  ]);
  const tally = (group: ApproverGroup, decision: 'approve' | 'reject') =>
    reviews.filter((r) => r.decision === decision && group.roles.includes(r.reviewerRole)).length;
  const reached = (decision: 'approve' | 'reject') =>
    stageGroups(stage).some((g) => tally(g, decision) >= resolveQuorum(g, rules, councilSize));

  const now = new Date();
  let patch: Partial<ApplicationRow> = { updatedAt: now };
  let effects: EffectResult | null = null;

  if (input.decision === 'request_changes') {
    // One reviewer is enough to send it back; the stage starts over when it is resubmitted.
    patch = { ...patch, status: 'changes_requested' };
  } else if (reached('reject')) {
    patch = { ...patch, status: 'rejected', decidedAt: now, rejectionReason: input.comment?.trim() ?? null };
  } else if (reached('approve')) {
    const isLast = application.stageIndex >= WORKFLOWS[application.type].stages.length - 1;
    if (isLast) {
      effects = await applyApprovedApplication(db, config, application);
      patch = { ...patch, status: 'approved', decidedAt: now, result: effects.result };
    } else {
      patch = { ...patch, stageIndex: application.stageIndex + 1 };
    }
  }

  const [updated] = await db
    .update(applications)
    .set(patch)
    .where(eq(applications.id, applicationId))
    .returning();

  let announcements: Announcement[] = [];
  if (updated!.status === 'pending' && updated!.stageIndex !== application.stageIndex) {
    const [applicant] = await db
      .select({ username: users.username })
      .from(users)
      .where(eq(users.id, updated!.applicantId));
    announcements = await announceStage(db, updated!, applicant?.username ?? 'unknown');
  }
  return { application: updated!, effects, announcements };
}
