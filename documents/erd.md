# JobOS Database Design (ERD)

Version: 1.0
Status: Locked (MVP)

---

# Overview

Database: PostgreSQL
Backend: Supabase

Design Goals

- AI First
- Simple MVP
- Scalable
- Normalized Database
- Future Ready

---

# 1. users

Purpose

Stores user accounts.

Columns

- id (UUID, PK)
- full_name
- email
- avatar_url
- auth_provider
- created_at
- updated_at

Relationship

1 User
→ Many Resumes
→ Many Applications
→ Many Notifications

---

# 2. resumes

Purpose

Stores uploaded resumes.

Columns

- id (UUID, PK)
- user_id (FK)
- file_name
- file_url
- extracted_text
- ats_score
- created_at
- updated_at

Relationship

One User
→ Many Resumes

---

# 3. jobs

Purpose

Stores every imported Job Description.

Columns

- id (UUID, PK)
- source
- job_url
- company_name
- job_title
- location
- salary
- employment_type
- description
- created_at
- updated_at

Relationship

One Job
→ Many Applications (future-proof)

---

# 4. applications

Purpose

Core table of JobOS.

Every tracked application exists here.

Columns

- id (UUID, PK)

Foreign Keys

- user_id
- resume_id
- job_id

Application Status

- Saved
- Applied
- Interview
- Offer
- Rejected
- Ghosted

Tracking

- tracking_source
- applied_date
- last_status_update
- last_checked_at
- follow_up_date
- ghost_after_days
- is_ghosted

Other

- notes
- created_at
- updated_at

---

# 5. match_results

Purpose

Stores Resume ↔ JD analysis.

Columns

- id
- application_id
- match_score
- missing_skills
- strengths
- weaknesses
- ai_summary
- confidence_score
- created_at

---

# 6. rejection_analysis

Purpose

Stores AI-generated probable rejection reasons.

Columns

- id
- application_id
- probable_reasons
- confidence_score
- improvement_suggestions
- created_at

NOTE

These are AI estimates.

Never present them as official company feedback.

---

# 7. followups

Purpose

Reminder management.

Columns

- id
- application_id
- reminder_date
- reminder_sent
- status
- created_at

---

# 8. application_events

Purpose

Stores complete application history.

Examples

- Application Added
- Applied
- Reminder Sent
- Status Changed
- Interview Scheduled
- Rejected
- Offer Received

Columns

- id
- application_id
- event_type
- event_description
- created_at

This table powers:

- Career Timeline
- Analytics
- Activity History
- Future AI Insights

---

# 9. notifications

Purpose

Stores user notifications.

Columns

- id
- user_id
- title
- message
- type
- is_read
- created_at

---

# Relationships

users
│
├──── resumes
│
├──── applications
│        │
│        ├──── jobs
│        ├──── match_results
│        ├──── rejection_analysis
│        ├──── followups
│        └──── application_events
│
└──── notifications

---

# MVP Tables

✅ users

✅ resumes

✅ jobs

✅ applications

✅ match_results

✅ rejection_analysis

✅ followups

✅ application_events

✅ notifications

---

# Future Tables

Phase 2

- interview_sessions
- cover_letters
- ai_chat_history
- analytics_events

Phase 3

- career_health
- recruiter_connections
- referrals
- browser_extension_logs
- company_research
- salary_insights

---

# Database Standards

- UUID Primary Keys
- Foreign Keys for all relationships
- created_at & updated_at on every table
- Soft delete where appropriate
- PostgreSQL + Supabase
- AI outputs stored separately from raw data
- Authentication handled only by Supabase Auth

---

# Engineering Principles

1. One source of truth for every application.
2. Every application is continuously trackable.
3. AI analysis is stored separately from user data.
4. Future features must extend the schema, not break it.
5. Database should support 1M+ applications without redesign.

---

END OF ERD v1.0
