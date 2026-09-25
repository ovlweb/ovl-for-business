import { z } from 'zod';
import { CURRENCY_CODES } from './currencies';
import type { Role } from './roles';

/**
 * Everything that needs approval goes through an application ("suggestion")
 * that walks through ordered stages. A stage passes as soon as ANY of its
 * approver groups collects `quorum` approvals; it fails as soon as any group
 * collects `quorum` rejections.
 *
 * `quorum: 'council'` means the configured council quorum (COUNCIL_QUORUM),
 * capped by the number of active council members so a small council can still
 * work. The owner may always act on any stage as an override (single vote).
 */
export const APPLICATION_TYPES = ['company', 'license', 'moderator', 'council', 'news_channel'] as const;
export type ApplicationType = (typeof APPLICATION_TYPES)[number];

export const APPLICATION_STATUSES = [
  'pending',
  'changes_requested',
  'approved',
  'rejected',
  'withdrawn',
] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export interface ApproverGroup {
  roles: Role[];
  quorum: number | 'council';
}

export interface ChecklistItem {
  key: string;
  label: string;
}

export interface WorkflowStage {
  key: string;
  label: string;
  description: string;
  approvers: ApproverGroup[];
  /** Items every approving reviewer must explicitly confirm they reviewed. */
  checklist?: ChecklistItem[];
}

export interface Workflow {
  label: string;
  description: string;
  stages: WorkflowStage[];
}

const moderationGroup: ApproverGroup = { roles: ['moderator', 'admin', 'owner'], quorum: 1 };
const councilGroup: ApproverGroup = { roles: ['council'], quorum: 'council' };
const adminGroup: ApproverGroup = { roles: ['admin', 'owner'], quorum: 1 };
const ownerGroup: ApproverGroup = { roles: ['owner'], quorum: 1 };

export const WORKFLOWS: Record<ApplicationType, Workflow> = {
  company: {
    label: 'Company / business account',
    description:
      'Registers a company with its business license in the public registry and (optionally) lists it on the stock exchange.',
    stages: [
      {
        key: 'moderation',
        label: 'Moderation review',
        description: 'A moderator must confirm they reviewed every part of the company file.',
        approvers: [moderationGroup],
        checklist: [
          { key: 'identity', label: 'Applicant identity and contact details' },
          { key: 'company', label: 'Company name, description and website' },
          { key: 'business_plan', label: 'Business plan and activity' },
          { key: 'license', label: 'Requested business license' },
          { key: 'listing', label: 'Stock listing parameters (ticker, share price, share count)' },
        ],
      },
      {
        key: 'approval',
        label: 'Council or administration approval',
        description: 'Approved by the council quorum, or by an admin / the owner.',
        approvers: [councilGroup, adminGroup],
      },
    ],
  },
  license: {
    label: 'License',
    description:
      'Virtual licenses (projects, fan-projects, TV / radio channels, websites, virtual countries…). Published to the public registry after all confirmations.',
    stages: [
      {
        key: 'moderation',
        label: 'Moderation',
        description: 'A moderator checks the request and confirms it is virtual-only.',
        approvers: [moderationGroup],
        checklist: [
          { key: 'holder', label: 'License holder' },
          { key: 'content', label: 'Title, description and supporting links' },
          { key: 'virtual_only', label: 'The license covers virtual things only (nothing physical)' },
        ],
      },
      {
        key: 'council',
        label: 'Council vote',
        description: 'Council members vote until the quorum is reached.',
        approvers: [councilGroup],
      },
      {
        key: 'owner',
        label: 'Owner confirmation',
        description: 'Final confirmation by the owner, then rollout to the public registry.',
        approvers: [ownerGroup],
      },
    ],
  },
  moderator: {
    label: 'Join the moderation team',
    description: 'Become a moderator: review applications, answer tech support and manage channels.',
    stages: [
      {
        key: 'council',
        label: 'Council vote',
        description: 'Council members vote on the candidate.',
        approvers: [councilGroup, adminGroup],
      },
      {
        key: 'administration',
        label: 'Administration confirmation',
        description: 'An admin or the owner grants the role.',
        approvers: [adminGroup],
      },
    ],
  },
  council: {
    label: 'Join the council',
    description: 'Become a council member with a vote on companies, licenses and new members.',
    stages: [
      {
        key: 'council',
        label: 'Council vote',
        description: 'Current council members vote on the candidate.',
        approvers: [councilGroup],
      },
      {
        key: 'owner',
        label: 'Owner confirmation',
        description: 'The owner confirms the new council member.',
        approvers: [ownerGroup],
      },
    ],
  },
  news_channel: {
    label: 'News channel',
    description: 'News channels can only be created through moderation.',
    stages: [
      {
        key: 'moderation',
        label: 'Moderation',
        description: 'A moderator approves the channel.',
        approvers: [moderationGroup],
      },
    ],
  },
};

export const LICENSE_TYPES = [
  'project',
  'fan_project',
  'tv_channel',
  'radio_channel',
  'verified_website',
  'virtual_country',
  'media',
  'software',
  'game',
  'community',
  'business',
  'other',
] as const;
export type LicenseType = (typeof LICENSE_TYPES)[number];

export const LICENSE_TYPE_LABELS: Record<LicenseType, string> = {
  project: 'Project',
  fan_project: 'Fan-project',
  tv_channel: 'TV channel',
  radio_channel: 'Radio channel',
  verified_website: 'Verified website',
  virtual_country: 'Virtual country',
  media: 'Media / publication',
  software: 'Software / service',
  game: 'Game / game server',
  community: 'Community',
  business: 'Business license',
  other: 'Other (virtual)',
};

// ---------------------------------------------------------------------------
// Application payloads
// ---------------------------------------------------------------------------

const text = (min: number, max: number) => z.string().trim().min(min).max(max);
const optionalUrl = z.union([z.url({ protocol: /^https?$/ }), z.literal('')]).optional();

export const tickerSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z][A-Z0-9]{1,5}$/, 'Ticker must be 2-6 characters (A-Z, 0-9), starting with a letter');

export const decimalAmountSchema = z
  .string()
  .trim()
  .regex(/^\d{1,24}(\.\d+)?$/, 'Use a positive decimal number such as "100" or "99.95"');

export const currencyCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .refine((c) => CURRENCY_CODES.includes(c), 'Unsupported currency');

export const handleSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z][a-z0-9_]{3,31}$/, '4-32 characters: letters, digits and underscore, starting with a letter');

export const companyApplicationSchema = z.object({
  name: text(2, 120),
  description: text(10, 5000),
  website: optionalUrl,
  country: text(0, 120).optional(),
  baseCurrency: currencyCodeSchema,
  businessPlan: text(10, 10000),
  contactEmail: z.email().optional(),
  listOnExchange: z.boolean().default(false),
  listing: z
    .object({
      ticker: tickerSchema,
      sharePrice: decimalAmountSchema,
      totalShares: z.coerce.number().int().min(1).max(1_000_000_000_000),
    })
    .optional(),
});

export const licenseApplicationSchema = z.object({
  licenseType: z.enum(LICENSE_TYPES).exclude(['business']),
  title: text(2, 200),
  description: text(10, 5000),
  website: optionalUrl,
  /** Issue the license to one of your companies instead of to you personally. */
  organizationId: z.uuid().optional(),
  details: text(0, 5000).optional(),
});

export const staffApplicationSchema = z.object({
  motivation: text(20, 5000),
  experience: text(0, 5000).optional(),
});

export const newsChannelApplicationSchema = z.object({
  title: text(2, 128),
  handle: handleSchema,
  description: text(10, 2000),
});

export const applicationPayloadSchemas = {
  company: companyApplicationSchema,
  license: licenseApplicationSchema,
  moderator: staffApplicationSchema,
  council: staffApplicationSchema,
  news_channel: newsChannelApplicationSchema,
} as const satisfies Record<ApplicationType, z.ZodType>;

export const createApplicationSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('company'), payload: companyApplicationSchema }),
  z.object({ type: z.literal('license'), payload: licenseApplicationSchema }),
  z.object({ type: z.literal('moderator'), payload: staffApplicationSchema }),
  z.object({ type: z.literal('council'), payload: staffApplicationSchema }),
  z.object({ type: z.literal('news_channel'), payload: newsChannelApplicationSchema }),
]);
export type CreateApplicationInput = z.input<typeof createApplicationSchema>;

export type CompanyApplication = z.infer<typeof companyApplicationSchema>;
export type LicenseApplication = z.infer<typeof licenseApplicationSchema>;
export type StaffApplication = z.infer<typeof staffApplicationSchema>;
export type NewsChannelApplication = z.infer<typeof newsChannelApplicationSchema>;

/** Resolve the numeric quorum of an approver group. */
export function resolveQuorum(
  group: ApproverGroup,
  councilQuorum: number,
  activeCouncilMembers: number,
): number {
  if (group.quorum !== 'council') return group.quorum;
  return Math.max(1, Math.min(councilQuorum, activeCouncilMembers));
}
