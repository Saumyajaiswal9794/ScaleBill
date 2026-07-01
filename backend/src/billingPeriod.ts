export type BillingPeriod = {
  periodKey: string;
  periodStart: Date;
  periodEnd: Date;
};

function daysInMonth(year: number, monthIndex: number) {
  return new Date(year, monthIndex + 1, 0).getDate();
}

function clampAnchorDay(anchorDay: number, year: number, monthIndex: number) {
  return Math.min(Math.max(anchorDay, 1), daysInMonth(year, monthIndex));
}

export function getTenantBillingAnchorDay(tenant: { billingAnchorDay?: number; createdAt?: Date | string }) {
  if (typeof tenant.billingAnchorDay === 'number' && tenant.billingAnchorDay > 0) {
    return tenant.billingAnchorDay;
  }

  const createdAt = tenant.createdAt instanceof Date ? tenant.createdAt : new Date(tenant.createdAt || Date.now());
  return createdAt.getDate();
}

function buildPeriodStart(referenceDate: Date, billingAnchorDay: number) {
  const year = referenceDate.getFullYear();
  const monthIndex = referenceDate.getMonth();
  const currentAnchorDay = clampAnchorDay(billingAnchorDay, year, monthIndex);
  const currentMonthStart = new Date(year, monthIndex, currentAnchorDay, 0, 0, 0, 0);

  if (referenceDate >= currentMonthStart) {
    return currentMonthStart;
  }

  const previousMonth = new Date(year, monthIndex - 1, 1);
  const previousAnchorDay = clampAnchorDay(
    billingAnchorDay,
    previousMonth.getFullYear(),
    previousMonth.getMonth()
  );
  return new Date(previousMonth.getFullYear(), previousMonth.getMonth(), previousAnchorDay, 0, 0, 0, 0);
}

export function getBillingPeriod(referenceDate: Date, billingAnchorDay: number): BillingPeriod {
  const periodStart = buildPeriodStart(referenceDate, billingAnchorDay);
  const nextMonth = new Date(periodStart.getFullYear(), periodStart.getMonth() + 1, 1);
  const nextAnchorDay = clampAnchorDay(
    billingAnchorDay,
    nextMonth.getFullYear(),
    nextMonth.getMonth()
  );
  const periodEnd = new Date(nextMonth.getFullYear(), nextMonth.getMonth(), nextAnchorDay, 0, 0, 0, 0);
  periodEnd.setMilliseconds(periodEnd.getMilliseconds() - 1);

  const month = String(periodStart.getMonth() + 1).padStart(2, '0');
  return {
    periodKey: `${periodStart.getFullYear()}-${month}`,
    periodStart,
    periodEnd
  };
}

export function getRedisUsageKey(tenantId: string, metric: 'api_calls' | 'storage_gb' | 'bandwidth_gb', periodKey: string) {
  return `usage:${tenantId}:${metric}:${periodKey}`;
}