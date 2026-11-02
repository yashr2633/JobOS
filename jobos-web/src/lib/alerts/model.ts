import { createHash } from 'node:crypto';
import type { Job } from '../jobs/types.ts';
export function parseAlertInput(value: unknown) {
 if(!value || typeof value!=='object') throw Error('Invalid alert preferences.');
 const v=value as Record<string,unknown>;
 if(typeof v.emailEnabled!=='boolean'||typeof v.whatsappRequested!=='boolean'||!['daily','weekly'].includes(String(v.frequency))) throw Error('Choose alert channels and frequency.');
 const field=(key:string)=> { const text=v[key]; if(typeof text!=='string'||text.length>100||/[\r\n<>@]|https?:/i.test(text)) throw Error('Use short role and location names without contact details.'); return text.trim(); };
 const query=field('query'),location=field('location');
 if((v.emailEnabled||v.whatsappRequested)&&(!query||!location)) throw Error('Enter a role and location for your alerts.');
 return {email_enabled:v.emailEnabled,whatsapp_requested:v.whatsappRequested,frequency:v.frequency as 'daily'|'weekly',query,location};
}
export function jobKey(job:Job) { const u=new URL(job.applicationUrl); u.hash=''; for(const key of [...u.searchParams.keys()]) if(/^(utm_|source$|ref$)/i.test(key)) u.searchParams.delete(key); return createHash('sha256').update(u.href).digest('hex'); }
export function matchingAlertJobs(jobs:Job[],query:string,location:string,since:number,seen:Set<string>,now=Date.now()) {
 const terms=query.toLowerCase().split(/\s+/).filter(Boolean), loc=location.toLowerCase().split(',')[0].trim();
 const unique=new Set<string>();
 return jobs.filter(job=>{
  const posted=Date.parse(job.postedAt??''),checked=Date.parse(job.fetchedAt),expires=job.expiresAt?Date.parse(job.expiresAt):Infinity;
  if(job.availability!=='listed'||!Number.isFinite(posted)||posted<since||posted>now||!Number.isFinite(checked)||now-checked>86400000||checked>now+60000||expires<=now) return false;
  if(!terms.every(t=>(job.title+' '+job.company).toLowerCase().includes(t))) return false;
  if(loc!=='india'&&!job.location.toLowerCase().includes(loc)) return false;
  try { const u=new URL(job.applicationUrl); if(u.protocol!=='https:') return false; const key=jobKey(job); if(seen.has(key)||unique.has(key)) return false; unique.add(key); return true; } catch{return false;}
 }).sort((a,b)=>Date.parse(b.postedAt!)-Date.parse(a.postedAt!)).slice(0,5);
}
export function escapeHtml(value:string) { return value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!)); }
