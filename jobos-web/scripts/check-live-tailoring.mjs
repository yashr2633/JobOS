// Explicit opt-in provider check with synthetic facts only; never reads user data.
import { generateStructured } from '../src/lib/ai/gateway.ts';
import { TAILOR_RESUME_SYSTEM, buildTailorResumePrompt, validateTailoredResumeAgainstSource } from '../src/lib/ai/tailorResume.ts';
if (process.env.RUN_LIVE_TAILOR_CHECK !== '1') throw new Error('Set RUN_LIVE_TAILOR_CHECK=1 to run the synthetic provider check.');
process.loadEnvFile('.env.local');
const source = `Verification Candidate
SUMMARY
Data analyst with experience preparing SQL reports.
SKILLS
SQL
Microsoft Excel
Power BI
EXPERIENCE
Reporting Intern
Example Research Team
Prepared SQL reports and Power BI dashboards.
EDUCATION
Bachelor of Science
PROJECTS
Built a Power BI dashboard using SQL reports.`;
const jd = 'A data analyst role in India requiring SQL, Microsoft Excel and Power BI for reporting, data quality checks and dashboard preparation. Clear communication and careful documentation are required.';
const result = await generateStructured({
  systemPrompt: TAILOR_RESUME_SYSTEM, userContent: buildTailorResumePrompt(source,jd),
  task: 'deep', maxTokens: 6000, deadlineAt: Date.now()+45000, label: 'synthetic_tailor_verification',
  validate(value) {
    const checked=validateTailoredResumeAgainstSource(value,source);
    if(!checked.ok) console.log(JSON.stringify({validation:checked.error}));
    return checked;
  },
});
console.log(JSON.stringify({result:'PASS',durationMs:result.durationMs,provider:result.providerId,sourceFactsValidated:true}));
