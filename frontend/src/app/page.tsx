'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { 
  Database, 
  Activity, 
  HardDrive, 
  Network, 
  DollarSign, 
  AlertTriangle, 
  FileText, 
  RefreshCw, 
  PlusCircle, 
  Sliders, 
  User, 
  CheckCircle,
  Bell
} from 'lucide-react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  Legend
} from 'recharts';

interface Tenant {
  tenantId: string;
  name: string;
  planType: 'Starter' | 'Pro' | 'Enterprise';
  email: string;
  apiLimit: number;
  storageLimit: number;
  bandwidthLimit: number;
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

interface Alert {
  _id: string;
  metric: string;
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

const API_BASE = 'http://localhost:4000/api';

export default function Home() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [selectedTenantId, setSelectedTenantId] = useState<string>('');
  const [dashboardData, setDashboardData] = useState<{
    tenant: Tenant;
    usage: { api_calls: number; storage_gb: number; bandwidth_gb: number };
    billing: Billing;
    invoices: Invoice[];
    alerts: Alert[];
    history: HistoryItem[];
  } | null>(null);

  // Form states
  const [ingestMetric, setIngestMetric] = useState<'api_calls' | 'storage_gb' | 'bandwidth_gb'>('api_calls');
  const [ingestAmount, setIngestAmount] = useState<string>('500');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [alertMessage, setAlertMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

  // Fetch all tenants
  const fetchTenants = async () => {
    try {
      const res = await fetch(`${API_BASE}/tenants`);
      const data = await res.json();
      setTenants(data);
      if (data.length > 0 && !selectedTenantId) {
        setSelectedTenantId(data[0].tenantId);
      }
    } catch (error) {
      console.error('Error fetching tenants:', error);
    }
  };

  // Fetch dashboard data for active tenant
  const fetchDashboardData = useCallback(async (tenantId: string) => {
    if (!tenantId) return;
    try {
      const res = await fetch(`${API_BASE}/dashboard/${tenantId}`);
      if (res.ok) {
        const data = await res.json();
        setDashboardData(data);
      }
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
    }
  }, []);

  useEffect(() => {
    fetchTenants();
  }, []);

  useEffect(() => {
    if (selectedTenantId) {
      fetchDashboardData(selectedTenantId);
    }
  }, [selectedTenantId, fetchDashboardData]);

  // Handle Event Ingestion
  const handleIngest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTenantId || !ingestAmount) return;

    setIsSubmitting(true);
    setAlertMessage(null);

    try {
      const res = await fetch(`${API_BASE}/usage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId: selectedTenantId,
          metric: ingestMetric,
          amount: parseFloat(ingestAmount)
        })
      });

      if (res.ok) {
        setAlertMessage({ type: 'success', text: `Successfully ingested ${ingestAmount} to ${ingestMetric}!` });
        fetchDashboardData(selectedTenantId);
      } else {
        const err = await res.json();
        setAlertMessage({ type: 'error', text: err.error || 'Ingestion failed' });
      }
    } catch (error) {
      setAlertMessage({ type: 'error', text: 'Server connection failed' });
    } finally {
      setIsSubmitting(false);
      setTimeout(() => setAlertMessage(null), 4000);
    }
  };

  // Trigger manual invoice generation
  const handleGenerateInvoice = async () => {
    if (!selectedTenantId) return;
    try {
      const res = await fetch(`${API_BASE}/invoices/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId: selectedTenantId })
      });
      if (res.ok) {
        setAlertMessage({ type: 'success', text: 'Invoice generated successfully!' });
        fetchDashboardData(selectedTenantId);
      }
    } catch (error) {
      setAlertMessage({ type: 'error', text: 'Failed to generate invoice' });
    }
  };

  // Trigger manual alert check
  const handleRunAlertCheck = async () => {
    if (!selectedTenantId) return;
    try {
      const res = await fetch(`${API_BASE}/alerts/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId: selectedTenantId })
      });
      if (res.ok) {
        const result = await res.json();
        if (result.alertsTriggered && result.alertsTriggered.length > 0) {
          setAlertMessage({ type: 'success', text: `Triggered ${result.alertsTriggered.length} new alert(s)!` });
        } else {
          setAlertMessage({ type: 'success', text: 'No new alert thresholds crossed.' });
        }
        fetchDashboardData(selectedTenantId);
      }
    } catch (error) {
      setAlertMessage({ type: 'error', text: 'Failed to run alert checks' });
    }
  };

  // Reset database with seeds
  const handleResetSeed = async () => {
    if (!confirm('Are you sure you want to reset and seed the database? This deletes all current events.')) return;
    try {
      const res = await fetch(`${API_BASE}/seed`, { method: 'POST' });
      if (res.ok) {
        setAlertMessage({ type: 'success', text: 'Database reset & seeded successfully!' });
        await fetchTenants();
        if (selectedTenantId) {
          fetchDashboardData(selectedTenantId);
        }
      }
    } catch (error) {
      setAlertMessage({ type: 'error', text: 'Failed to seed database' });
    }
  };

  if (!dashboardData) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100%', alignItems: 'center', justifyContent: 'center', gap: '1rem', background: '#0B0F19' }}>
        <RefreshCw style={{ animation: 'spin 1.5s linear infinite', color: '#6366F1' }} size={40} />
        <p style={{ color: '#9CA3AF' }}>Connecting to ScaleBill backend server...</p>
        <button onClick={handleResetSeed} className="btn btn-primary" style={{ marginTop: '1rem' }}>
          Seed Database Initially
        </button>
      </div>
    );
  }

  const { tenant, usage, billing, invoices, alerts, history } = dashboardData;

  // Percentage limit helper
  const getUsagePercentage = (current: number, limit: number) => {
    if (limit <= 0) return 0;
    return Math.min(100, Math.round((current / limit) * 100));
  };

  const apiPercent = getUsagePercentage(usage.api_calls, tenant.apiLimit);
  const storagePercent = getUsagePercentage(usage.storage_gb, tenant.storageLimit);
  const bandwidthPercent = getUsagePercentage(usage.bandwidthLimit ? usage.bandwidth_gb : 0, tenant.bandwidthLimit);

  const getBadgeClass = (percent: number) => {
    if (percent >= 95) return 'percentage-badge-danger';
    if (percent >= 80) return 'percentage-badge-warning';
    return 'percentage-badge-normal';
  };

  const getProgressBarClass = (percent: number) => {
    if (percent >= 95) return 'bg-danger';
    if (percent >= 80) return 'bg-warning';
    return 'bg-primary';
  };

  return (
    <div className="dashboard-container">
      {/* Toast Alert */}
      {alertMessage && (
        <div style={{
          position: 'fixed',
          top: '20px',
          right: '20px',
          zIndex: 1000,
          background: alertMessage.type === 'success' ? '#10B981' : '#EF4444',
          color: '#FFF',
          padding: '0.75rem 1.5rem',
          borderRadius: '10px',
          boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.4)',
          fontWeight: 600,
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          animation: 'fadeIn 0.2s ease-out'
        }}>
          {alertMessage.type === 'success' ? <CheckCircle size={18} /> : <AlertTriangle size={18} />}
          {alertMessage.text}
        </div>
      )}

      {/* Header */}
      <header className="dashboard-header">
        <div className="logo-container">
          <div className="logo-icon">
            <Database size={24} color="#FFF" />
          </div>
          <div>
            <h1 className="logo-text">ScaleBill</h1>
            <div className="sub-info-row">
              <span className="sub-info-item"><User size={12} /> Multi-Tenant SaaS Billing</span>
            </div>
          </div>
        </div>

        <div className="tenant-selector-wrapper">
          <label style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', fontWeight: 600 }}>WORKSPACE TENANT:</label>
          <select 
            value={selectedTenantId}
            onChange={(e) => setSelectedTenantId(e.target.value)}
            className="select-input"
          >
            {tenants.map((t) => (
              <option key={t.tenantId} value={t.tenantId}>
                {t.name} ({t.planType})
              </option>
            ))}
          </select>
          <button onClick={handleResetSeed} className="btn btn-secondary" title="Reset and seed default database">
            <RefreshCw size={16} />
          </button>
        </div>
      </header>

      {/* Main Grid: Usage metrics widgets */}
      <div className="metrics-grid">
        {/* Metric 1: API Calls */}
        <div className="glass-card">
          <div className="metric-header">
            <div className="metric-title-group">
              <div className="metric-icon-box api-calls-theme">
                <Activity size={20} />
              </div>
              <span className="metric-name">API INGESTION CALLS</span>
            </div>
            <span className={`usage-percentage ${getBadgeClass(apiPercent)}`}>
              {apiPercent}%
            </span>
          </div>
          <div className="metric-value-box">
            <div className="metric-number">{usage.api_calls.toLocaleString()}</div>
            <span className="metric-limit-label">Limit: {tenant.apiLimit.toLocaleString()} included</span>
          </div>
          <div className="progress-container">
            <div className={`progress-bar ${getProgressBarClass(apiPercent)}`} style={{ width: `${apiPercent}%` }}></div>
          </div>
        </div>

        {/* Metric 2: Storage */}
        <div className="glass-card">
          <div className="metric-header">
            <div className="metric-title-group">
              <div className="metric-icon-box storage-theme">
                <HardDrive size={20} />
              </div>
              <span className="metric-name">STORAGE VOLUME</span>
            </div>
            <span className={`usage-percentage ${getBadgeClass(storagePercent)}`}>
              {storagePercent}%
            </span>
          </div>
          <div className="metric-value-box">
            <div className="metric-number">{usage.storage_gb.toFixed(2)} GB</div>
            <span className="metric-limit-label">Limit: {tenant.storageLimit} GB included</span>
          </div>
          <div className="progress-container">
            <div className={`progress-bar ${getProgressBarClass(storagePercent)}`} style={{ width: `${storagePercent}%` }}></div>
          </div>
        </div>

        {/* Metric 3: Bandwidth */}
        <div className="glass-card">
          <div className="metric-header">
            <div className="metric-title-group">
              <div className="metric-icon-box bandwidth-theme">
                <Network size={20} />
              </div>
              <span className="metric-name">DATA TRANSFER (BANDWIDTH)</span>
            </div>
            <span className={`usage-percentage ${getBadgeClass(bandwidthPercent)}`}>
              {bandwidthPercent}%
            </span>
          </div>
          <div className="metric-value-box">
            <div className="metric-number">{usage.bandwidth_gb.toFixed(2)} GB</div>
            <span className="metric-limit-label">Limit: {tenant.bandwidthLimit} GB included</span>
          </div>
          <div className="progress-container">
            <div className={`progress-bar ${getProgressBarClass(bandwidthPercent)}`} style={{ width: `${bandwidthPercent}%` }}></div>
          </div>
        </div>
      </div>

      {/* Main dashboard layout (Charts & Pricing Engine summary) */}
      <div className="dashboard-layout">
        {/* Left Side: Historical Trends */}
        <div className="glass-card">
          <div className="section-title">
            <Activity size={20} color="#6366F1" />
            <span>Usage History (Last 14 Days)</span>
          </div>
          
          {history.length === 0 ? (
            <div className="empty-state">No historical usage logged yet. Ingest usage to build charts.</div>
          ) : (
            <div className="chart-container">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={history} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorApi" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#6366F1" stopOpacity={0.4}/>
                      <stop offset="95%" stopColor="#6366F1" stopOpacity={0.0}/>
                    </linearGradient>
                    <linearGradient id="colorStorage" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10B981" stopOpacity={0.4}/>
                      <stop offset="95%" stopColor="#10B981" stopOpacity={0.0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="name" stroke="#6B7280" style={{ fontSize: '0.8rem' }} />
                  <YAxis stroke="#6B7280" style={{ fontSize: '0.8rem' }} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#111827', borderColor: 'rgba(255,255,255,0.1)', color: '#FFF' }}
                    itemStyle={{ fontSize: '0.85rem' }}
                  />
                  <Legend wrapperStyle={{ fontSize: '0.85rem', paddingTop: '10px' }} />
                  <Area type="monotone" name="API Calls" dataKey="api_calls" stroke="#6366F1" fillOpacity={1} fill="url(#colorApi)" />
                  <Area type="monotone" name="Storage (GB)" dataKey="storage_gb" stroke="#10B981" fillOpacity={1} fill="url(#colorStorage)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Right Side: Billing breakdown (Tiered Pricing Engine) */}
        <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div>
            <div className="section-title">
              <DollarSign size={20} color="#10B981" />
              <span>Real-Time Pricing Engine</span>
            </div>
            
            <div className="billing-summary-content" style={{ marginTop: '1rem' }}>
              <div className="billing-cost-row">
                <span className="cost-label">Subscription ({tenant.planType})</span>
                <span className="cost-value">₹{billing.baseFee.toLocaleString()}</span>
              </div>
              <div className="billing-cost-row">
                <span className="cost-label">API Overage Cost</span>
                <span className="cost-value">₹{billing.apiOverage.toLocaleString()}</span>
              </div>
              <div className="billing-cost-row">
                <span className="cost-label">Storage Overage Cost</span>
                <span className="cost-value">₹{billing.storageOverage.toLocaleString()}</span>
              </div>
              <div className="billing-cost-row">
                <span className="cost-label">Bandwidth Overage Cost</span>
                <span className="cost-value">₹{billing.bandwidthOverage.toLocaleString()}</span>
              </div>
              <div className="billing-cost-row">
                <span className="cost-label">Total Overages</span>
                <span className="cost-value" style={{ color: 'var(--warning)' }}>
                  ₹{billing.totalOverage.toLocaleString()}
                </span>
              </div>
            </div>
          </div>

          <div style={{ marginTop: '2rem' }}>
            <div className="total-accrued-row">
              <span className="total-accrued-label">Current Accrued Cost</span>
              <span className="total-accrued-value">₹{billing.totalFee.toLocaleString()}</span>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
              <button onClick={handleGenerateInvoice} className="btn btn-primary" style={{ flex: 1 }}>
                <FileText size={16} /> Bill End Cycle
              </button>
              <button onClick={handleRunAlertCheck} className="btn btn-secondary" title="Check usage threshold triggers">
                <Bell size={16} /> Alert Check
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Grid: Simulator & Active Alerts */}
      <div className="simulator-panel">
        {/* Left Card: Usage Event Simulator */}
        <div className="glass-card">
          <div className="section-title">
            <Sliders size={20} color="#F59E0B" />
            <span>Real-Time Usage Ingestion Simulator</span>
          </div>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '1.25rem' }}>
            Submit simulated API traffic, storage uploads, or network requests for <strong>{tenant.name}</strong> to test Redis hot counters and threshold triggers in real-time.
          </p>

          <form onSubmit={handleIngest} className="sim-group">
            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: '150px' }}>
                <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.5rem', fontWeight: 600 }}>
                  METRIC TYPE
                </label>
                <select 
                  value={ingestMetric} 
                  onChange={(e) => setIngestMetric(e.target.value as any)}
                  className="select-input"
                  style={{ width: '100%' }}
                >
                  <option value="api_calls">API Calls (Requests)</option>
                  <option value="storage_gb">Storage Volume (GB)</option>
                  <option value="bandwidth_gb">Data Transfer (GB)</option>
                </select>
              </div>

              <div style={{ width: '150px' }}>
                <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.5rem', fontWeight: 600 }}>
                  QUANTITY / VALUE
                </label>
                <input 
                  type="number" 
                  step="any"
                  value={ingestAmount}
                  onChange={(e) => setIngestAmount(e.target.value)}
                  className="number-input"
                  style={{ width: '100%' }}
                  placeholder="e.g. 1000"
                />
              </div>
            </div>

            <button 
              type="submit" 
              className="btn btn-accent" 
              disabled={isSubmitting}
              style={{ alignSelf: 'flex-start' }}
            >
              <PlusCircle size={16} /> {isSubmitting ? 'Ingesting...' : 'Inject Raw Usage Event'}
            </button>
          </form>
        </div>

        {/* Right Card: Alert Logs (AWS SNS mock output) */}
        <div className="glass-card">
          <div className="section-title">
            <AlertTriangle size={20} color="#EF4444" />
            <span>Active Usage Notifications</span>
          </div>

          {alerts.length === 0 ? (
            <div className="empty-state">No limit alerts generated. Tenant usage is within standard thresholds.</div>
          ) : (
            <div className="alerts-list">
              {alerts.map((alert) => (
                <div 
                  key={alert._id} 
                  className={`alert-item ${alert.thresholdType === '80%' ? 'alert-item-80' : ''}`}
                >
                  <div style={{ marginTop: '2px' }}>
                    <AlertTriangle size={16} color={alert.thresholdType === '80%' ? 'var(--warning)' : 'var(--danger)'} />
                  </div>
                  <div>
                    <div className="alert-message">
                      Limit warning: <strong>{alert.metric === 'api_calls' ? 'API Ingestion' : alert.metric === 'storage_gb' ? 'Storage Volume' : 'Bandwidth'}</strong> consumed over <strong>{alert.thresholdType}</strong> limit.
                    </div>
                    <div className="alert-date">
                      Value: {alert.usageValue} / {alert.limitValue} &bull; {new Date(alert.createdAt).toLocaleString()}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Invoices List */}
      <div className="glass-card">
        <div className="section-title">
          <FileText size={20} color="#3F83F8" />
          <span>Billing Statements & Generated Invoices</span>
        </div>

        {invoices.length === 0 ? (
          <div className="empty-state">No billing statements available yet for this workspace.</div>
        ) : (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Invoice ID</th>
                  <th>Statement Period</th>
                  <th>Base Price</th>
                  <th>Overage Fee</th>
                  <th>Total Cost</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr key={inv._id}>
                    <td style={{ fontWeight: 600 }}>{inv.invoiceNumber}</td>
                    <td>
                      {new Date(inv.periodStart).toLocaleDateString()} - {new Date(inv.periodEnd).toLocaleDateString()}
                    </td>
                    <td>₹{inv.baseFee.toLocaleString()}</td>
                    <td style={{ color: inv.overageFee > 0 ? 'var(--warning)' : 'var(--text-primary)' }}>
                      ₹{inv.overageFee.toLocaleString()}
                    </td>
                    <td style={{ fontWeight: 700 }}>₹{inv.totalFee.toLocaleString()}</td>
                    <td>
                      <span className={`badge ${inv.status === 'Paid' ? 'badge-paid' : 'badge-pending'}`}>
                        {inv.status}
                      </span>
                    </td>
                    <td>
                      <a 
                        href={`http://localhost:4000${inv.pdfPath}`}
                        target="_blank"
                        rel="noreferrer"
                        className="btn btn-secondary"
                        style={{ padding: '0.35rem 0.75rem', fontSize: '0.75rem' }}
                      >
                        <FileText size={12} /> PDF Invoice
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
