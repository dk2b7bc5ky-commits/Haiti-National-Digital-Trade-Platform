import { IsIn, IsString } from 'class-validator';
import type { SubscriptionPlan, SubscriptionTerm } from '@rezo/shared-types';

const PLANS: SubscriptionPlan[] = ['small_broker', 'large_broker', 'line', 'terminal', 'trucker', 'importer'];
const TERMS: SubscriptionTerm[] = ['monthly', 'annual'];

export class CreateSubscriptionDto {
  @IsString()
  org_id!: string;

  @IsIn(PLANS)
  plan!: SubscriptionPlan;

  @IsIn(TERMS)
  term!: SubscriptionTerm;
}
