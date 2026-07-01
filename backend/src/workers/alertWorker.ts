import { Alert, ITenant } from '../models';
import { redis } from '../db';
import { getBillingPeriod, getRedisUsageKey, getTenantBillingAnchorDay } from '../billingPeriod';

export async function checkTenantUsageAlerts(tenant: ITenant, referenceDate: Date = new Date()) {
  const metrics: Array<'api_calls' | 'storage_gb' | 'bandwidth_gb'> = [
    'api_calls',
    'storage_gb',
    'bandwidth_gb'
  ];

  const billingAnchorDay = getTenantBillingAnchorDay(tenant);
  const currentPeriod = getBillingPeriod(referenceDate, billingAnchorDay);
  const results: string[] = [];

  for (const metric of metrics) {
    // Get limit from Tenant info
    let limit = 0;
    if (metric === 'api_calls') limit = tenant.apiLimit;
    if (metric === 'storage_gb') limit = tenant.storageLimit;
    if (metric === 'bandwidth_gb') limit = tenant.bandwidthLimit;

    if (limit <= 0) continue;

    // Get current usage from Redis
  const redisKey = getRedisUsageKey(tenant.tenantId, metric, currentPeriod.periodKey);
    const usageStr = await redis.get(redisKey);
    const usage = usageStr ? parseFloat(usageStr) : 0;

    const usageRatio = usage / limit;

    let threshold: '80%' | '95%' | null = null;
    if (usageRatio >= 0.95) {
      threshold = '95%';
    } else if (usageRatio >= 0.8) {
      threshold = '80%';
    }

    if (threshold) {
      // Check if we already alerted this threshold for this metric in the current billing period
      const recentAlert = await Alert.findOne({
        tenantId: tenant.tenantId,
        metric,
        thresholdType: threshold,
        periodKey: currentPeriod.periodKey
      });

      if (!recentAlert) {
        // Create new alert
        const alert = new Alert({
          tenantId: tenant.tenantId,
          metric,
          thresholdType: threshold,
          usageValue: usage,
          limitValue: limit,
          periodKey: currentPeriod.periodKey
        });
        await alert.save();

        const message = `Alert: Tenant ${tenant.name} (${tenant.tenantId}) has consumed ${Math.round(usageRatio * 100)}% of their ${metric} limit (${usage}/${limit})`;
        console.log(`[AWS SNS] Triggered alert notification topic: ${process.env.SNS_ALERT_TOPIC_ARN || 'billing-alerts-arn'}`);
        console.log(`[AWS SNS Message]: ${message}`);
        results.push(message);
      }
    }
  }

  return results;
}
