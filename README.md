# SaaS Billing Platform

Starter project structure based on the stack shown in the screenshots:

- `Next.js` + `Recharts` for the customer dashboard
- `MongoDB` for tenant and usage data
- `Redis` for real-time counters and fast aggregation support
- `AWS Lambda` for invoice and alert workers
- `AWS S3`, `SES`, and `SNS` for invoice storage, email delivery, and alerts

## Structure

- `apps/dashboard` - frontend dashboard
- `services/usage-tracker` - real-time usage ingestion service
- `services/pricing-engine` - tiered pricing logic
- `services/invoice-worker` - Lambda-oriented invoice processing
- `services/alert-worker` - Lambda-oriented usage alert processing
- `packages/shared` - shared types and helpers
- `infrastructure/aws` - AWS deployment notes or IaC
- `infrastructure/mongodb` - MongoDB-related setup
- `infrastructure/redis` - Redis-related setup
- `docs` - architecture and product notes

## Quick start

1. Copy `.env.example` to `.env`
2. Run `docker compose up -d`
3. Add the actual app code inside the folders above
