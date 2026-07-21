import { Organization, User } from '@prisma/client';
import type { OrgSummary, UserSummary } from '@rezo/shared-types';

/** Maps DB rows to the snake_case API shapes (spec §15). */
export function toOrgSummary(org: Organization): OrgSummary {
  return {
    id: org.id,
    type: org.type,
    legal_name: org.legalName,
    country: org.country,
    kyc_status: org.kycStatus,
    status: org.status,
  };
}

export function toUserSummary(user: User): UserSummary {
  return {
    id: user.id,
    org_id: user.orgId,
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
  };
}
