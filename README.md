# SahaYog — working prototype

A functional prototype of the SIH26089 idea (Team BugBusters): households book
verified gig workers through their local cooperative, workers run a job feed
from their phone, and the cooperative verifies workers and resolves disputes
from a browser dashboard.

This is a **static frontend + Supabase** build — there is no separate server.
`supabase-js` talks to your Supabase project directly from the browser, and
Row Level Security policies (in `sql/schema.sql`) do the job a backend
normally would: deciding who can read or write what. That's what makes it
possible to host the whole thing on GitHub Pages for free.

## What's included

| File | Purpose |
|---|---|
| `index.html` + `js/auth.js` | Sign up (household / worker / cooperative) and sign in |
| `household.html` + `js/household.js` | Browse verified workers, book a service, track bookings, report issues |
| `worker.html` + `js/worker.js` | Availability toggle, job feed (accept/decline/complete), earnings |
| `admin.html` + `js/admin.js` | Cooperative stats, worker verification queue, dispute resolution |
| `css/style.css` | Shared design system (carried over from the pitch-deck prototype) |
| `sql/schema.sql` | Tables, auto-profile trigger, seed cooperative, RLS policies |
| `js/supabase-client.js` | **Only file you need to edit** — your project URL + anon key, plus the fixed service-price catalog |

## 1. Create a Supabase project

1. Go to [supabase.com](https://supabase.com) → New project. Free tier is enough.
2. Once it's ready, open **SQL Editor → New query**, paste the entire contents
   of `sql/schema.sql`, and run it. This creates every table, the
   auto-profile trigger, one seed cooperative ("Sahakari Seva Mandal"), and
   all Row Level Security policies.
3. Open **Project Settings → API**. Copy the **Project URL** and the
   **anon / public** key.
4. Open `js/supabase-client.js` and paste them in:
   ```js
   const SUPABASE_URL = "https://xxxxxxxx.supabase.co";
   const SUPABASE_ANON_KEY = "eyJhbGciOi...";
   ```
5. In **Authentication → Providers**, email/password is on by default — that's
   all this prototype uses. For a same-day demo, go to **Authentication →
   Settings** and turn **"Confirm email"** off, so new accounts can sign in
   immediately without clicking an email link.

## 2. Run it locally

No build step — it's plain HTML/CSS/JS. Any static server works:

```bash
cd sahayog
python3 -m http.server 8000
# then open http://localhost:8000
```

(Opening `index.html` directly as a `file://` URL also mostly works, but a
local server avoids occasional CORS quirks — worth the one command.)

## 3. Try the three roles

1. **Sign up as a Household** — book a service (only categories with an
   already-verified worker will show one).
2. **Sign up as a Worker**, picking the seeded cooperative and a skill
   category. You'll be unverified until a cooperative approves you.
3. **Sign up as a Cooperative** (this creates a *new* cooperative — if you
   want to approve the worker from step 2, pick "Sahakari Seva Mandal" when
   signing that worker up, since that's the one seeded by the schema). From
   the admin dashboard, approve the worker in the verification queue.
4. Back in the household tab, that worker now appears — book them. Switch to
   the worker tab to accept it, then mark it complete. Switch to admin to see
   it counted in "jobs today" and revenue.
5. From a household booking, "Report an issue" raises a dispute the
   cooperative can resolve from their dashboard.

Pages poll every 8 seconds, so you can keep two browser tabs open (e.g.
household + worker) side by side and watch state changes appear without
refreshing — handy for a live demo.

## 4. Deploy to GitHub Pages

```bash
git init
git add .
git commit -m "SahaYog prototype"
git branch -M main
git remote add origin https://github.com/<you>/sahayog.git
git push -u origin main
```

Then in the repo: **Settings → Pages → Source: Deploy from a branch → main
/ (root)**. Your prototype will be live at
`https://<you>.github.io/sahayog/` within a minute or two.

The Supabase anon key is safe to commit and expose client-side — it's
designed for this, and RLS is what actually protects the data.

## What's deliberately simplified for a prototype

- Fixed prices come from a hardcoded catalog in `supabase-client.js`, not a
  cooperative-managed pricing table.
- No file upload for ID verification yet (the deck's Aadhaar-upload step) —
  the admin approves on trust for now.
- Live polling every 8s stands in for Supabase Realtime subscriptions/push
  notifications and true GPS tracking/IVR, which are next-phase build items
  per the roadmap slide.
- RLS policies are demo-scoped (documented inline in `schema.sql`) — deny-by-
  default rules per feature would be the next hardening pass before a real
  pilot.
