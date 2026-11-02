import test from 'node:test';
import assert from 'node:assert/strict';
import {parseAlertInput,matchingAlertJobs,jobKey,escapeHtml} from './model.ts';
import {composeJobAlert,alertJobUrl} from './email.ts';
import type {Job} from '../jobs/types.ts';
const now=Date.parse('2026-11-03T12:00:00Z');
const job={id:'1',title:'Sales Executive',company:'Example',location:'Kolkata, India',availability:'listed',postedAt:'2026-11-03T09:00:00Z',fetchedAt:'2026-11-03T11:00:00Z',expiresAt:null,applicationUrl:'https://example.com/jobs/1',source:'Example'} as Job;
test('preferences require explicit channel booleans, bounded public terms and valid frequency',()=>{
 assert.equal(parseAlertInput({emailEnabled:false,whatsappRequested:false,frequency:'weekly',query:'',location:'India'}).email_enabled,false);
 for(const patch of [{emailEnabled:'yes'},{query:'a@example.com'},{location:'<script>'},{frequency:'instant'},{query:''}]) assert.throws(()=>parseAlertInput({emailEnabled:true,whatsappRequested:false,frequency:'daily',query:'Sales',location:'Kolkata',...patch}));
});
test('only current, originally dated, relevant, unseen and deduplicated jobs enter digest',()=>{
 const list=[job,{...job,id:'duplicate',applicationUrl:job.applicationUrl+'?utm_source=test'},{...job,id:'closed',availability:'closed'},{...job,id:'wrong',location:'Delhi'},{...job,id:'undated',postedAt:null},{...job,id:'stale',fetchedAt:'2026-10-01'},{...job,id:'expired',expiresAt:'2026-11-02'},{...job,id:'future',postedAt:'2026-12-01'},{...job,id:'old',postedAt:'2024-01-01'},{...job,id:'unsafe',applicationUrl:'javascript:alert(1)'}] as Job[];
 assert.deepEqual(matchingAlertJobs(list,'Sales Executive','Kolkata',now-86400000,new Set(),now).map(j=>j.id),['1']);
 assert.equal(matchingAlertJobs([job],'Sales','Kolkata',now-86400000,new Set([jobKey(job)]),now).length,0);
 assert.equal(matchingAlertJobs([job],'Developer','India',now-86400000,new Set(),now).length,0);
});
test('source text is escaped before composing email HTML',()=>assert.equal(escapeHtml('<a x="&">'), '&lt;a x=&quot;&amp;&quot;&gt;'));
test('email routes job clicks through JobTrackOS with branding and unsubscribe',()=>{
 const email=composeJobAlert([job],'Sales','Kolkata','https://www.jobtrackos.online/api/job-alerts/unsubscribe?token=test','<img src=x>');
 assert.equal(email.subject,'JobTrackOS: 1 job matching Sales in Kolkata');
 assert.ok(email.htmlContent.includes('&lt;img src=x&gt;'));
 assert.ok(!email.htmlContent.includes('href="https://example.com/jobs/1"'));
 const link=new URL(alertJobUrl({...job,sourceUrl:'https://example.com/jobs/1?x=a&y=b'}));
 assert.equal(link.origin,'https://www.jobtrackos.online');
 assert.equal(link.pathname,'/jobs/alert/1');
 assert.equal(link.searchParams.get('utm_source'),'job_alert');
 assert.ok(!link.href.includes('example.com'));
 assert.ok(email.htmlContent.includes('/brand-mark-email.png'));
 assert.ok(email.htmlContent.includes('Apply now'));
 assert.ok(email.htmlContent.includes('Unsubscribe'));
 assert.ok(email.htmlContent.includes('not an interview invitation'));
});
