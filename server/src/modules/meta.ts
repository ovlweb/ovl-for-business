import {
  API_VERSION,
  APPLICATION_TYPES,
  CURRENCIES,
  LICENSE_TYPE_LABELS,
  PERMISSIONS,
  PLATFORM_NAME,
  ROLE_LABELS,
  WORKFLOWS,
} from '@ovl/shared';
import type { FastifyInstance } from 'fastify';
import { loadGovernance } from '../lib/governance';

/**
 * Static platform metadata so any client (including native apps written in other
 * languages) can render currencies, roles, license types and approval workflows.
 */
export async function metaRoutes(app: FastifyInstance) {
  app.get('/meta', { schema: { tags: ['meta'], security: [] } }, async () => ({
    name: PLATFORM_NAME,
    apiVersion: API_VERSION,
    currencies: CURRENCIES,
    roles: ROLE_LABELS,
    permissions: PERMISSIONS,
    licenseTypes: LICENSE_TYPE_LABELS,
    applicationTypes: APPLICATION_TYPES,
    workflows: WORKFLOWS,
    stock: {
      freezePercent: app.config.STOCK_FREEZE_PERCENT,
      lockDays: app.config.STOCK_LOCK_DAYS,
      lockDaysMin: app.config.STOCK_LOCK_DAYS_MIN,
      lockDaysMax: app.config.STOCK_LOCK_DAYS_MAX,
    },
    councilQuorum: (await loadGovernance(app.db, app.config.COUNCIL_QUORUM)).councilQuorum,
    security: {
      twoFactorForStaff: app.config.REQUIRE_2FA_FOR_STAFF,
      twoFactorForCompanyFinance: app.config.REQUIRE_2FA_FOR_COMPANY_FINANCE,
      verifiedEmailForApplications: app.config.REQUIRE_VERIFIED_EMAIL,
      identityForCompanies: app.config.REQUIRE_IDENTITY_FOR_COMPANIES,
    },
  }));
}
