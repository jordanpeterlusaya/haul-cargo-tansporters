# Haul Cargo Transporter Portal

Web portal for transport companies to register, choose Tanzania operating regions, log in, and manage Haul cargo offers and shipments.

## Production

- **URL:** https://haul-cargo-tansporters.vercel.app
- **Host:** Vercel (Git integration)
- **GitHub:** https://github.com/jordanpeterlusaya/haul-cargo-tansporters
- **Branch:** `main` (auto-deploys on push)

Do **not** treat Firebase Hosting / `*.web.app` as the transporters portal. Auth and Firestore still use the shared Firebase project; the static site itself is served by Vercel.

## Features

- Public homepage with Login and Register Transport Company
- Multi-step company registration (profile, regions, credentials + terms)
- Secure Firebase Auth login and password reset
- Agents Sales Overview dashboard (`Muhtasari wa biashara`) with Mapato / Commission KPIs and orders-over-time chart
- Mute-style Orders desk with cargo value vs shipping fee (`Thamani ya mzigo` / `Bei ya usafirishaji`)
- Admin/company shipping-fee quote editor; map links open pickup
- Drivers & Vehicles, Notifications, Company Profile, Settings
- Region-based eligibility aligned with Haul `carrier-matching` coverage rules
- Live Firestore data from `carriers`, `carrierShipments`, and company notifications

## Stack

- Static HTML / CSS / vanilla JS (ES modules)
- Firebase Auth + Firestore (same project as Haul Agents)
- Deployed as a static site on Vercel (no build step)

## Local preview

Serve this folder over HTTP (modules require a server):

```bash
cd haul-cargo-transporters
python3 -m http.server 4173
```

Open `http://localhost:4173`.

## Backend notes

- New companies are stored in `carriers` with `status: pending` until Haul verifies them.
- Coverage fields: `coverageAllTanzania`, `coverageRegions`.
- Offer SMS respects `notifySms`; portal inbox respects `notifyPortal` (default on).
- Orders remain in shared `carrierShipments` — the Agents app is unchanged.

## Deploy

Push to `main` on the GitHub repo above. Vercel rebuilds automatically.

```bash
git push origin main
```
