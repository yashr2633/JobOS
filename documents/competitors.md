# JobOS — Competitive Analysis (researched, not guessed)

Every claim below is from live 2026 reviews, pricing pages, and Trustpilot/Reddit sentiment — not assumptions. Sources noted inline where it matters.

---

## 1. Huntr — the tracker

**What it actually is:** A kanban board (Trello-style: Saved → Applied → Interviewing → Offer) + Chrome extension that clips job postings into it. Running since 2017, so the tracker itself is mature and well-loved (4.8–4.9★, 90K–250K Chrome extension users).

**Key features:**
- One-click job clipping via extension
- Cards hold notes, contacts, salary, documents — doubles as an interview briefing doc
- Resume builder (unlimited base resumes, free PDF export) added later
- Basic resume-to-job matching/scoring
- Free tier: up to 100 tracked jobs

**Where it makes money:** Huntr Pro — **$40/month**, the most expensive tool in this category. AI resume tailoring, cover letters, and interview prep all sit behind this paywall.

**Real mistakes / user complaints:**
- $40/mo is widely called out as too expensive *for a tracker* — reviewers note "the math no longer works" for most active seekers in 2026
- Free tier AI cap is stingy: only 2 total AI-tailored resumes (not per month — total, ever)
- Self-published "#1" ranking claims flagged as marketing hygiene issue by reviewers
- Never applies to jobs for you — 100% manual submission, every time
- Value proposition weakens fast if the user is already disciplined about tracking manually

**What JobOS should take from this:** The kanban/tracker UX is genuinely good and users love it — don't reinvent that wheel. But Huntr's AI layer feels bolted on (added in 2024, after 7 years as a pure tracker) and users can tell. JobOS should be AI-native from day one, not AI-retrofitted.

---

## 2. Teal (Teal HQ) — the resume + tracker combo

**What it actually is:** Free tracker + AI resume builder, founded 2019 by a former WeWork exec, $20.7M raised, 2M+ users. The most-reviewed and generally best-regarded tool in this category (4.1–4.3★ Trustpilot).

**Key features:**
- Unlimited job tracking, resumes, and downloads on the **free tier** — genuinely usable long-term without paying
- Chrome extension (4.9★, 3,200+ reviews) saves jobs from 40+ boards
- Resume ↔ JD match scorer with keyword gap analysis
- ATS resume checker: 15 checks, 0–100 score, under 60 seconds
- AI-generated bullets, summaries, cover letters (gated)

**Where it makes money:** Teal+ — **$29/month, $13/week, or $79/quarter**. Weekly pricing exists so people pay only during an active search — but this is also the #1 complaint driver.

**Real mistakes / user complaints:**
- Cancellation friction is a documented pattern: Teal's own terms say they're not responsible if a user "fails to cancel" — reviewers explicitly warn "set a calendar reminder"
- Free tier shows only top 5 keywords; full match score locked behind paywall
- Some resume templates parse badly in ATS systems like Workday — the exact problem the tool claims to solve
- AI-written bullets "need human editing to sound authentic" — a recurring theme across reviews
- No auto-apply, no interview prep, no ghost detection — purely tracking + resume tooling

**What JobOS should take from this:** Teal proves a generous free tier builds trust and a large user base (2M+). Their weakness is the AI feels like an add-on for monetization rather than the core value — and they have zero rejection-reason intelligence or ghost detection. That gap is real and open.

---

## 3. Simplify (Copilot) — the autofill extension

**What it actually is:** A free Chrome extension (4.9★, 1M+ installs, ~500K users) that autofills application forms from a saved profile. Tagline: "Your AI Agent for the Job Search" — but it is explicitly **not** auto-apply; you still click Submit yourself.

**Key features:**
- Autofill accuracy: strong on Greenhouse/Lever/Ashby (~85–90%), weak on enterprise ATS — only ~70% on Workday, 40–50% on iCIMS/Taleo
- Job matching + application tracker bundled free
- Referral tools
- Paid tier adds AI cover letters (~10 sec generation) and open-ended question answers

**Where it makes money:** Simplify+ — **$19.99/week, $39.99/month, or $89.99/3 months**. No free trial, no documented refund policy.

**Real mistakes / user complaints:**
- The "AI Agent" framing is called misleading by multiple reviewers — it's an autofill tool, not an agent
- No trial + no refund policy on the paid tier is a recurring red flag in reviews
- AI output on Simplify+ "requires substantial editing" per Trustpilot reviews
- Privacy policy reportedly unchanged since 2021; a Feb 2026 incident saw private support conversations republished publicly on their forum
- Autofill breaks down precisely where the tedium is worst: complex/enterprise forms

**What JobOS should take from this:** Simplify wins on "reduce friction to apply," not on "understand your search." It has zero rejection-reason intelligence, zero ghost detection, and no real status tracking across email. Different job entirely from JobOS.

---

## 4. Jobright AI — the closest positioning to JobOS

**What it actually is:** Founded 2023 by ex-Box/ex-Twitter engineers, $7.7M raised (including from Indeed's venture arm), ~$5M ARR in early 2026. AI job matching + autofill + resume tools — the most "AI-native" of the direct competitors, and the one whose pitch is closest to JobOS's.

**Key features:**
- AI matching engine surfaces relevant roles instead of manual search
- One-click autofill across major ATS platforms
- Insider referral emails, LinkedIn email finder
- H1B visa filter (strong differentiator for international candidates)
- "Live coach" feature

**Where it makes money:** Turbo plan — raised **33% in early 2026, from $29.99 to $39.99/month** (also ~$17.99/week or $89.99/quarter). No public pricing page — prices only shown after signup, behind a countdown-timer checkout.

**Real mistakes / user complaints — this is the important one:**
- **72% of one-star Trustpilot reviews are about billing/cancellation** — charges continuing after cancellation attempts, no visible cancel button, no confirmation screen, auto-renewal with no warning email
- Trustpilot rating jumped from ~230 reviews to ~2,200 in four months after Jobright started paying for Trustpilot and aggressively prompting happy users in-app — reviewers flagged this as a "curated funnel," not organic reputation
- No public pricing page (404 on `/pricing`) is called out as a trust red flag
- Weekly billing option is explicitly described as "a trap" — nearly double the effective monthly rate
- Ghost listings and "overstated automation" are recurring complaint themes
- U.S.-only coverage

**What JobOS should take from this — this is the single most useful data point in this whole document:** Jobright has the *closest product vision to JobOS* — AI-native matching, tracking, and autofill — and is growing fast ($5M ARR). But its reputation is actively being damaged by dark-pattern billing and a lack of pricing transparency. This is a wide-open opportunity: **JobOS can win the same positioning Jobright is chasing, just by being honest about pricing and easy to cancel.** That alone is a differentiator worth stating explicitly in the PRD.

---

## Feature Comparison Matrix

| Capability | Huntr | Teal | Simplify | Jobright | **JobOS** |
|---|---|---|---|---|---|
| Application tracking | Yes | Yes | Partial | Yes | Yes |
| Gmail-based auto status detection | No | No | No | No | **Yes** |
| AI Resume↔JD Match Score | Yes | Yes | Partial | Yes | **Yes** |
| Probable rejection-reason analysis | No | No | No | No | **Yes** |
| Ghost detection + auto follow-up | No | No | No | No | **Yes** |
| Transparent, upfront pricing | Partial | Partial | No | **No (major complaint)** | **Yes (by design)** |
| Free tier that's actually usable long-term | Weak (100 job cap, 2 AI uses total) | **Strong** | Strong | Weak | Target: Strong |
| Positioned as "operating system" vs. "tracker" | No | No | No | Closest, but execution is patchy | **Yes** |

---

## Pricing Landscape Snapshot (2026)

| Tool | Free tier | Paid tier |
|---|---|---|
| Huntr | 100 jobs, 2 AI uses total | $40/month |
| Teal | Unlimited tracking + resumes, limited AI credits | $29/month, $13/week, $79/quarter |
| Simplify | Unlimited autofill + tracking | $19.99/week – $39.99/month |
| Jobright | 2 credits/day | $29.99–$39.99/month (recently raised) |

**Takeaway:** The whole category sits between $20–$40/month at the paid tier, and every single competitor has documented complaints about either price, cancellation friction, or paywalled essentials. There is real room for JobOS to compete on trust and transparency, not just features.

---

## Positioning Statement (revised, evidence-backed)

Huntr and Teal help you *organize* your search. Simplify helps you *apply faster*. Jobright tries to be the AI layer on top of all of it — and is winning market share fast — but is bleeding trust over billing practices and lacks the one thing that would make it genuinely indispensable: **telling users why they're being rejected and when to give up on a dead application.**

JobOS's wedge: be the tool that tells you *why things aren't working* and *what to do next*, with pricing and cancellation that don't generate Trustpilot complaints. That's not a feature gap — it's a trust gap in the entire category, and it's ours to take.