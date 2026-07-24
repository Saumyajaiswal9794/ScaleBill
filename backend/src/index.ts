import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import cookieParser from 'cookie-parser';
import PDFDocument from 'pdfkit';
import { connectDB, redis } from './db';
import { Tenant, UsageEvent, Invoice, Alert, User } from './models';
import { calculateBilling, PLAN_PRICING } from './pricing';
import { processTenantInvoice } from './workers/invoiceWorker';
import { checkTenantUsageAlerts } from './workers/alertWorker';
import { getBillingPeriod, getRedisUsageKey, getTenantBillingAnchorDay } from './billingPeriod';
import {
  requireAuth,
  requireRole,
  requireTenantAccess,
  requireAuthOrApiKey,
  generateAccessToken,
  generateRefreshToken,
  hashToken,
  AuthenticatedRequest
} from './middleware/auth';
import {
  generalApiLimiter,
  loginLimiter,
  usageIngestionLimiter,
  shouldSkipGeneralRateLimit
} from './middleware/rateLimiter';
import {
  validateBody,
  validateTenantIdParam,
  usageIngestSchema,
  tenantCreateSchema,
  loginSchema,
  registerSchema,
  tenantIdBodySchema
} from './middleware/validation';

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors({
  origin: 'http://localhost:3000',
  credentials: true
}));
app.use(express.json());
app.use(cookieParser());

// Serve static invoice PDFs
const INVOICES_DIR = path.join(__dirname, '../../../invoices');
if (!fs.existsSync(INVOICES_DIR)) {
  fs.mkdirSync(INVOICES_DIR, { recursive: true });
}
app.use('/invoices', express.static(INVOICES_DIR));

app.use((req, res, next) => {
  if (shouldSkipGeneralRateLimit(req.path)) {
    return next();
  }
  return generalApiLimiter(req as AuthenticatedRequest, res, next);
});

// Authentication endpoints
app.post('/api/auth/register', validateBody(registerSchema), async (req, res) => {
  try {
    const { email, password, role, tenantIds } = req.body;
    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      return res.status(400).json({ error: 'Email already registered' });
    }
    const passwordHash = await bcrypt.hash(password, 10);
    const user = new User({
      email: email.toLowerCase(),
      passwordHash,
      role,
      tenantIds: tenantIds || []
    });
    await user.save();
    res.status(201).json({ message: 'User registered successfully', userId: user._id });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Registration failed' });
  }
});

app.post('/api/auth/login', loginLimiter, validateBody(loginSchema), async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);

    const hashed = hashToken(refreshToken);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    user.refreshTokens.push({ tokenHash: hashed, expiresAt });
    user.refreshTokens = user.refreshTokens.filter(rt => rt.expiresAt > new Date());
    await user.save();

    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });

    res.json({
      accessToken,
      user: {
        id: user._id,
        email: user.email,
        role: user.role,
        tenantIds: user.tenantIds
      }
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Login failed' });
  }
});

app.post('/api/auth/refresh', async (req, res) => {
  try {
    const refreshToken = req.cookies.refreshToken;
    if (!refreshToken) {
      return res.status(401).json({ error: 'Refresh token required' });
    }

    let decoded: any;
    try {
      const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'default_jwt_refresh_secret_8888_key';
      decoded = jwt.verify(refreshToken, JWT_REFRESH_SECRET);
    } catch (e) {
      return res.status(401).json({ error: 'Invalid or expired refresh token' });
    }

    const user = await User.findById(decoded.id);
    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    const hashed = hashToken(refreshToken);
    const tokenIndex = user.refreshTokens.findIndex(rt => rt.tokenHash === hashed && rt.expiresAt > new Date());
    if (tokenIndex === -1) {
      return res.status(401).json({ error: 'Invalid, revoked, or expired refresh token' });
    }

    const newAccessToken = generateAccessToken(user);
    const newRefreshToken = generateRefreshToken(user);
    const newHashed = hashToken(newRefreshToken);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    user.refreshTokens[tokenIndex] = { tokenHash: newHashed, expiresAt };
    user.refreshTokens = user.refreshTokens.filter(rt => rt.expiresAt > new Date());
    await user.save();

    res.cookie('refreshToken', newRefreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });

    res.json({
      accessToken: newAccessToken,
      user: {
        id: user._id,
        email: user.email,
        role: user.role,
        tenantIds: user.tenantIds
      }
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Token refresh failed' });
  }
});

app.post('/api/auth/logout', async (req, res) => {
  try {
    const refreshToken = req.cookies.refreshToken;
    if (refreshToken) {
      const hashed = hashToken(refreshToken);
      try {
        const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'default_jwt_refresh_secret_8888_key';
        const decoded = jwt.verify(refreshToken, JWT_REFRESH_SECRET) as any;
        const user = await User.findById(decoded.id);
        if (user) {
          user.refreshTokens = user.refreshTokens.filter(rt => rt.tokenHash !== hashed);
          await user.save();
        }
      } catch (e) {
        // Suppress error
      }
    }
    res.clearCookie('refreshToken', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax'
    });
    res.json({ success: true, message: 'Logged out successfully' });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Logout failed' });
  }
});

// 1. Get all tenants
app.get('/api/tenants', requireAuth, requireRole(['owner', 'admin']), async (req: AuthenticatedRequest, res) => {
  try {
    // Owners see all tenants; admins see only tenants they have access to
    const query = req.user?.role === 'owner' ? {} : { tenantId: { $in: req.user?.tenantIds || [] } };
    const tenants = await Tenant.find(query).sort({ name: 1 });
    res.json(tenants);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch tenants' });
  }
});

// 2. Create tenant
app.post('/api/tenants', requireAuth, requireRole(['owner']), validateBody(tenantCreateSchema), async (req: AuthenticatedRequest, res) => {
  try {
    const { tenantId, name, planType, email } = req.body;
    const pricing = PLAN_PRICING[planType as 'Starter' | 'Pro' | 'Enterprise'];

    const apiKey = `key_${tenantId}_${Math.random().toString(36).substring(2, 10)}`;

    const tenant = new Tenant({
      tenantId,
      name,
      planType,
      email,
      apiLimit: pricing.apiLimit,
      storageLimit: pricing.storageLimit,
      bandwidthLimit: pricing.bandwidthLimit,
      billingAnchorDay: new Date().getDate(),
      apiKey
    });

    await tenant.save();

    const period = getBillingPeriod(new Date(), getTenantBillingAnchorDay(tenant));

    // Reset Redis counters for new tenant
    await redis.set(getRedisUsageKey(tenantId, 'api_calls', period.periodKey), '0');
    await redis.set(getRedisUsageKey(tenantId, 'storage_gb', period.periodKey), '0');
    await redis.set(getRedisUsageKey(tenantId, 'bandwidth_gb', period.periodKey), '0');

    res.status(201).json(tenant);
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to create tenant' });
  }
});

// 3. Ingest usage event
app.post('/api/usage', validateBody(usageIngestSchema), requireAuthOrApiKey, usageIngestionLimiter, async (req: AuthenticatedRequest, res) => {
  try {
    let tenantId = req.body.tenantId;
    if (req.tenant) {
      if (tenantId && tenantId !== req.tenant.tenantId) {
        return res.status(403).json({ error: 'Forbidden: API key does not match the requested tenantId' });
      }
      tenantId = req.tenant.tenantId;
    }

    const { metric, amount, idempotencyKey } = req.body;

    if (!tenantId) {
      return res.status(400).json({ error: 'Missing required parameters', details: [{ field: 'tenantId', message: 'tenantId is required' }] });
    }

    const tenant = await Tenant.findOne({ tenantId });
    if (!tenant) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    const billingAnchorDay = getTenantBillingAnchorDay(tenant);
    const currentPeriod = getBillingPeriod(new Date(), billingAnchorDay);

    if (idempotencyKey) {
      const existingEvent = await UsageEvent.findOne({ idempotencyKey });
      if (existingEvent) {
        const currentTotal = parseFloat((await redis.get(getRedisUsageKey(tenantId, metric, currentPeriod.periodKey))) || '0');
        return res.json({
          success: true,
          deduplicated: true,
          tenantId,
          metric,
          increment: 0,
          currentTotal
        });
      }
    }

    // Increments counter in Redis atomically
    const redisKey = getRedisUsageKey(tenantId, metric, currentPeriod.periodKey);
    const newUsage = await redis.incrbyfloat(redisKey, amount);

    // Save event to MongoDB asynchronously
    const event = new UsageEvent({
      tenantId,
      metric,
      amount,
      idempotencyKey
    });
    await event.save();

    // Trigger alert checks in background asynchronously
    checkTenantUsageAlerts(tenant).catch((err) =>
      console.error('Error running alert checks:', err)
    );

    res.json({
      success: true,
      tenantId,
      metric,
      increment: amount,
      currentTotal: newUsage
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to ingest usage' });
  }
});

// 4. Get tenant dashboard details
app.get('/api/dashboard/:tenantId', requireAuth, validateTenantIdParam, requireTenantAccess, async (req: AuthenticatedRequest, res) => {
  try {
    const { tenantId } = req.params;
    const tenant = await Tenant.findOne({ tenantId });
    if (!tenant) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    // Get usage from Redis
    const currentPeriod = getBillingPeriod(new Date(), getTenantBillingAnchorDay(tenant));
    const api_calls = parseFloat((await redis.get(getRedisUsageKey(tenantId, 'api_calls', currentPeriod.periodKey))) || '0');
    const storage_gb = parseFloat((await redis.get(getRedisUsageKey(tenantId, 'storage_gb', currentPeriod.periodKey))) || '0');
    const bandwidth_gb = parseFloat((await redis.get(getRedisUsageKey(tenantId, 'bandwidth_gb', currentPeriod.periodKey))) || '0');

    const usageSummary = { api_calls, storage_gb, bandwidth_gb };

    // Calculate billing
    const billing = calculateBilling(tenant.planType, usageSummary);

    // Fetch monthly usage summary for the current billing period
    const monthlyUsage = await UsageEvent.aggregate([
      {
        $match: {
          tenantId,
          timestamp: { $gte: currentPeriod.periodStart, $lte: currentPeriod.periodEnd }
        }
      },
      {
        $group: {
          _id: '$metric',
          eventCount: { $sum: 1 },
          totalUsage: { $sum: '$amount' }
        }
      }
    ]);

    const monthlyBreakdown = ['api_calls', 'storage_gb', 'bandwidth_gb'].map((metric) => {
      const item = monthlyUsage.find((entry) => entry._id === metric);
      const totalUsage = item?.totalUsage || 0;
      const eventCount = item?.eventCount || 0;

      let charge = 0;
      if (metric === 'api_calls') {
        charge = Math.max(0, totalUsage - tenant.apiLimit) * PLAN_PRICING[tenant.planType].apiOverageRate;
      } else if (metric === 'storage_gb') {
        charge = Math.max(0, totalUsage - tenant.storageLimit) * PLAN_PRICING[tenant.planType].storageOverageRate;
      } else if (metric === 'bandwidth_gb') {
        charge = Math.max(0, totalUsage - tenant.bandwidthLimit) * PLAN_PRICING[tenant.planType].bandwidthOverageRate;
      }

      return {
        metric,
        eventCount,
        totalUsage: parseFloat(totalUsage.toFixed(2)),
        charge: parseFloat(charge.toFixed(2))
      };
    });

    // Fetch invoice history
    const invoices = await Invoice.find({ tenantId }).sort({ periodEnd: -1 }).limit(10);

    // Fetch active alerts
    const alerts = await Alert.find({ tenantId }).sort({ createdAt: -1 }).limit(5);

    // Fetch historical usage (aggregated by day for the last 14 days)
    const twoWeeksAgo = new Date();
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);

    const history = await UsageEvent.aggregate([
      {
        $match: {
          tenantId,
          timestamp: { $gte: twoWeeksAgo }
        }
      },
      {
        $group: {
          _id: {
            day: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } },
            metric: '$metric'
          },
          total: { $sum: '$amount' }
        }
      },
      {
        $group: {
          _id: '$_id.day',
          metrics: {
            $push: {
              k: '$_id.metric',
              v: '$total'
            }
          }
        }
      },
      {
        $project: {
          day: '$_id',
          data: { $arrayToObject: '$metrics' }
        }
      },
      {
        $sort: { day: 1 }
      }
    ]);

    // Format historical charts data
    const formattedHistory = history.map((item) => ({
      name: item.day,
      api_calls: item.data.api_calls || 0,
      storage_gb: parseFloat((item.data.storage_gb || 0).toFixed(2)),
      bandwidth_gb: parseFloat((item.data.bandwidth_gb || 0).toFixed(2))
    }));

    res.json({
      tenant,
      usage: usageSummary,
      billing,
      monthlyBreakdown,
      currentPeriod: {
        periodKey: currentPeriod.periodKey,
        periodStart: currentPeriod.periodStart,
        periodEnd: currentPeriod.periodEnd
      },
      invoices,
      alerts,
      history: formattedHistory
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to fetch dashboard data' });
  }
});

// 5. Trigger manual invoice generation
app.post('/api/invoices/generate', requireAuth, requireRole(['owner', 'admin']), validateBody(tenantIdBodySchema), requireTenantAccess, async (req: AuthenticatedRequest, res) => {
  try {
    const { tenantId } = req.body;
    const tenant = await Tenant.findOne({ tenantId });
    if (!tenant) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    const period = getBillingPeriod(new Date(), getTenantBillingAnchorDay(tenant));
    const start = period.periodStart;
    const end = period.periodEnd;

    const invoice = await processTenantInvoice(tenant, start, end);
    res.json({ success: true, invoice });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to generate invoice' });
  }
});

// 6. Manual Alert Check
app.post('/api/alerts/check', requireAuth, requireRole(['owner', 'admin']), validateBody(tenantIdBodySchema), requireTenantAccess, async (req: AuthenticatedRequest, res) => {
  try {
    const { tenantId } = req.body;
    const tenant = await Tenant.findOne({ tenantId });
    if (!tenant) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    const alertsTriggered = await checkTenantUsageAlerts(tenant);
    res.json({ success: true, alertsTriggered });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to run alert checks' });
  }
});

// 7. Seed Database endpoint
app.post('/api/seed', async (req, res) => {
  try {
    if (process.env.NODE_ENV === 'production') {
      return res.status(403).json({ error: 'Seeding is disabled in non-development environments' });
    }

    // Clear old records
    await Tenant.deleteMany({});
    await UsageEvent.deleteMany({});
    await Invoice.deleteMany({});
    await Alert.deleteMany({});
    await User.deleteMany({});

    // Create default tenants with hardcoded API keys for predictable local testing
    const sampleTenants = [
      {
        tenantId: 'acme',
        name: 'Acme Corp',
        planType: 'Starter',
        email: 'billing@acme.com',
        apiLimit: PLAN_PRICING.Starter.apiLimit,
        storageLimit: PLAN_PRICING.Starter.storageLimit,
        bandwidthLimit: PLAN_PRICING.Starter.bandwidthLimit,
        billingAnchorDay: 1,
        apiKey: 'key_acme_123'
      },
      {
        tenantId: 'betalabs',
        name: 'BetaLabs Inc',
        planType: 'Pro',
        email: 'billing@betalabs.io',
        apiLimit: PLAN_PRICING.Pro.apiLimit,
        storageLimit: PLAN_PRICING.Pro.storageLimit,
        bandwidthLimit: PLAN_PRICING.Pro.bandwidthLimit,
        billingAnchorDay: 1,
        apiKey: 'key_betalabs_123'
      },
      {
        tenantId: 'sigma',
        name: 'Sigma Enterprise',
        planType: 'Enterprise',
        email: 'billing@sigma.com',
        apiLimit: PLAN_PRICING.Enterprise.apiLimit,
        storageLimit: PLAN_PRICING.Enterprise.storageLimit,
        bandwidthLimit: PLAN_PRICING.Enterprise.bandwidthLimit,
        billingAnchorDay: 1,
        apiKey: 'key_sigma_123'
      }
    ];

    const tenants = await Tenant.insertMany(sampleTenants);

    // Create default users (password: 'password123')
    const defaultPasswordHash = await bcrypt.hash('password123', 10);
    const sampleUsers = [
      {
        email: 'owner@scalebill.com',
        passwordHash: defaultPasswordHash,
        role: 'owner',
        tenantIds: ['acme', 'betalabs', 'sigma']
      },
      {
        email: 'admin@acme.com',
        passwordHash: defaultPasswordHash,
        role: 'admin',
        tenantIds: ['acme']
      },
      {
        email: 'viewer@acme.com',
        passwordHash: defaultPasswordHash,
        role: 'viewer',
        tenantIds: ['acme']
      }
    ];
    await User.insertMany(sampleUsers);

    // Seed mock data for each tenant
    for (const t of tenants) {
      const period = getBillingPeriod(new Date(), getTenantBillingAnchorDay(t));
      // Set Redis current month values
      let apiUsage = 0;
      let storageUsage = 0;
      let bandwidthUsage = 0;

      if (t.planType === 'Starter') {
        // High usage to showcase overage
        apiUsage = 12500; // limit is 10k
        storageUsage = 6.2; // limit is 5GB
        bandwidthUsage = 48.0; // limit is 50GB
      } else if (t.planType === 'Pro') {
        // Near threshold usage to trigger alerts
        apiUsage = 85000; // 85% of limit (100k)
        storageUsage = 42; // 84% of limit (50GB)
        bandwidthUsage = 280; // 56% of limit (500GB)
      } else {
        // Normal usage
        apiUsage = 340000;
        storageUsage = 150;
        bandwidthUsage = 1200;
      }

      await redis.set(getRedisUsageKey(t.tenantId, 'api_calls', period.periodKey), apiUsage.toString());
      await redis.set(getRedisUsageKey(t.tenantId, 'storage_gb', period.periodKey), storageUsage.toString());
      await redis.set(getRedisUsageKey(t.tenantId, 'bandwidth_gb', period.periodKey), bandwidthUsage.toString());

      // Write historical events for the last 14 days
      const batchEvents = [];
      for (let i = 14; i >= 0; i--) {
        const date = new Date();
        date.setDate(date.getDate() - i);

        // Daily variations
        const dailyApi = Math.floor((apiUsage / 15) * (0.8 + Math.random() * 0.4));
        const dailyStorage = parseFloat((storageUsage / 15 * (0.9 + Math.random() * 0.2)).toFixed(2));
        const dailyBandwidth = parseFloat((bandwidthUsage / 15 * (0.7 + Math.random() * 0.6)).toFixed(2));

        batchEvents.push({
          tenantId: t.tenantId,
          metric: 'api_calls',
          amount: dailyApi,
          timestamp: date
        });
        batchEvents.push({
          tenantId: t.tenantId,
          metric: 'storage_gb',
          amount: dailyStorage,
          timestamp: date
        });
        batchEvents.push({
          tenantId: t.tenantId,
          metric: 'bandwidth_gb',
          amount: dailyBandwidth,
          timestamp: date
        });
      }

      await UsageEvent.insertMany(batchEvents);

      // Create prior month's invoice
      const startOfLastMonth = new Date();
      startOfLastMonth.setMonth(startOfLastMonth.getMonth() - 1);
      startOfLastMonth.setDate(1);

      const endOfLastMonth = new Date();
      endOfLastMonth.setDate(0); // Last day of previous month

      // Last month usage (mocked)
      const lastMonthSummary = {
        api_calls: Math.floor(apiUsage * 0.9),
        storage_gb: parseFloat((storageUsage * 0.95).toFixed(2)),
        bandwidth_gb: parseFloat((bandwidthUsage * 0.9).toFixed(2))
      };

      const pricingInfo = calculateBilling(t.planType as 'Starter' | 'Pro' | 'Enterprise', lastMonthSummary);
      const invoiceNumber = `INV-${t.tenantId.toUpperCase()}-${Math.floor(100000 + Math.random() * 900000)}`;
      const pdfFilename = `${invoiceNumber}.pdf`;
      const pdfPath = path.join(INVOICES_DIR, pdfFilename);

      await generateMockInvoicePdf(pdfPath, invoiceNumber, t, startOfLastMonth, endOfLastMonth, lastMonthSummary, pricingInfo);

      const oldInvoice = new Invoice({
        tenantId: t.tenantId,
        invoiceNumber,
        periodStart: startOfLastMonth,
        periodEnd: endOfLastMonth,
        baseFee: pricingInfo.baseFee,
        overageFee: pricingInfo.totalOverage,
        totalFee: pricingInfo.totalFee,
        usageSummary: lastMonthSummary,
        pdfPath: `/invoices/${pdfFilename}`,
        status: 'Paid',
        emailSent: true
      });

      await oldInvoice.save();

      // Trigger threshold check
      await checkTenantUsageAlerts(t as any);
    }

    res.json({ success: true, message: 'Database successfully seeded with mock data' });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Seeding failed' });
  }
});

// Helper for generating PDF inside seed endpoint
function generateMockInvoicePdf(
  pdfPath: string,
  invoiceNumber: string,
  tenant: any,
  start: Date,
  end: Date,
  summary: any,
  billing: any
): Promise<void> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const writeStream = fs.createWriteStream(pdfPath);
    doc.pipe(writeStream);

    doc.fillColor('#444444').fontSize(20).text('SCALEBILL INVOICE', { align: 'right' });
    doc.fontSize(10).text(`Invoice #: ${invoiceNumber}`, { align: 'right' });
    doc.text(`Billing Period: ${start.toLocaleDateString()} - ${end.toLocaleDateString()}`, { align: 'right' });

    doc.moveDown();
    doc.fontSize(12).text('Bill To:', { underline: true });
    doc.fontSize(10).text(`Tenant Name: ${tenant.name}`);
    doc.text(`Plan Type: ${tenant.planType}`);

    doc.moveDown(2);
    doc.text('Resource Metric', 50, 200);
    doc.text('Consumption', 200, 200);
    doc.text('Cost (INR)', 480, 200, { align: 'right' });
    doc.moveTo(50, 215).lineTo(550, 215).stroke();

    doc.text(`Base Subscription Fee`, 50, 225);
    doc.text(`INR ${billing.baseFee.toFixed(2)}`, 480, 225, { align: 'right' });

    doc.text(`Overage Charges`, 50, 250);
    doc.text(`INR ${billing.totalOverage.toFixed(2)}`, 480, 250, { align: 'right' });

    doc.moveTo(50, 280).lineTo(550, 280).stroke();
    doc.fontSize(12).text('Total Amount Paid:', 50, 300);
    doc.text(`INR ${billing.totalFee.toFixed(2)}`, 480, 300, { align: 'right' });

    doc.end();
    writeStream.on('finish', () => resolve());
    writeStream.on('error', (err) => reject(err));
  });
}

// Start Server
connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(`Backend server running on http://localhost:${PORT}`);
  });
});
