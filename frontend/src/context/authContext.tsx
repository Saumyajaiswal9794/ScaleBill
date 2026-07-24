'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';

interface User {
  id: string;
  email: string;
  role: 'owner' | 'admin' | 'viewer';
  tenantIds: string[];
}

interface AuthContextType {
  user: User | null;
  accessToken: string | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  getAuthHeaders: () => Record<string, string>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const API_BASE = 'http://localhost:4000/api';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  const handleRefresh = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (res.ok) {
        const data = await res.json();
        setAccessToken(data.accessToken);
        setUser(data.user);
        return data.accessToken;
      } else {
        // Clear auth state if refresh fails
        setAccessToken(null);
        setUser(null);
      }
    } catch (err) {
      console.error('Silent refresh failed:', err);
    }
    return null;
  }, []);

  // Check login status on mount
  useEffect(() => {
    const initAuth = async () => {
      await handleRefresh();
      setLoading(false);
    };
    initAuth();
  }, [handleRefresh]);

  // Set up periodic refresh (~14 minutes for a 15-minute token)
  useEffect(() => {
    if (!accessToken) return;

    const interval = setInterval(async () => {
      await handleRefresh();
    }, 14 * 60 * 1000);

    return () => clearInterval(interval);
  }, [accessToken, handleRefresh]);

  const login = async (email: string, password: string) => {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    if (!res.ok) {
      const errorData = await res.json();
      throw new Error(errorData.error || 'Invalid credentials');
    }

    const data = await res.json();
    setAccessToken(data.accessToken);
    setUser(data.user);
    router.push('/');
  };

  const logout = async () => {
    try {
      await fetch(`${API_BASE}/auth/logout`, {
        method: 'POST',
      });
    } catch (err) {
      console.error('Logout request failed:', err);
    } finally {
      setAccessToken(null);
      setUser(null);
      router.push('/login');
    }
  };

  const getAuthHeaders = useCallback(() => {
    return accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
  }, [accessToken]);

  return (
    <AuthContext.Provider value={{ user, accessToken, loading, login, logout, getAuthHeaders }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
