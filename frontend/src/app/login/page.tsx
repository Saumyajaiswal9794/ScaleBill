'use client';

import React, { useState } from 'react';
import { useAuth } from '../../context/authContext';
import { KeyRound, Mail, Sparkles } from 'lucide-react';

export default function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setError('Please fill in all fields.');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      await login(email, password);
    } catch (err: any) {
      setError(err.message || 'Failed to login. Please check your credentials.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="shell shell-loading">
      <div className="ambient ambient-left" />
      <div className="ambient ambient-right" />

      <div className="loading-panel glass-card" style={{ maxWidth: '440px', padding: '40px 30px' }}>
        <div className="loading-orb" style={{ width: '64px', height: '64px' }} />

        <div className="loading-copy" style={{ marginBottom: '24px' }}>
          <div className="eyebrow">
            <Sparkles size={14} />
            ScaleBill Portal
          </div>
          <h1 style={{ fontSize: '2rem', marginTop: '6px' }}>Welcome back</h1>
          <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
            Please sign in to manage your billing tenant.
          </p>
        </div>

        {error && (
          <div
            style={{
              width: '100%',
              padding: '12px',
              borderRadius: '12px',
              backgroundColor: 'rgba(255, 107, 107, 0.15)',
              border: '1px solid rgba(255, 107, 107, 0.25)',
              color: '#ffb1b1',
              fontSize: '0.88rem',
              marginBottom: '16px',
              textAlign: 'left',
            }}
          >
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="sim-form" style={{ width: '100%', textAlign: 'left' }}>
          <div className="field-block" style={{ marginBottom: '14px' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Mail size={14} /> Email Address
            </span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="number-input"
              placeholder="name@company.com"
              required
              disabled={isSubmitting}
              style={{ paddingLeft: '16px' }}
            />
          </div>

          <div className="field-block" style={{ marginBottom: '20px' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <KeyRound size={14} /> Password
            </span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="number-input"
              placeholder="••••••••"
              required
              disabled={isSubmitting}
              style={{ paddingLeft: '16px' }}
            />
          </div>

          <button type="submit" className="btn btn-primary" style={{ width: '100%', padding: '14px' }} disabled={isSubmitting}>
            {isSubmitting ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <div style={{ marginTop: '24px', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
          Demo Accounts:
          <div style={{ marginTop: '6px', textAlign: 'left', display: 'grid', gap: '2px' }}>
            <div>• <strong>Owner:</strong> owner@scalebill.com / password123</div>
            <div>• <strong>Admin:</strong> admin@acme.com / password123</div>
            <div>• <strong>Viewer:</strong> viewer@acme.com / password123</div>
          </div>
        </div>
      </div>
    </main>
  );
}
