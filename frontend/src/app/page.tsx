'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/authContext';
import { useRouter } from 'next/navigation';
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  Bell,
  CheckCircle,
  Clock3,
  Database,
  DollarSign,
  FileText,
  HardDrive,
  Network,
  PlusCircle,
  RefreshCw,
  Shield,
  Sparkles,
  Sliders,
  TrendingUp,
  User,
  LogOut,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

type MetricName = 'api_calls' | 'storage_gb' | 'bandwidth_gb';

interface Tenant {
  tenantId: string;
  name: string;
  planType: 'Starter' | 'Pro' | 'Enterprise';
  email: string;
  apiLimit: number;
  storageLimit: number;
  bandwidthLimit: number;
  billingAnchorDay?: number;
}

interface Billing {
  planType: string;
  baseFee: number;
  apiOverage: number;
  storageOverage: number;
  bandwidthOverage: number;
  totalOverage: number;
  totalFee: number;
}

interface Invoice {
  _id: string;
  invoiceNumber: string;
  periodStart: string;
  periodEnd: string;
  baseFee: number;
  overageFee: number;
  totalFee: number;
  usageSummary: {
    api_calls: number;
    storage_gb: number;
    bandwidth_gb: number;
  };
  pdfPath: string;
  status: 'Paid' | 'Pending' | 'Overdue';
  emailSent: boolean;
}

interface AlertItem {
  _id: string;
  metric: MetricName;
  thresholdType: string;
  usageValue: number;
  limitValue: number;
  createdAt: string;
}

interface HistoryItem {
  name: string;
  api_calls: number;
  storage_gb: number;
  bandwidth_gb: number;
}

interface DashboardData {
  tenant: Tenant;
  usage: Record<MetricName, number>;
  billing: Billing;
  monthlyBreakdown: Array<{
    metric: MetricName;
    eventCount: number;
    totalUsage: number;
    charge: number;
  }>;
  currentPeriod: {
    periodKey: string;
    periodStart: string;
    periodEnd: string;
  };
  invoices: Invoice[];
  alerts: AlertItem[];
  history: HistoryItem[];
}

interface UtilizationCard {
  key: MetricName;
  label: string;
  value: string;
  limit: string;
  percent: number;
}

type DashboardMode = 'overview' | 'monthly';

const API_BASE = 'http://localhost:4000/api';
const BACKEND_URL = 'http://localhost:4000';

const metricCopy: Record<MetricName, { label: string; shortLabel: string; icon: React.ReactNode }> = {
  api_calls: { label: 'API calls', shortLabel: 'Requests', icon: <Activity size={18} /> },
  storage_gb: { label: 'Storage', shortLabel: 'GB stored', icon: <HardDrive size={18} /> },
  bandwidth_gb: { label: 'Bandwidth', shortLabel: 'GB transferred', icon: <Network size={18} /> },
};

const metricOptions: Array<{ value: MetricName; label: string }> = [
  { value: 'api_calls', label: 'API Calls' },
  { value: 'storage_gb', label: 'Storage (GB)' },
  { value: 'bandwidth_gb', label: 'Bandwidth (GB)' },
];

const currency = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

function formatCurrency(value: number) {
  return currency.format(value);
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function getUsagePercentage(current: number, limit: number) {
  if (limit <= 0) return 0;
  return Math.min(100, Math.round((current / limit) * 100));
}

function getBand(percent: number) {
  if (percent >= 95) return 'danger';
  if (percent >= 80) return 'warning';
  return 'normal';
}export default function Home() {
  const { user, loading: authLoading, logout, getAuthHeaders } = useAuth();
  const router = useRouter();

  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [selectedTenantId, setSelectedTenantId] = useState<string>('');
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [apiOnline, setApiOnline] = useState(true);
  const [dashboardMode, setDashboardMode] = useState<DashboardMode>('overview');
  const [ingestMetric, setIngestMetric] = useState<MetricName>('api_calls');
  const [ingestAmount, setIngestAmount] = useState('500');
  const [alertMessage, setAlertMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const activeTenant = useMemo(
    () => tenants.find((tenant) => tenant.tenantId === selectedTenantId) ?? null,
    [tenants, selectedTenantId],
  );

  const fetchTenants = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/tenants`, {
        headers: { ...getAuthHeaders() }
      });
      if (!res.ok) {
        throw new Error('Failed to load tenants');
      }

      const data = (await res.json()) as Tenant[];
      setTenants(data);
      setApiOnline(true);

      setSelectedTenantId((currentTenantId) => {
        if (currentTenantId && data.some((tenant) => tenant.tenantId === currentTenantId)) {
          return currentTenantId;
        }
        return data[0]?.tenantId ?? '';
      });

      return data;
    } catch {
      setApiOnline(false);
      setTenants([]);
      setSelectedTenantId('');
      return [] as Tenant[];
    }
  }, [getAuthHeaders]);

  const fetchDashboardData = useCallback(async (tenantId: string) => {
    if (!tenantId) return;

    try {
      const res = await fetch(`${API_BASE}/dashboard/${tenantId}`, {
        headers: { ...getAuthHeaders() }
      });
      if (!res.ok) {
        throw new Error('Failed to load dashboard data');
      }

      const data = (await res.json()) as DashboardData;
      setDashboardData(data);
      setApiOnline(true);
    } catch {
      setApiOnline(false);
      throw new Error('backend-unavailable');
    }
  }, [getAuthHeaders]);
  const refreshDashboard = useCallback(
    async (tenantId: string) => {
      if (!tenantId) return;

      setIsRefreshing(true);
      try {
        await fetchDashboardData(tenantId);
      } catch (error) {
        if (error instanceof Error && error.message === 'backend-unavailable') {
          setAlertMessage({ type: 'error', text: 'Backend is offline. Start the API and retry.' });
        } else {
          setAlertMessage({ type: 'error', text: 'Unable to refresh the dashboard right now.' });
        }
      } finally {
        setIsRefreshing(false);
      }
    },
    [fetchDashboardData],
  );

  useEffect(() => {
    let isMounted = true;

    async function loadInitialData() {
      try {
        setIsLoading(true);
        const data = await fetchTenants();

        const initialTenantId = selectedTenantId || data[0]?.tenantId || '';
        if (initialTenantId && isMounted) {
          await fetchDashboardData(initialTenantId);
        }
      } catch (error) {
        if (isMounted) {
          setAlertMessage({ type: 'error', text: 'Could not connect to the ScaleBill backend.' });
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    void loadInitialData();

    return () => {
      isMounted = false;
    };
  }, [fetchDashboardData, fetchTenants, selectedTenantId]);

  useEffect(() => {
    if (!selectedTenantId || isLoading) {
      return;
    }

    void refreshDashboard(selectedTenantId);
  }, [isLoading, refreshDashboard, selectedTenantId]);

  const handleIngest = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!selectedTenantId || !ingestAmount) {
      return;
    }

    setIsSubmitting(true);
    setAlertMessage(null);

    try {
      const response = await fetch(`${API_BASE}/usage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({
          tenantId: selectedTenantId,
          metric: ingestMetric,
          amount: Number.parseFloat(ingestAmount),
        }),
      });

      if (!response.ok) {
        const errorBody = (await response.json()) as { error?: string };
        throw new Error(errorBody.error || 'Usage ingestion failed');
      }

      setAlertMessage({
        type: 'success',
        text: `Recorded ${ingestAmount} ${metricCopy[ingestMetric].shortLabel.toLowerCase()} for ${activeTenant?.name ?? 'the tenant'}.`,
      });
      await refreshDashboard(selectedTenantId);
    } catch (error) {
      setAlertMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Server connection failed',
      });
    } finally {
      setIsSubmitting(false);
      window.setTimeout(() => setAlertMessage(null), 4000);
    }
  };

  const handleGenerateInvoice = async () => {
    if (!selectedTenantId) return;

    try {
      const response = await fetch(`${API_BASE}/invoices/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ tenantId: selectedTenantId }),
      });

      if (!response.ok) {
        const errorBody = (await response.json()) as { error?: string };
        throw new Error(errorBody.error || 'Invoice generation failed');
      }

      setAlertMessage({ type: 'success', text: 'Invoice generated for the current billing period.' });
      await refreshDashboard(selectedTenantId);
    } catch (error) {
      setAlertMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Failed to generate invoice',
      });
    }
  };

  const handleRunAlertCheck = async () => {
    if (!selectedTenantId) return;

    try {
      const response = await fetch(`${API_BASE}/alerts/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ tenantId: selectedTenantId }),
      });

      if (!response.ok) {
        const errorBody = (await response.json()) as { error?: string };
        throw new Error(errorBody.error || 'Alert check failed');
      }

      const result = (await response.json()) as { alertsTriggered?: unknown[] };
      const count = result.alertsTriggered?.length ?? 0;
      setAlertMessage({
        type: 'success',
        text: count > 0 ? `Triggered ${count} threshold alert${count > 1 ? 's' : ''}.` : 'No new threshold alerts were triggered.',
      });
      await refreshDashboard(selectedTenantId);
    } catch (error) {
      setAlertMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Failed to run alert checks',
      });
    }
  };

  const handleResetSeed = async () => {
    if (!window.confirm('Reset and seed the database? This clears current events and rebuilds demo data.')) {
      return;
    }

    try {
      const response = await fetch(`${API_BASE}/seed`, {
        method: 'POST',
        headers: { ...getAuthHeaders() }
      });

      if (!response.ok) {
        const errorBody = (await response.json()) as { error?: string };
        throw new Error(errorBody.error || 'Seeding failed');
      }

      setAlertMessage({ type: 'success', text: 'Database seeded successfully.' });
      const data = await fetchTenants();
      const tenantId = data[0]?.tenantId || selectedTenantId;
      if (tenantId) {
        await fetchDashboardData(tenantId);
      }
    } catch (error) {
      setAlertMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Failed to seed database',
      });
    }
  };

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login');
    }
  }, [user, authLoading, router]);

  if (authLoading) {
    return (
      <main className="shell shell-loading">
        <div className="loading-panel glass-card">
          <div className="loading-orb" />
          <div className="loading-copy">
            <div className="eyebrow">
              <Sparkles size={14} />
              ScaleBill operator console
            </div>
            <h1>Checking session...</h1>
          </div>
        </div>
      </main>
    );
  }

  if (!user) return null;

  if (isLoading || !dashboardData) {
    return (
      <main className="shell shell-loading">
        <div className="loading-panel glass-card">
          <div className="loading-orb" />
          <div className="loading-copy">
            <div className="eyebrow">
              <Sparkles size={14} />
              ScaleBill operator console
            </div>
            <h1>{apiOnline ? 'Syncing tenant state' : 'Backend offline'}</h1>
            <p>
              {apiOnline
                ? 'Connecting to the backend, loading live counters, and pulling the latest invoices.'
                : 'The dashboard could not reach the API at localhost:4000. Start the backend and refresh this page.'}
            </p>
          </div>
          <div className="control-row">
            <button onClick={() => void refreshDashboard(selectedTenantId)} className="btn btn-primary" type="button" disabled={!selectedTenantId || !apiOnline}>
              <RefreshCw size={16} /> Retry
            </button>
            <button onClick={handleResetSeed} className="btn btn-secondary" type="button" disabled={!apiOnline}>
              <Sparkles size={16} /> Seed demo data
            </button>
          </div>
        </div>
      </main>
    );
  }

  const { tenant, usage, billing, invoices, alerts, history } = dashboardData;

  const apiPercent = getUsagePercentage(usage.api_calls, tenant.apiLimit);
  const storagePercent = getUsagePercentage(usage.storage_gb, tenant.storageLimit);
  const bandwidthPercent = getUsagePercentage(usage.bandwidth_gb, tenant.bandwidthLimit);

  const utilizationCards: UtilizationCard[] = [
    {
      key: 'api_calls',
      label: 'API calls',
      value: usage.api_calls.toLocaleString(),
      limit: tenant.apiLimit.toLocaleString(),
      percent: apiPercent,
    },
    {
      key: 'storage_gb',
      label: 'Storage',
      value: `${usage.storage_gb.toFixed(2)} GB`,
      limit: `${tenant.storageLimit} GB`,
      percent: storagePercent,
    },
    {
      key: 'bandwidth_gb',
      label: 'Bandwidth',
      value: `${usage.bandwidth_gb.toFixed(2)} GB`,
      limit: `${tenant.bandwidthLimit} GB`,
      percent: bandwidthPercent,
    },
  ];

  const alertCount = alerts.length;
  const monthlyTotalCharge = dashboardData.monthlyBreakdown.reduce((sum, item) => sum + item.charge, 0);
  const monthlyTotalEvents = dashboardData.monthlyBreakdown.reduce((sum, item) => sum + item.eventCount, 0);
  return (
    <main className="shell">
      <div className="ambient ambient-left" />
      <div className="ambient ambient-right" />

      {alertMessage && (
        <div className={`toast toast-${alertMessage.type}`} role="status" aria-live="polite">
          {alertMessage.type === 'success' ? <CheckCircle size={18} /> : <AlertTriangle size={18} />}
          <span>{alertMessage.text}</span>
        </div>
      )}

      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', padding: '10px 20px', borderRadius: '16px', backgroundColor: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <User size={18} style={{ color: 'var(--primary)' }} />
          <div>
            <span style={{ fontWeight: 600 }}>{user?.email}</span>
            <span style={{ fontSize: '0.78rem', marginLeft: '10px', padding: '2px 8px', borderRadius: '999px', backgroundColor: 'rgba(124, 140, 255, 0.15)', color: 'var(--primary)', textTransform: 'lowercase' }}>{user?.role}</span>
          </div>
        </div>
        <button onClick={logout} className="btn btn-secondary" style={{ padding: '8px 14px', borderRadius: '10px', gap: '6px', fontSize: '0.88rem' }}>
          <LogOut size={14} /> Logout
        </button>
      </header>

      <section className="hero glass-card">
        <div className="hero-copy">
          <div className="eyebrow">
            <Database size={14} />
            ScaleBill dashboard
          </div>
          <h1>Live billing control for multi-tenant usage.</h1>
          <p>
            Monitor active counters, push usage into Redis, review invoice history, and trigger alert checks from a single operator surface.
          </p>

          <div className="hero-badges">
            <span className="status-pill"><Shield size={14} /> Tenant isolated</span>
            <span className="status-pill"><Clock3 size={14} /> Live period scope</span>
            <span className="status-pill"><TrendingUp size={14} /> Realtime pricing</span>
          </div>
        </div>

        <div className="hero-controls glass-card-inner">
          <div className="control-stack">
            <label htmlFor="tenant-select">Workspace tenant</label>
            <select
              id="tenant-select"
              value={selectedTenantId}
              onChange={(event) => setSelectedTenantId(event.target.value)}
              className="select-input"
            >
              {tenants.map((tenantOption) => (
                <option key={tenantOption.tenantId} value={tenantOption.tenantId}>
                  {tenantOption.name} ({tenantOption.planType})
                </option>
              ))}
            </select>
          </div>

          <div className="control-row">
            <button onClick={() => refreshDashboard(selectedTenantId)} className="btn btn-secondary" type="button" disabled={isRefreshing}>
              <RefreshCw size={16} className={isRefreshing ? 'spin-icon' : ''} />
              {isRefreshing ? 'Refreshing' : 'Refresh'}
            </button>
            <button onClick={handleResetSeed} className="btn btn-tertiary" type="button">
              <Sparkles size={16} /> Seed
            </button>
          </div>

          <div className="control-row">
            <button
              type="button"
              className={dashboardMode === 'overview' ? 'btn btn-primary' : 'btn btn-secondary'}
              onClick={() => setDashboardMode('overview')}
            >
              <TrendingUp size={16} /> Overview
            </button>
            <button
              type="button"
              className={dashboardMode === 'monthly' ? 'btn btn-primary' : 'btn btn-secondary'}
              onClick={() => setDashboardMode('monthly')}
            >
              <Clock3 size={16} /> Monthly report
            </button>
          </div>
        </div>
      </section>

      {dashboardMode === 'monthly' && (
        <section className="monthly-summary glass-card">
          <div className="section-head">
            <div>
              <p className="section-kicker"><Clock3 size={14} /> Current billing month</p>
              <h3>Platform usage and charge summary</h3>
            </div>
            <span className="section-pill">
              {formatDate(dashboardData.currentPeriod.periodStart)} - {formatDate(dashboardData.currentPeriod.periodEnd)}
            </span>
          </div>

          <div className="meta-grid monthly-metrics-grid">
            <div className="glass-card meta-card">
              <p className="meta-label">Total usage events</p>
              <h2>{monthlyTotalEvents.toLocaleString()}</h2>
              <p className="meta-copy">Number of usage submissions recorded this month.</p>
            </div>
            <div className="glass-card meta-card">
              <p className="meta-label">Estimated monthly add-on</p>
              <h2>{formatCurrency(monthlyTotalCharge)}</h2>
              <p className="meta-copy">Overage charge derived from the current billing period.</p>
            </div>
            <div className="glass-card meta-card">
              <p className="meta-label">Billing period</p>
              <h2>{dashboardData.currentPeriod.periodKey}</h2>
              <p className="meta-copy">Aligned to the tenant billing anchor day.</p>
            </div>
          </div>

          <div className="monthly-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Platform</th>
                  <th>Usage events</th>
                  <th>Monthly usage</th>
                  <th>Estimated charge</th>
                </tr>
              </thead>
              <tbody>
                {dashboardData.monthlyBreakdown.map((item) => (
                  <tr key={item.metric}>
                    <td>
                      <strong>{metricCopy[item.metric].label}</strong>
                    </td>
                    <td>{item.eventCount.toLocaleString()}</td>
                    <td>
                      {item.metric === 'api_calls'
                        ? item.totalUsage.toLocaleString()
                        : `${item.totalUsage.toFixed(2)} GB`}
                    </td>
                    <td><strong>{formatCurrency(item.charge)}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="meta-grid">
        <div className="glass-card meta-card">
          <div className="meta-top">
            <div>
              <p className="meta-label">Tenant</p>
              <h2>{tenant.name}</h2>
            </div>
            <div className={`mini-mark tone-${getBand(apiPercent)}`}>
              {tenant.planType}
            </div>
          </div>
          <p className="meta-copy">{tenant.email}</p>
          <div className="meta-footer">
            <span><User size={14} /> ID {tenant.tenantId}</span>
            <span><Bell size={14} /> {alertCount} active alert{alertCount === 1 ? '' : 's'}</span>
          </div>
        </div>

        <div className="glass-card meta-card">
          <p className="meta-label">Current accrued cost</p>
          <div className="price-row">
            <h2>{formatCurrency(billing.totalFee)}</h2>
            <ArrowUpRight size={18} />
          </div>
          <p className="meta-copy">Base fee {formatCurrency(billing.baseFee)} + overages {formatCurrency(billing.totalOverage)}</p>
        </div>

        <div className="glass-card meta-card">
          <p className="meta-label">Billing anchor</p>
          <h2>{tenant.billingAnchorDay ?? 'Default'}</h2>
          <p className="meta-copy">Period resets are aligned to the tenant anchor day.</p>
        </div>
      </section>

      <section className="usage-grid">
        {utilizationCards.map((card) => {
          const toneClass = `tone-${getBand(card.percent)}`;
          const metric = metricCopy[card.key];

          return (
            <article key={card.key} className={`glass-card metric-card ${toneClass}`}>
              <div className="metric-head">
                <div className="metric-head-left">
                  <div className={`metric-icon metric-icon-${card.key}`}>{metric.icon}</div>
                  <div>
                    <p className="metric-label">{card.label}</p>
                    <span className="metric-subtext">Limit {card.limit}</span>
                  </div>
                </div>
                <span className={`usage-chip chip-${getBand(card.percent)}`}>{card.percent}%</span>
              </div>

              <div className="metric-value">{card.value}</div>
              <div className="progress-track" aria-hidden="true">
                <div className={`progress-fill fill-${getBand(card.percent)}`} style={{ width: `${card.percent}%` }} />
              </div>
            </article>
          );
        })}
      </section>

      <section className="dashboard-grid">
        <article className="glass-card chart-card">
          <div className="section-head">
            <div>
              <p className="section-kicker"><Activity size={14} /> 14-day usage history</p>
              <h3>Live counter trend</h3>
            </div>
            <span className="section-pill">Redis-backed live view</span>
          </div>

          {history.length === 0 ? (
            <div className="empty-state">No historical usage yet. Ingest usage to build the trend line.</div>
          ) : (
            <div className="chart-wrap">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={history} margin={{ top: 8, right: 0, left: -12, bottom: 0 }}>
                  <defs>
                    <linearGradient id="historyApi" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="8%" stopColor="#7c8cff" stopOpacity={0.38} />
                      <stop offset="92%" stopColor="#7c8cff" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="historyStorage" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="8%" stopColor="#2fd4a8" stopOpacity={0.34} />
                      <stop offset="92%" stopColor="#2fd4a8" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="historyBandwidth" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="8%" stopColor="#f5a524" stopOpacity={0.34} />
                      <stop offset="92%" stopColor="#f5a524" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis dataKey="name" stroke="rgba(226,232,240,0.45)" tickLine={false} axisLine={false} />
                  <YAxis stroke="rgba(226,232,240,0.45)" tickLine={false} axisLine={false} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#09111f',
                      border: '1px solid rgba(255,255,255,0.08)',
                      borderRadius: '16px',
                      color: '#f8fafc',
                      boxShadow: '0 24px 60px rgba(0,0,0,0.35)',
                    }}
                    labelStyle={{ color: '#e2e8f0' }}
                  />
                  <Legend />
                  <Area type="monotone" name="API calls" dataKey="api_calls" stroke="#7c8cff" fill="url(#historyApi)" strokeWidth={2} />
                  <Area type="monotone" name="Storage GB" dataKey="storage_gb" stroke="#2fd4a8" fill="url(#historyStorage)" strokeWidth={2} />
                  <Area type="monotone" name="Bandwidth GB" dataKey="bandwidth_gb" stroke="#f5a524" fill="url(#historyBandwidth)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </article>

        <article className="glass-card billing-card">
          <div className="section-head">
            <div>
              <p className="section-kicker"><DollarSign size={14} /> Pricing engine</p>
              <h3>Current billing breakdown</h3>
            </div>
            <span className="section-pill">Plan {tenant.planType}</span>
          </div>

          <div className="billing-lines">
            <div className="billing-line">
              <span>Base fee</span>
              <strong>{formatCurrency(billing.baseFee)}</strong>
            </div>
            <div className="billing-line">
              <span>API overage</span>
              <strong>{formatCurrency(billing.apiOverage)}</strong>
            </div>
            <div className="billing-line">
              <span>Storage overage</span>
              <strong>{formatCurrency(billing.storageOverage)}</strong>
            </div>
            <div className="billing-line">
              <span>Bandwidth overage</span>
              <strong>{formatCurrency(billing.bandwidthOverage)}</strong>
            </div>
            <div className="billing-line billing-line-total">
              <span>Total overages</span>
              <strong>{formatCurrency(billing.totalOverage)}</strong>
            </div>
          </div>

          <div className="billing-total">
            <div>
              <p className="meta-label">Current accrued cost</p>
              <h2>{formatCurrency(billing.totalFee)}</h2>
            </div>
            <div className="billing-actions">
              <button onClick={handleGenerateInvoice} className="btn btn-primary" type="button">
                <FileText size={16} /> Generate invoice
              </button>
              <button onClick={handleRunAlertCheck} className="btn btn-secondary" type="button">
                <Bell size={16} /> Run alerts
              </button>
            </div>
          </div>
        </article>
      </section>

      <section className="dashboard-grid dashboard-grid-secondary">
        <article className="glass-card">
          <div className="section-head">
            <div>
              <p className="section-kicker"><Sliders size={14} /> Usage intake</p>
              <h3>Simulate live tenant activity</h3>
            </div>
            <span className="section-pill">POST /api/usage</span>
          </div>

          <form onSubmit={handleIngest} className="sim-form">
            <div className="field-grid">
              <label className="field-block">
                <span>Metric type</span>
                <select value={ingestMetric} onChange={(event) => setIngestMetric(event.target.value as MetricName)} className="select-input">
                  {metricOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field-block">
                <span>Quantity</span>
                <input
                  type="number"
                  step="any"
                  value={ingestAmount}
                  onChange={(event) => setIngestAmount(event.target.value)}
                  className="number-input"
                  placeholder="1000"
                />
              </label>
            </div>

            <button type="submit" className="btn btn-accent" disabled={isSubmitting}>
              <PlusCircle size={16} /> {isSubmitting ? 'Recording usage' : 'Inject usage event'}
            </button>
          </form>
        </article>

        <article className="glass-card">
          <div className="section-head">
            <div>
              <p className="section-kicker"><AlertTriangle size={14} /> Alert feed</p>
              <h3>Threshold visibility</h3>
            </div>
            <span className="section-pill">Recent {alerts.length}</span>
          </div>

          {alerts.length === 0 ? (
            <div className="empty-state">No alerts have fired for this tenant yet.</div>
          ) : (
            <div className="alerts-list">
              {alerts.map((alert) => (
                <div key={alert._id} className={`alert-item alert-${getBand(getUsagePercentage(alert.usageValue, alert.limitValue))}`}>
                  <div className="alert-icon">
                    <AlertTriangle size={16} />
                  </div>
                  <div className="alert-copy">
                    <strong>{metricCopy[alert.metric].label}</strong> crossed {alert.thresholdType} of the configured limit.
                    <span>{alert.usageValue} / {alert.limitValue}</span>
                    <span>{formatDateTime(alert.createdAt)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </article>
      </section>

      <section className="dashboard-grid dashboard-grid-secondary">
        <article className="glass-card">
          <div className="section-head">
            <div>
              <p className="section-kicker"><FileText size={14} /> Invoice ledger</p>
              <h3>Generated statements</h3>
            </div>
            <span className="section-pill">MongoDB history</span>
          </div>

          {invoices.length === 0 ? (
            <div className="empty-state">No invoices have been generated for this tenant yet.</div>
          ) : (
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Invoice</th>
                    <th>Period</th>
                    <th>Base</th>
                    <th>Overage</th>
                    <th>Total</th>
                    <th>Status</th>
                    <th>PDF</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((invoice) => (
                    <tr key={invoice._id}>
                      <td>
                        <strong>{invoice.invoiceNumber}</strong>
                        <div className="table-subtext">Email {invoice.emailSent ? 'sent' : 'pending'}</div>
                      </td>
                      <td>
                        {formatDate(invoice.periodStart)} - {formatDate(invoice.periodEnd)}
                      </td>
                      <td>{formatCurrency(invoice.baseFee)}</td>
                      <td>{formatCurrency(invoice.overageFee)}</td>
                      <td><strong>{formatCurrency(invoice.totalFee)}</strong></td>
                      <td>
                        <span className={`table-badge table-badge-${invoice.status.toLowerCase()}`}>{invoice.status}</span>
                      </td>
                      <td>
                        <a href={`${BACKEND_URL}${invoice.pdfPath}`} target="_blank" rel="noreferrer" className="btn btn-ghost">
                          <FileText size={14} /> Open PDF
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </article>

        <article className="glass-card">
          <div className="section-head">
            <div>
              <p className="section-kicker"><TrendingUp size={14} /> Breakdown</p>
              <h3>Live usage by resource</h3>
            </div>
            <span className="section-pill">Period scoped</span>
          </div>

          <div className="bar-chart-wrap">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={utilizationCards} margin={{ top: 8, right: 0, left: -12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="label" stroke="rgba(226,232,240,0.45)" tickLine={false} axisLine={false} />
                <YAxis stroke="rgba(226,232,240,0.45)" tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#09111f',
                    border: '1px solid rgba(255,255,255,0.08)',
                    borderRadius: '16px',
                    color: '#f8fafc',
                  }}
                />
                <Bar dataKey="percent" radius={[10, 10, 0, 0]} fill="#7c8cff" name="Utilization %" />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="resource-summary">
            {utilizationCards.map((card) => (
              <div key={card.key} className="resource-item">
                <div className="resource-top">
                  <span>{card.label}</span>
                  <strong>{card.percent}%</strong>
                </div>
                <div className="progress-track">
                  <div className={`progress-fill fill-${getBand(card.percent)}`} style={{ width: `${card.percent}%` }} />
                </div>
              </div>
            ))}
          </div>
        </article>
      </section>
    </main>
  );
}
