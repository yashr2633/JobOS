import { timingSafeEqual } from 'node:crypto';
import { alertAdmin,alertsReady } from '@/lib/alerts/server';
import { getCachedCatalog } from '@/lib/jobs/cachedCatalog';
import { matchingAlertJobs,jobKey } from '@/lib/alerts/model';
import { composeJobAlert } from '@/lib/alerts/email';
export const runtime='nodejs';
export const maxDuration=60;
export async function GET(request:Request) {
 const expected=process.env.CRON_SECRET,actual=request.headers.get('authorization')??'';
 if(!expected||Buffer.byteLength(actual)!==Buffer.byteLength(`Bearer ${expected}`)||!timingSafeEqual(Buffer.from(actual),Buffer.from(`Bearer ${expected}`))) return Response.json({error:'Unauthorized'},{status:401});
 if(!alertsReady()) return Response.json({error:'Delivery is disabled or sender setup is incomplete.'},{status:503});
 const admin=alertAdmin();
 const {data:claimed,error:lockError}=await admin.rpc('claim_job_alert_worker');
 if(lockError) return Response.json({error:'Alert migration is not ready.'},{status:503});
 if(!claimed) return Response.json({busy:true});
 let accepted=0,checked=0;
 try {
 const {data:subscriptions,error}=await admin.from('job_alert_preferences').select('*').eq('email_enabled',true).not('email_consented_at','is',null).order('last_checked_at').limit(10); if(error) throw error;
 const {jobs}=await getCachedCatalog(),deadline=Date.now()+35000;
 for(const sub of subscriptions??[]) {
 if(Date.now()>deadline) break;
 const now=Date.now(),interval=(sub.frequency==='daily'?1:7)*86400000;
 const {error:touch}=await admin.from('job_alert_preferences').update({last_checked_at:new Date(now).toISOString()}).eq('user_id',sub.user_id); if(touch) throw touch;
 checked++;
 if(sub.last_sent_at&&now-Date.parse(sub.last_sent_at)<interval) continue;
 const {data:auth,error:authError}=await admin.auth.admin.getUserById(sub.user_id); if(authError||!auth.user?.email||!auth.user.email_confirmed_at) continue;
 const {data:deliveries,error:historyError}=await admin.from('job_alert_deliveries').select('job_keys,status').eq('user_id',sub.user_id); if(historyError) throw historyError;
 // Unknown outcomes are held for operator review rather than blindly retried.
 if(deliveries?.some(d=>d.status==='sending'||d.status==='unknown')) continue;
 const seen=new Set<string>((deliveries??[]).filter(d=>d.status==='accepted').flatMap(d=>d.job_keys as string[]));
 // First digest may include recent existing vacancies; later digests omit sent keys.
 const matches=matchingAlertJobs(jobs,sub.query,sub.location,now-7*86400000,seen,now); if(!matches.length) continue;
 const day=new Date(now).toISOString().slice(0,10);
 const {count,error:countError}=await admin.from('job_alert_deliveries').select('id',{head:true,count:'exact'}).gte('created_at',`${day}T00:00:00Z`); if(countError) throw countError;
 if((count??0)>=250) break;
 // Recheck withdrawal immediately before reserving a provider request.
 const {data:live,error:liveError}=await admin.from('job_alert_preferences').select('email_enabled,email_consented_at,updated_at').eq('user_id',sub.user_id).single();
 if(liveError||!live?.email_enabled||!live.email_consented_at||live.updated_at!==sub.updated_at) continue;
 const {data:delivery,error:reserveError}=await admin.from('job_alert_deliveries').insert({user_id:sub.user_id,job_keys:matches.map(jobKey),status:'sending'}).select('id').single(); if(reserveError) throw reserveError;
 const base='https://www.jobtrackos.online',unsubscribe=`${base}/api/job-alerts/unsubscribe?token=${sub.unsubscribe_token}`;
 const name=typeof auth.user.user_metadata?.full_name==='string'?auth.user.user_metadata.full_name.split(/\s+/)[0]:'';
 const email=composeJobAlert(matches,sub.query,sub.location,unsubscribe,name);
 let status='unknown',providerId:string|null=null;
 try { const response=await fetch('https://api.brevo.com/v3/smtp/email',{method:'POST',headers:{'api-key':process.env.BREVO_API_KEY!,'Content-Type':'application/json'},body:JSON.stringify({sender:{name:process.env.JOB_ALERT_FROM_NAME||'JobTrackOS',email:process.env.JOB_ALERT_FROM_EMAIL},to:[{email:auth.user.email}],...email,headers:{IdempotencyKey:delivery.id}}),signal:AbortSignal.timeout(10000)});
 if(response.ok) {status='accepted'; const body=await response.json().catch(()=>({})); providerId=typeof body.messageId==='string'?body.messageId:null;} else if(response.status>=400&&response.status<500) status='failed';
 } catch { /* Timeout or 5xx can follow provider acceptance: hold for review. */ }
 const {error:writeError}=await admin.from('job_alert_deliveries').update({status,provider_id:providerId}).eq('id',delivery.id); if(writeError) throw writeError;
 if(status==='accepted') {accepted++;const {error:sentError}=await admin.from('job_alert_preferences').update({last_sent_at:new Date(now).toISOString()}).eq('user_id',sub.user_id);if(sentError) throw sentError;}
 }
 return Response.json({checked,providerAccepted:accepted},{headers:{'Cache-Control':'no-store'}});
 } catch {return Response.json({error:'Alert processing failed. Check delivery records before retrying.'},{status:503});}
 // Lease expires automatically after five minutes; no overlapping workers.
}
