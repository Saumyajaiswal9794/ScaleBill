import mongoose, { Schema, Document } from 'mongoose';

// Plan limits & Pricing
export interface ITenant extends Document {
  tenantId: string;
  name: string;
  planType: 'Starter' | 'Pro' | 'Enterprise';
  email: string;
  apiLimit: number;
  storageLimit: number; // in GB
  bandwidthLimit: number; // in GB
  billingAnchorDay: number;
  createdAt: Date;
}

const TenantSchema: Schema = new Schema({
  tenantId: { type: String, required: true, unique: true, index: true },
  name: { type: String, required: true },
  planType: { type: String, enum: ['Starter', 'Pro', 'Enterprise'], required: true },
  email: { type: String, required: true },
  apiLimit: { type: Number, required: true },
  storageLimit: { type: Number, required: true },
  bandwidthLimit: { type: Number, required: true },
  billingAnchorDay: { type: Number, required: true, default: 1 },
  createdAt: { type: Date, default: Date.now }
});

// Composite index for rapid querying by tenant and date
TenantSchema.index({ tenantId: 1, createdAt: -1 });

export interface IUsageEvent extends Document {
  tenantId: string;
  metric: 'api_calls' | 'storage_gb' | 'bandwidth_gb';
  amount: number;
  idempotencyKey?: string;
  timestamp: Date;
}

const UsageEventSchema: Schema = new Schema({
  tenantId: { type: String, required: true, index: true },
  metric: { type: String, enum: ['api_calls', 'storage_gb', 'bandwidth_gb'], required: true },
  amount: { type: Number, required: true },
  idempotencyKey: { type: String, required: false, sparse: true, index: true },
  timestamp: { type: Date, default: Date.now, index: true }
});

UsageEventSchema.index({ tenantId: 1, metric: 1, timestamp: -1 });
UsageEventSchema.index({ idempotencyKey: 1 }, { unique: true, sparse: true });

export interface IInvoice extends Document {
  tenantId: string;
  invoiceNumber: string;
  periodStart: Date;
  periodEnd: Date;
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
  createdAt: Date;
  emailSent: boolean;
}

const InvoiceSchema: Schema = new Schema({
  tenantId: { type: String, required: true, index: true },
  invoiceNumber: { type: String, required: true, unique: true },
  periodStart: { type: Date, required: true },
  periodEnd: { type: Date, required: true },
  baseFee: { type: Number, required: true },
  overageFee: { type: Number, required: true },
  totalFee: { type: Number, required: true },
  usageSummary: {
    api_calls: { type: Number, default: 0 },
    storage_gb: { type: Number, default: 0 },
    bandwidth_gb: { type: Number, default: 0 }
  },
  pdfPath: { type: String, required: true },
  status: { type: String, enum: ['Paid', 'Pending', 'Overdue'], default: 'Pending' },
  createdAt: { type: Date, default: Date.now },
  emailSent: { type: Boolean, default: false }
});

InvoiceSchema.index({ tenantId: 1, createdAt: -1 });

export interface IAlert extends Document {
  tenantId: string;
  metric: 'api_calls' | 'storage_gb' | 'bandwidth_gb';
  thresholdType: '80%' | '95%';
  usageValue: number;
  limitValue: number;
  periodKey: string;
  createdAt: Date;
}

const AlertSchema: Schema = new Schema({
  tenantId: { type: String, required: true, index: true },
  metric: { type: String, enum: ['api_calls', 'storage_gb', 'bandwidth_gb'], required: true },
  thresholdType: { type: String, enum: ['80%', '95%'], required: true },
  usageValue: { type: Number, required: true },
  limitValue: { type: Number, required: true },
  periodKey: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});

AlertSchema.index({ tenantId: 1, metric: 1, thresholdType: 1, periodKey: 1 }, { unique: true });
AlertSchema.index({ tenantId: 1, createdAt: -1 });

export interface IInvoiceCounter extends Document {
  tenantId: string;
  periodKey: string;
  sequence: number;
  createdAt: Date;
}

const InvoiceCounterSchema: Schema = new Schema({
  tenantId: { type: String, required: true },
  periodKey: { type: String, required: true },
  sequence: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});

InvoiceCounterSchema.index({ tenantId: 1, periodKey: 1 }, { unique: true });

export const Tenant = mongoose.model<ITenant>('Tenant', TenantSchema);
export const UsageEvent = mongoose.model<IUsageEvent>('UsageEvent', UsageEventSchema);
export const Invoice = mongoose.model<IInvoice>('Invoice', InvoiceSchema);
export const Alert = mongoose.model<IAlert>('Alert', AlertSchema);
export const InvoiceCounter = mongoose.model<IInvoiceCounter>('InvoiceCounter', InvoiceCounterSchema);

