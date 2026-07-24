import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { User, Tenant, IUser } from '../models';

export const JWT_SECRET = process.env.JWT_SECRET || 'default_jwt_secret_9999_key';
export const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'default_jwt_refresh_secret_8888_key';

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
    role: 'owner' | 'admin' | 'viewer';
    tenantIds: string[];
  };
  tenant?: any;
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function generateAccessToken(user: IUser) {
  return jwt.sign(
    { id: user._id, email: user.email, role: user.role, tenantIds: user.tenantIds },
    JWT_SECRET,
    { expiresIn: '15m' }
  );
}

export function generateRefreshToken(user: IUser) {
  return jwt.sign(
    { id: user._id },
    JWT_REFRESH_SECRET,
    { expiresIn: '7d' }
  );
}

export const requireAuth = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};

export const requireRole = (allowedRoles: string[]) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden: Insufficient privileges' });
    }
    next();
  };
};

export const requireTenantAccess = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  // Owners have global access
  if (req.user.role === 'owner') {
    return next();
  }

  const tenantId = req.params.tenantId || req.body.tenantId;
  if (!tenantId) {
    return res.status(400).json({ error: 'Tenant ID required for this action' });
  }

  if (!req.user.tenantIds.includes(tenantId)) {
    return res.status(403).json({ error: 'Forbidden: You do not have access to this tenant' });
  }

  next();
};

export const requireApiKey = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey || typeof apiKey !== 'string') {
    return res.status(401).json({ error: 'API key required' });
  }

  try {
    const tenant = await Tenant.findOne({ apiKey });
    if (!tenant) {
      return res.status(401).json({ error: 'Invalid API key' });
    }
    req.tenant = tenant;
    next();
  } catch (error) {
    return res.status(500).json({ error: 'API key verification failed' });
  }
};

export const requireAuthOrApiKey = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const apiKey = req.headers['x-api-key'];
  if (apiKey) {
    return requireApiKey(req, res, next);
  } else {
    return requireAuth(req, res, (err) => {
      if (err) return next(err);
      return requireTenantAccess(req, res, next);
    });
  }
};
