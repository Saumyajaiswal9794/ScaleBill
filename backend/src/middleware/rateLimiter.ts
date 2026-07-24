import { Request, Response, NextFunction } from 'express';
import { RateLimiterRedis } from 'rate-limiter-flexible';
import jwt from 'jsonwebtoken';
import { redis } from '../db';
import { Tenant } from '../models';
import { AuthenticatedRequest, JWT_SECRET } from './auth';

const PLAN_LIMITS: Record<'Starter' | 'Pro' | 'Enterprise', number> = {
  Starter: 100,
  Pro: 500,
  Enterprise: 2000
};

function createLimiter(keyPrefix: string, points: number, duration: number) {
  return new RateLimiterRedis({
    storeClient: redis,
    keyPrefix,
    points,
    duration
  });
}

const usageLimiters = {
  Starter: createLimiter('rl_usage_starter', PLAN_LIMITS.Starter, 60),
  Pro: createLimiter('rl_usage_pro', PLAN_LIMITS.Pro, 60),
  Enterprise: createLimiter('rl_usage_enterprise', PLAN_LIMITS.Enterprise, 60)
};

const loginRateLimiter = createLimiter('rl_login', 5, 15 * 60);
const generalRateLimiter = createLimiter('rl_api', 100, 60);

function getClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || req.socket.remoteAddress || 'unknown';
}

function getRateLimitKey(req: AuthenticatedRequest): string {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    try {
      const token = authHeader.split(' ')[1];
      const decoded = jwt.verify(token, JWT_SECRET) as { id?: string };
      if (decoded.id) {
        return `user:${decoded.id}`;
      }
    } catch {
      // Fall back to IP when token is missing or invalid.
    }
  }
  return `ip:${getClientIp(req)}`;
}

export const usageIngestionLimiter = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    let tenantId = req.body.tenantId as string | undefined;
    if (req.tenant) {
      tenantId = req.tenant.tenantId;
    }
    if (!tenantId) {
      return next();
    }

    const tenant = await Tenant.findOne({ tenantId });
    if (!tenant) {
      return next();
    }

    const limiter = usageLimiters[tenant.planType];
    const limit = PLAN_LIMITS[tenant.planType];

    try {
      await limiter.consume(tenantId);
      next();
    } catch (rejRes: unknown) {
      const rateLimitRes = rejRes as { msBeforeNext?: number };
      const retryAfter = Math.ceil((rateLimitRes.msBeforeNext ?? 60000) / 1000);
      res.set('Retry-After', String(retryAfter));
      console.warn(
        `[RateLimit] Usage ingestion blocked for tenant ${tenantId} (plan: ${tenant.planType})`
      );
      return res.status(429).json({
        error: 'Too many requests',
        message: `Usage ingestion rate limit exceeded. Plan limit: ${limit} requests per minute.`,
        tenantId,
        planType: tenant.planType,
        limit,
        retryAfter
      });
    }
  } catch (error) {
    next(error);
  }
};

export const loginLimiter = async (req: Request, res: Response, next: NextFunction) => {
  const ip = getClientIp(req);
  try {
    await loginRateLimiter.consume(ip);
    next();
  } catch (rejRes: unknown) {
    const rateLimitRes = rejRes as { msBeforeNext?: number };
    const retryAfter = Math.ceil((rateLimitRes.msBeforeNext ?? 900000) / 1000);
    res.set('Retry-After', String(retryAfter));
    console.warn(`[RateLimit] Login blocked for IP ${ip}`);
    return res.status(429).json({
      error: 'Too many requests',
      message: 'Too many login attempts. Please try again after 15 minutes.',
      retryAfter
    });
  }
};

export const generalApiLimiter = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  const key = getRateLimitKey(req);
  try {
    await generalRateLimiter.consume(key);
    next();
  } catch (rejRes: unknown) {
    const rateLimitRes = rejRes as { msBeforeNext?: number };
    const retryAfter = Math.ceil((rateLimitRes.msBeforeNext ?? 60000) / 1000);
    res.set('Retry-After', String(retryAfter));
    console.warn(`[RateLimit] General API blocked for ${key}`);
    return res.status(429).json({
      error: 'Too many requests',
      message: 'API rate limit exceeded. Limit: 100 requests per minute.',
      retryAfter
    });
  }
};

export function shouldSkipGeneralRateLimit(path: string): boolean {
  return path.startsWith('/api/auth') || path === '/api/usage';
}
