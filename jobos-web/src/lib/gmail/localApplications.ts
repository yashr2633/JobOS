import type { Application } from "../../app/applications/types.ts";
import type { LocalGmailApplication } from "./browserStore.ts";
import { isForwardTransition } from "../applications/lifecycle.ts";

/** Group only matching user/thread/company/role evidence, in chronological order. */
export function consolidateLocalApplications(inputs: LocalGmailApplication[]): LocalGmailApplication[] {
  const groups = new Map<string, LocalGmailApplication>();
  const ordered = [...inputs].sort((a,b) => a.appliedDate.localeCompare(b.appliedDate) || a.id.localeCompare(b.id));
  for (const app of ordered) {
    const key = app.gmailThreadId && app.company && app.role ? [app.userId, app.gmailThreadId, app.company.trim().toLowerCase(), app.role.trim().toLowerCase()].join("|") : app.id;
    const previous = groups.get(key);
    if (!previous) { groups.set(key, app); continue; }
    const advance = previous.status === app.status || isForwardTransition(previous.status, app.status);
    groups.set(key, { ...(advance ? app : previous), id: previous.id, appliedDate: previous.appliedDate });
  }
  return [...groups.values()];
}

export function localToApplication(local: LocalGmailApplication): Application {
  return {id:local.id, company:local.company || "Unknown Company", role:local.role || "Unknown Role",
    location:"", jobPortal:local.source || "Email", appliedDate:local.appliedDate, status:local.status,
    gmailMessageId:local.gmailMessageId, gmailAddress:null, applicationUrl:local.jobUrl};
}

/** Gmail IDs identify duplicates; incomplete employer/role/date guesses do not. */
export function mergeApplications(server: Application[], local: LocalGmailApplication[]): Application[] {
  const known = new Set(server.map(app => app.gmailMessageId).filter(Boolean));
  return [...server, ...consolidateLocalApplications(local).filter(app => !known.has(app.gmailMessageId)).map(localToApplication)];
}

/** Extract only explicitly named role/position phrases, otherwise leave unknown. */
export function extractExplicitRole(subject: string, snippet: string, body = ""): string | null {
  const match = [subject, snippet, body].join("\n").match(/(?:applying to|application for|applied for)\s+(?:the\s+)?([^\n.!?]{2,100}?)\s+(?:role|position)\b/i);
  return match?.[1]?.trim() ?? null;
}
