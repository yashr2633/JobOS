# JobOS — Product Requirements Document (PRD v1.0)

## 1. Executive Summary

JobOS is an AI-powered career operating system that gives job seekers a single dashboard to track every application, understand their standing with each employer, and know what to do next — instead of manually checking LinkedIn, Naukri, Wellfound, company portals, and email separately.

## 2. Problem Statement

Job searching today is fragmented:
- Applications live across many different platforms with no unified view.
- Most companies never send status updates, so users are left guessing.
- Users forget to follow up.
- Nobody tells candidates why they were rejected.
- Resume tailoring per job is manual and inconsistent.
- Interview prep happens in a completely separate tool or not at all.

## 3. Target Users

- Fresh graduates and early-career professionals applying to many roles at once (India-first, but not India-only).
- Anyone managing more than ~10 active applications who is losing track of status.

## 4. Solution Overview

JobOS becomes the single home for a user's job search. The core loop:
1. User adds a job (via Gmail import, pasted job URL, or manual entry).
2. JobOS tracks its status automatically where possible, and lets the user update it otherwise.
3. AI analyzes the Resume ↔ JD match, flags missing skills, and estimates rejection risk.
4. JobOS reminds the user to follow up if an application goes quiet.

## 5. MVP Features (Phase 1)

### 5.1 Unified Job Dashboard
Single view of all applications with counts by status (Applied / Interview / Rejected / Ghosted / Offer).

### 5.2 Job Import
- **Gmail Import:** scan inbox for application confirmations / status emails, auto-create entries.
- **Manual Job URL Import:** paste a job posting URL; AI extracts role, company, required skills, experience level.
- **Manual Job Add:** simple form for jobs with no URL (referrals, walk-ins, etc.)

### 5.3 Application Status Tracking
Statuses: Applied, Pending, Interview, Rejected, Ghosted, Offer. User can update manually; Gmail import updates automatically where signal exists.

### 5.4 Resume Upload + Resume↔JD Match
- User uploads resume (PDF/DOCX).
- For each tracked job, AI computes a match score against the JD.
- Output: match %, missing skills, experience gap, formatting/ATS score.

### 5.5 AI Rejection Analysis
Framed honestly as **probable reasons**, not confirmed fact (since companies/ATS systems don't disclose real reasons):
- ATS keyword gaps
- Experience gap vs. JD requirement
- Missing specific skills/projects
- Resume formatting/clarity issues
Output includes a confidence score.

### 5.6 Follow-up Reminders
If an application has no update after a configurable number of days (e.g. 14/21/30), JobOS flags it as "likely ghosted" and suggests a follow-up email (with a one-click AI-generated draft).

## 6. Explicitly Out of Scope for MVP (see backlog.md)

Interview Copilot, Cover Letter Generator, AI Resume Rewrite, Analytics, Browser Extension, Career Health Score, AI Career Coach, Company Research, Salary Insights, Referral Network, Recruiter tools, Mobile App.

## 7. Non-Goals

- JobOS does not guarantee interviews or offers.
- JobOS does not claim to know the *actual* reason for a rejection — only probable, AI-inferred reasons.
- JobOS is not a job board / does not source new listings on its own in MVP (user brings the jobs).

## 8. Success Metrics (early stage)

- Number of applications tracked per active user per week.
- % of users who return to the dashboard 3+ times in the first week (stickiness).
- % of tracked applications with a resolved status (not stuck in "Pending" forever) — proxy for whether the follow-up/ghost-detection loop is working.

## 9. Revenue Model (not urgent for MVP, noted for later)

- Freemium subscription (primary): Free tier covers dashboard, import, status tracking, limited resume-JD matches per month. Paid tier unlocks unlimited matching, rejection analysis, and (later) interview prep.
- Future: resume review credits, mock interview credits, affiliate revenue, B2B for colleges/placement cells.

## 10. Technical Notes (to expand as stack is decided)

- Gmail integration requires OAuth + Gmail API read-scope.
- Resume parsing: PDF/DOCX text extraction + LLM-based structuring.
- JD extraction: URL scrape + LLM-based structuring.
- Data model (minimum): `users`, `applications` (job title, company, JD text, status, source, dates), `resumes`, `match_results`.

---

*This PRD is the source of truth for what Cursor Agent / Claude / GPT build in Phase 1. Any feature not listed in Section 5 does not get built without first updating backlog.md.*
