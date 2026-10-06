# tiktokchallengeme

Paid voting platform for the November 2026 competition.

## Current MVP

- 10 contestants
- KSh 1 per vote
- Responsive public voting page
- M-Pesa STK Push integration scaffold
- M-Pesa callback handling
- Local transaction/vote persistence

## Setup

1. Install Node.js 20+.
2. Clone this repository.
3. Run `npm install`.
4. Copy `.env.example` to `.env`.
5. Add your Daraja sandbox credentials to `.env`.
6. Set a publicly reachable callback URL.
7. Run `npm start`.

Never commit `.env`, Consumer Secrets, Passkeys, or other credentials.

## Important

The public page and backend are only the starter MVP. Before production we still need:
- a proper production database,
- authenticated admin dashboard,
- payment reconciliation/idempotency,
- fraud/rate-limit protections,
- HTTPS deployment,
- production Daraja credentials and business shortcode,
- contestant photo management,
- competition start/end controls.

