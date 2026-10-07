import test from "node:test";
import assert from "node:assert/strict";
import { consolidateLocalApplications, extractExplicitRole, mergeApplications, localToApplication } from "./localApplications.ts";
import type { LocalGmailApplication } from "./browserStore.ts";
import { computeWindowReport } from "../../app/dashboard/report.ts";
const base: LocalGmailApplication = {id:"m1",userId:"u1",gmailMessageId:"m1",gmailThreadId:"t1",company:"Acme",role:"Engineer",jobUrl:null,
  appliedDate:"2026-10-01T12:00:00Z",status:"Applied",category:"APPLICATION_CONFIRMATION",confidence:0.9,evidenceReason:"lifecycle_subject_match",isLifecycle:true,jobPortal:null,source:"Email",createdAt:"2026-10-01",updatedAt:"2026-10-01"};
test("thread lifecycle keeps earliest application date, latest source, and forward status",()=>{
  const interview={...base,id:"m2",gmailMessageId:"m2",status:"Interview" as const,appliedDate:"2026-10-02T12:00:00Z"};
  const lateConfirmation={...base,id:"m3",gmailMessageId:"m3",appliedDate:"2026-10-03T12:00:00Z"};
  const result=consolidateLocalApplications([lateConfirmation,interview,base]);
  assert.equal(result.length,1);assert.equal(result[0].status,"Interview");
  assert.equal(result[0].gmailMessageId,"m2");assert.equal(result[0].appliedDate,base.appliedDate);
});
test("different roles, threads, employers and users are never forced together",()=>{
  const records=[base,{...base,id:"m2",role:"Designer"},{...base,id:"m3",gmailThreadId:"t2"},{...base,id:"m4",company:"Other"},{...base,id:"m5",userId:"u2"}];
  assert.equal(consolidateLocalApplications(records).length,5);
});
test("unknown identities with matching dates survive and actual Gmail IDs deduplicate",()=>{
  const local={...base,company:null,role:null};
  assert.equal(consolidateLocalApplications([local,{...local,id:"other",gmailMessageId:"other"}]).length,2);
  const server=localToApplication({...local,id:"server",gmailMessageId:"different"});
  assert.equal(mergeApplications([server],[local]).length,2);
  assert.equal(mergeApplications([localToApplication(local)],[local]).length,1);
});
test("role extraction uses explicit evidence and leaves generic or promotional text unknown",()=>{
  assert.equal(extractExplicitRole("", "Thank you for applying to the Backend Engineer role at Acme."),"Backend Engineer");
  assert.equal(extractExplicitRole("Application received","We received your application."),null);
  assert.equal(extractExplicitRole("New jobs", "Explore software roles today."),null);
});

test("dashboard cards and charts agree on the window and deduplicated local lifecycle",()=>{
  const interview={...base,id:"m2",gmailMessageId:"m2",status:"Interview" as const,appliedDate:"2026-10-02T12:00:00Z"};
  const old={...base,id:"old",gmailMessageId:"old",gmailThreadId:"old",appliedDate:"2026-01-01T12:00:00Z"};
  const report=computeWindowReport(mergeApplications([], [base,interview,old]),"7d",new Date("2026-10-03T12:00:00Z"));
  assert.equal(report.totalApplications,1);assert.equal(report.statusCounts.Interview,1);
  assert.equal(report.activity.total,1);
  assert.equal(report.portals.reduce((sum,portal)=>sum+portal.count,0),1);
});
