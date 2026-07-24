import { Request, Response, NextFunction } from 'express';
import { z, ZodSchema } from 'zod';

const tenantIdSlug = z
  .string()
  .min(1, 'tenantId is required')
  .regex(/^[a-z0-9-]+$/, 'tenantId must be a valid slug (lowercase letters, numbers, hyphens)');

const idempotencyKeyPattern = z
  .string()
  .regex(
    /^([a-zA-Z0-9-]+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i,
    'idempotencyKey must be alphanumeric or a valid UUID'
  );

export const usageIngestSchema = z.object({
  tenantId: tenantIdSlug.optional(),
  metric: z.enum(['api_calls', 'storage_gb', 'bandwidth_gb']),
  amount: z.number().positive('amount must be a positive number'),
  idempotencyKey: idempotencyKeyPattern.optional()
});

export const tenantCreateSchema = z.object({
  tenantId: tenantIdSlug,
  name: z.string().min(1, 'name is required'),
  planType: z.enum(['Starter', 'Pro', 'Enterprise']),
  email: z.string().email('email must be a valid email address')
});

export const loginSchema = z.object({
  email: z.string().email('email must be a valid email address'),
  password: z.string().min(1, 'password is required')
});

export const registerSchema = z.object({
  email: z.string().email('email must be a valid email address'),
  password: z.string().min(1, 'password is required'),
  role: z.enum(['owner', 'admin', 'viewer']),
  tenantIds: z.array(tenantIdSlug).optional()
});

export const tenantIdBodySchema = z.object({
  tenantId: tenantIdSlug
});

const tenantIdParamSchema = z.object({
  tenantId: tenantIdSlug
});

function formatValidationError(error: z.ZodError) {
  return error.issues.map((issue) => ({
    field: issue.path.join('.') || 'body',
    message: issue.message
  }));
}

export function validateBody(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: formatValidationError(result.error)
      });
    }
    req.body = result.data;
    next();
  };
}

export function validateTenantIdParam(req: Request, res: Response, next: NextFunction) {
  const result = tenantIdParamSchema.safeParse(req.params);
  if (!result.success) {
    return res.status(400).json({
      error: 'Validation failed',
      details: formatValidationError(result.error)
    });
  }
  next();
}
