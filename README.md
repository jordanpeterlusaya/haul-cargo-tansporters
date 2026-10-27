# Haul Cargo Transporter Portal

Web portal for transport companies to register, choose Tanzania operating regions, log in, and manage Haul cargo offers and shipments.

## Features

- Public homepage with Login and Register Transport Company
- Multi-step company registration (profile, regions, credentials + terms)
- Secure Firebase Auth login and password reset
- Collapsible sidebar dashboard: Available / My / In Transit / Completed orders
- Drivers & Vehicles, Notifications, Company Profile, Settings
- Region-based eligibility aligned with Haul `carrier-matching` coverage rules
- Live Firestore data from `carriers`, `carrierShipments`, and company notifications

## Stack

- Static HTML / CSS / vanilla JS (ES modules)
- Firebase Auth + Firestore (same project as Haul Agents)

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

Host the folder as a static site (Firebase Hosting, Netlify, GitHub Pages, or any CDN). Point DNS as needed; no build step required.
