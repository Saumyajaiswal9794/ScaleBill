import fs from 'fs';
import path from 'path';
import PDFDocument from 'pdfkit';
import { Tenant, UsageEvent, Invoice, InvoiceCounter, ITenant } from '../models';
import { calculateBilling, PLAN_PRICING } from '../pricing';
import { getBillingPeriod, getTenantBillingAnchorDay } from '../billingPeriod';

const INVOICE_DIR = path.join(__dirname, '../../../invoices');

// Ensure invoice output directory exists
if (!fs.existsSync(INVOICE_DIR)) {
  fs.mkdirSync(INVOICE_DIR, { recursive: true });
}

export async function processTenantInvoice(tenant: ITenant, start: Date, end: Date) {
  // Aggregate usage from MongoDB
  const usageResults = await UsageEvent.aggregate([
    {
      $match: {
        tenantId: tenant.tenantId,
        timestamp: { $gte: start, $lte: end }
      }
    },
    {
      $group: {
        _id: '$metric',
        total: { $sum: '$amount' }
      }
    }
  ]);

  const usageSummary = {
    api_calls: 0,
    storage_gb: 0,
    bandwidth_gb: 0
  };

  usageResults.forEach((item) => {
    if (item._id === 'api_calls') usageSummary.api_calls = item.total;
    if (item._id === 'storage_gb') usageSummary.storage_gb = item.total;
    if (item._id === 'bandwidth_gb') usageSummary.bandwidth_gb = item.total;
  });

  // Calculate fees
  const billingInfo = calculateBilling(tenant.planType, usageSummary);

  const billingAnchorDay = getTenantBillingAnchorDay(tenant);
  const period = getBillingPeriod(start, billingAnchorDay);
  const shortCode = tenant.tenantId.replace(/[^A-Za-z0-9]/g, '').toUpperCase() || 'TENANT';
  const counter = await InvoiceCounter.findOneAndUpdate(
    { tenantId: tenant.tenantId, periodKey: period.periodKey },
    { $inc: { sequence: 1 }, $setOnInsert: { createdAt: new Date() } },
    { new: true, upsert: true }
  );
  const sequence = counter?.sequence || 1;
  const invoiceNumber = `${shortCode}-${period.periodKey.replace('-', '')}-${sequence}`;
  const pdfFilename = `${invoiceNumber}.pdf`;
  const pdfPath = path.join(INVOICE_DIR, pdfFilename);

  // Generate PDF Invoice using PDFKit
  await generatePDFInvoice({
    tenant,
    invoiceNumber,
    periodStart: start,
    periodEnd: end,
    usageSummary,
    billingInfo,
    pdfPath
  });

  // Save invoice record in MongoDB
  const newInvoice = new Invoice({
    tenantId: tenant.tenantId,
    invoiceNumber,
    periodStart: start,
    periodEnd: end,
    baseFee: billingInfo.baseFee,
    overageFee: billingInfo.totalOverage,
    totalFee: billingInfo.totalFee,
    usageSummary,
    pdfPath: `/invoices/${pdfFilename}`,
    status: 'Pending',
    emailSent: true
  });

  await newInvoice.save();

  // Simulate AWS SES and S3 actions
  console.log(`[AWS S3] Uploaded ${pdfFilename} to bucket ${process.env.S3_BUCKET || 'billing-platform-invoices'}`);
  console.log(`[AWS SES] Sent invoice email from ${process.env.SES_FROM_EMAIL || 'billing@example.com'} to ${tenant.email}`);

  return newInvoice;
}

interface InvoicePdfData {
  tenant: ITenant;
  invoiceNumber: string;
  periodStart: Date;
  periodEnd: Date;
  usageSummary: {
    api_calls: number;
    storage_gb: number;
    bandwidth_gb: number;
  };
  billingInfo: ReturnType<typeof calculateBilling>;
  pdfPath: string;
}

function generatePDFInvoice(data: InvoicePdfData): Promise<void> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const writeStream = fs.createWriteStream(data.pdfPath);

    doc.pipe(writeStream);

    // Header
    doc
      .fillColor('#444444')
      .fontSize(20)
      .text('SCALEBILL INVOICE', { align: 'right' })
      .fontSize(10)
      .text(`Invoice #: ${data.invoiceNumber}`, { align: 'right' })
      .text(`Date: ${new Date().toLocaleDateString()}`, { align: 'right' })
      .text(`Billing Period: ${data.periodStart.toLocaleDateString()} - ${data.periodEnd.toLocaleDateString()}`, { align: 'right' });

    doc.moveDown();

    // Client Details
    doc
      .fontSize(12)
      .fillColor('#000000')
      .text('Bill To:', { underline: true })
      .fontSize(10)
      .text(`Tenant Name: ${data.tenant.name}`)
      .text(`Tenant ID: ${data.tenant.tenantId}`)
      .text(`Email: ${data.tenant.email}`)
      .text(`Subscription Plan: ${data.tenant.planType}`);

    doc.moveDown(2);

    // Table Header
    const tableTop = 230;
    doc
      .fontSize(10)
      .fillColor('#333333')
      .text('Resource Metric', 50, tableTop)
      .text('Consumption', 200, tableTop)
      .text('Plan Limit', 300, tableTop)
      .text('Overage Rate', 400, tableTop)
      .text('Cost (INR)', 480, tableTop, { align: 'right' });

    doc.moveTo(50, tableTop + 15).lineTo(550, tableTop + 15).strokeColor('#cccccc').stroke();

    // Row: Base Subscription
    let rowY = tableTop + 25;
    doc
      .fillColor('#000000')
      .text(`Base Plan Subscription (${data.tenant.planType})`, 50, rowY)
      .text('-', 200, rowY)
      .text('-', 300, rowY)
      .text('-', 400, rowY)
      .text(`INR ${data.billingInfo.baseFee.toFixed(2)}`, 480, rowY, { align: 'right' });

    // Row: API Calls
    rowY += 25;
    const plan = PLAN_PRICING[data.tenant.planType];
    const apiOverageAmount = data.usageSummary.api_calls - plan.apiLimit;
    const apiOverageCost = apiOverageAmount > 0 ? apiOverageAmount * plan.apiOverageRate : 0;
    doc
      .text('API Ingestion Calls', 50, rowY)
      .text(data.usageSummary.api_calls.toLocaleString(), 200, rowY)
      .text(plan.apiLimit.toLocaleString(), 300, rowY)
      .text(`INR ${plan.apiOverageRate.toFixed(2)} / call`, 400, rowY)
      .text(`INR ${apiOverageCost.toFixed(2)}`, 480, rowY, { align: 'right' });

    // Row: Storage GB
    rowY += 25;
    const storageOverageAmount = data.usageSummary.storage_gb - plan.storageLimit;
    const storageOverageCost = storageOverageAmount > 0 ? storageOverageAmount * plan.storageOverageRate : 0;
    doc
      .text('Storage (GB-Months)', 50, rowY)
      .text(`${data.usageSummary.storage_gb.toFixed(2)} GB`, 200, rowY)
      .text(`${plan.storageLimit} GB`, 300, rowY)
      .text(`INR ${plan.storageOverageRate.toFixed(2)} / GB`, 400, rowY)
      .text(`INR ${storageOverageCost.toFixed(2)}`, 480, rowY, { align: 'right' });

    // Row: Bandwidth GB
    rowY += 25;
    const bandwidthOverageAmount = data.usageSummary.bandwidth_gb - plan.bandwidthLimit;
    const bandwidthOverageCost = bandwidthOverageAmount > 0 ? bandwidthOverageAmount * plan.bandwidthOverageRate : 0;
    doc
      .text('Data Transfer (Bandwidth)', 50, rowY)
      .text(`${data.usageSummary.bandwidth_gb.toFixed(2)} GB`, 200, rowY)
      .text(`${plan.bandwidthLimit} GB`, 300, rowY)
      .text(`INR ${plan.bandwidthOverageRate.toFixed(2)} / GB`, 400, rowY)
      .text(`INR ${bandwidthOverageCost.toFixed(2)}`, 480, rowY, { align: 'right' });

    doc.moveTo(50, rowY + 20).lineTo(550, rowY + 20).strokeColor('#999999').stroke();

    // Total cost row
    rowY += 35;
    doc
      .fontSize(12)
      .font('Helvetica-Bold')
      .text('Total Invoiced Amount:', 55, rowY)
      .text(`INR ${data.billingInfo.totalFee.toFixed(2)}`, 480, rowY, { align: 'right' });

    doc.end();

    writeStream.on('finish', () => resolve());
    writeStream.on('error', (err) => reject(err));
  });
}
