export interface PlanDetails {
  baseFee: number;
  apiLimit: number;
  apiOverageRate: number; // ₹ per api call over limit
  storageLimit: number; // GB
  storageOverageRate: number; // ₹ per GB over limit
  bandwidthLimit: number; // GB
  bandwidthOverageRate: number; // ₹ per GB over limit
}

export const PLAN_PRICING: Record<'Starter' | 'Pro' | 'Enterprise', PlanDetails> = {
  Starter: {
    baseFee: 999,
    apiLimit: 10000,
    apiOverageRate: 1.0,
    storageLimit: 5,
    storageOverageRate: 10.0,
    bandwidthLimit: 50,
    bandwidthOverageRate: 2.0
  },
  Pro: {
    baseFee: 4999,
    apiLimit: 100000,
    apiOverageRate: 0.5,
    storageLimit: 50,
    storageOverageRate: 5.0,
    bandwidthLimit: 500,
    bandwidthOverageRate: 1.0
  },
  Enterprise: {
    baseFee: 19999,
    apiLimit: 1000000,
    apiOverageRate: 0.2,
    storageLimit: 500,
    storageOverageRate: 2.0,
    bandwidthLimit: 5000,
    bandwidthOverageRate: 0.5
  }
};

export interface UsageSummary {
  api_calls: number;
  storage_gb: number;
  bandwidth_gb: number;
}

export interface CalculationResult {
  planType: 'Starter' | 'Pro' | 'Enterprise';
  baseFee: number;
  apiOverage: number;
  storageOverage: number;
  bandwidthOverage: number;
  totalOverage: number;
  totalFee: number;
}

/**
 * Calculates current accrued billing charges based on usage and plan type.
 * Performance is O(1) as details are looked up directly from pre-defined plan settings.
 */
export function calculateBilling(
  planType: 'Starter' | 'Pro' | 'Enterprise',
  usage: UsageSummary
): CalculationResult {
  const plan = PLAN_PRICING[planType];
  if (!plan) {
    throw new Error(`Plan pricing settings not found for: ${planType}`);
  }

  // API Call overage
  const apiDiff = usage.api_calls - plan.apiLimit;
  const apiOverage = apiDiff > 0 ? apiDiff * plan.apiOverageRate : 0;

  // Storage overage
  const storageDiff = usage.storage_gb - plan.storageLimit;
  const storageOverage = storageDiff > 0 ? storageDiff * plan.storageOverageRate : 0;

  // Bandwidth overage
  const bandwidthDiff = usage.bandwidth_gb - plan.bandwidthLimit;
  const bandwidthOverage = bandwidthDiff > 0 ? bandwidthDiff * plan.bandwidthOverageRate : 0;

  const totalOverage = apiOverage + storageOverage + bandwidthOverage;
  const totalFee = plan.baseFee + totalOverage;

  return {
    planType,
    baseFee: plan.baseFee,
    apiOverage,
    storageOverage,
    bandwidthOverage,
    totalOverage,
    totalFee: parseFloat(totalFee.toFixed(2))
  };
}
