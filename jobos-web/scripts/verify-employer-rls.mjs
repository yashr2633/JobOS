import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// This database exists only in memory. No credentials or network are used.
// Install the optional test runtime in ../tmp/employer-db-check, not the app.
const modulePath = resolve("../tmp/employer-db-check/node_modules/@electric-sql/pglite/dist/index.js");
const { PGlite } = await import(pathToFileURL(modulePath).href);
const db = new PGlite();
const id = number => `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
const [employerA, employerB, candidateA, candidateB] = [1, 2, 3, 4].map(id);
const [resumeA, resumeB, companyA, companyB] = [5, 6, 7, 8].map(id);
const [jobA, jobB, draft, expired, paused, closed] = [9, 10, 11, 12, 13, 14].map(id);
let checks = 0;
const pass = label => { checks++; console.log(`PASS ${label}`); };

async function asUser(user) {
  await db.exec("RESET ROLE; SET ROLE authenticated;");
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [user]);
}
async function admin() { await db.exec("RESET ROLE;"); }
async function count(table) { return Number((await db.query(`SELECT count(*) AS total FROM public.${table}`)).rows[0].total); }
async function submit(job, resume, consent = true) {
  return (await db.query("SELECT public.submit_employer_application($1,$2,$3,$4,$5) AS id", [job, resume, "Test Candidate", "Test-only covering note", consent])).rows[0].id;
}

try {
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users(id uuid PRIMARY KEY,email text);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;
    $$;
    GRANT USAGE ON SCHEMA public,auth TO authenticated,anon;
    CREATE TABLE public.resumes(id uuid PRIMARY KEY,user_id uuid REFERENCES auth.users(id),label text,extracted_text text);
    CREATE TABLE public.applications(
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid REFERENCES auth.users(id),company text,role text,location text,
      job_portal text,applied_date date,status text CHECK(status IN ('Applied','Interview','Offer','Rejected','Ghosted')),
      job_description text,source text CHECK(source IN ('manual','gmail','job_discovery')),
      created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now()
    );
    CREATE TABLE public.application_status_history(
      id uuid DEFAULT gen_random_uuid(),user_id uuid REFERENCES auth.users(id),application_id uuid REFERENCES public.applications(id),
      from_status text,to_status text,source text CHECK(source IN ('manual','gmail')),note text
    );
    ALTER TABLE public.resumes ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.applications ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.application_status_history ENABLE ROW LEVEL SECURITY;
    CREATE POLICY resume_owner ON public.resumes TO authenticated USING(user_id=auth.uid()) WITH CHECK(user_id=auth.uid());
    CREATE POLICY tracker_owner ON public.applications TO authenticated USING(user_id=auth.uid()) WITH CHECK(user_id=auth.uid());
    CREATE POLICY history_owner ON public.application_status_history TO authenticated USING(user_id=auth.uid()) WITH CHECK(user_id=auth.uid());
    GRANT SELECT,INSERT,UPDATE,DELETE ON public.resumes,public.applications,public.application_status_history TO authenticated;
    -- Match Supabase's default broad grants so the migration's revokes are tested.
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon,authenticated;
  `);
  const migration = await readFile(resolve("supabase-schema-employer-workspace.sql"), "utf8");
  await db.exec(migration);
  pass("migration executes in PostgreSQL with existing tracker/resume tables");

  for (const [index, user] of [employerA, employerB, candidateA, candidateB].entries()) {
    await db.query("INSERT INTO auth.users(id,email) VALUES($1,$2)", [user, `test-${index}@example.invalid`]);
  }
  await db.query("INSERT INTO public.resumes(id,user_id,label,extracted_text) VALUES($1,$2,'Resume A','Candidate A: SQL and Excel'),($3,$4,'Resume B','Candidate B: Python')", [resumeA, candidateA, resumeB, candidateB]);

  await asUser(employerA);
  await db.query("INSERT INTO public.employer_companies(id,owner_id,name) VALUES($1,$2,'Company A')", [companyA, employerA]);
  await asUser(employerB);
  await db.query("INSERT INTO public.employer_companies(id,owner_id,name) VALUES($1,$2,'Company B')", [companyB, employerB]);
  pass("owners create their own company profiles");

  for (const [job, company, owner, status, deadline] of [
    [jobA, companyA, employerA, "Published", null], [jobB, companyB, employerB, "Published", null],
    [draft, companyA, employerA, "Draft", null], [expired, companyA, employerA, "Published", "2000-01-01"],
    [paused, companyA, employerA, "Paused", null], [closed, companyA, employerA, "Closed", null],
  ]) {
    await asUser(owner);
    await db.query("INSERT INTO public.employer_jobs(id,company_id,title,location,work_mode,employment_type,description,status,deadline) VALUES($1,$2,'Test analyst','Bengaluru, India','Hybrid','Full-time',$3,$4,$5)", [job, company, "A test-only job description with enough detail to pass validation.", status, deadline]);
  }
  await asUser(employerA);
  await assert.rejects(() => db.query("INSERT INTO public.employer_jobs(company_id,title,location,work_mode,employment_type,description) VALUES($1,'Forged job','India','Remote','Contract',$2)", [companyB, "A forbidden job that cannot be written into another company."]));
  const crossUpdate = await db.query("UPDATE public.employer_jobs SET title='Forged' WHERE id=$1 RETURNING id", [jobB]);
  assert.equal(crossUpdate.rows.length, 0);
  pass("an employer cannot create or edit jobs in another company");

  await asUser(candidateA);
  const visibleJobs = (await db.query("SELECT id FROM public.employer_jobs ORDER BY id")).rows.map(row => row.id);
  assert.deepEqual(visibleJobs, [jobA, jobB]);
  pass("candidates see published/open jobs, not drafts, paused, closed or expired jobs");
  await assert.rejects(() => submit(jobA, resumeA, false));
  await assert.rejects(() => submit(jobA, resumeB));
  for (const unavailable of [draft, expired, paused, closed]) await assert.rejects(() => submit(unavailable, resumeA));
  assert.equal(await count("applications"), 0);
  pass("consent, resume ownership and job availability are enforced atomically");

  const submissionA = await submit(jobA, resumeA);
  assert.equal(await count("applications"), 1);
  assert.equal(await submit(jobA, resumeA), submissionA);
  assert.equal(await count("applications"), 1);
  assert.equal(await count("employer_submissions"), 1);
  assert.equal(await count("application_status_history"), 1);
  pass("submission creates one tracker record; retries do not duplicate it");
  await assert.rejects(() => db.query("UPDATE public.employer_submissions SET stage='Offer' WHERE id=$1", [submissionA]));
  await assert.rejects(() => db.query("SELECT public.set_employer_application_stage($1,'Offer')", [submissionA]));
  pass("candidates cannot set employer application stages or bypass submission RPC");

  await asUser(candidateB);
  assert.equal((await db.query("SELECT id FROM public.employer_submissions WHERE id=$1", [submissionA])).rows.length, 0);
  assert.equal((await db.query("SELECT id FROM public.resumes WHERE id=$1", [resumeA])).rows.length, 0);
  const submissionB = await submit(jobA, resumeB);
  assert.notEqual(submissionB, submissionA);
  pass("candidate accounts cannot read each other's submissions or resumes");

  await asUser(employerB);
  assert.equal((await db.query("SELECT id FROM public.employer_submissions WHERE job_id=$1", [jobA])).rows.length, 0);
  await assert.rejects(() => db.query("SELECT public.set_employer_application_stage($1,'Interview')", [submissionA]));
  pass("another employer cannot read or change these applicants");

  await asUser(employerA);
  const submitted = await db.query("SELECT candidate_name,resume_text FROM public.employer_submissions WHERE job_id=$1", [jobA]);
  assert.equal(submitted.rows.length, 2);
  assert.ok(submitted.rows.some(row => row.resume_text === "Candidate A: SQL and Excel"));
  assert.equal(await count("resumes"), 0);
  assert.equal(await count("applications"), 0);
  pass("the owner sees consented snapshots, without access to private resume/tracker tables");
  await db.query("SELECT public.set_employer_application_stage($1,'Interview')", [submissionA]);
  await db.query("INSERT INTO public.employer_submission_notes(submission_id,note) VALUES($1,'Owner-only review note')", [submissionA]);

  await asUser(candidateA);
  assert.equal((await db.query("SELECT status FROM public.applications")).rows[0].status, "Interview");
  assert.equal(await count("application_status_history"), 2);
  assert.equal(await count("employer_submission_notes"), 0);
  pass("owner stage changes update only the linked tracker and history; notes stay private");

  await asUser(candidateB);
  assert.equal((await db.query("SELECT status FROM public.applications")).rows[0].status, "Applied");
  assert.equal(await count("employer_submission_notes"), 0);
  await asUser(employerB);
  assert.equal(await count("employer_submission_notes"), 0);
  pass("other candidates and employers cannot read private notes or receive unrelated stage updates");

  await admin();
  await db.exec("SET ROLE anon;");
  for (const table of ["employer_companies", "employer_jobs", "employer_submissions", "employer_submission_notes"]) {
    await assert.rejects(() => db.query(`SELECT * FROM public.${table}`));
  }
  await assert.rejects(() => db.query("SELECT public.set_employer_application_stage($1,'Offer')", [submissionA]));
  pass("anonymous users have no access to employer tables or mutation RPCs");
  console.log(`${checks} local PostgreSQL migration/isolation checks passed. Production was not modified.`);
} finally {
  await db.close();
}
