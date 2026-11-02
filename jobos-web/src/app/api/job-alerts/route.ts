import { createClient } from '@/lib/supabase/server';
import { alertAdmin,alertsReady } from '@/lib/alerts/server';
import { parseAlertInput } from '@/lib/alerts/model';
import { isDocumentRequestOrigin } from '@/lib/documents/requestOrigin';
const headers={'Cache-Control':'private, no-store','X-Robots-Tag':'noindex'};
export async function GET() {
 const client=await createClient(),{data:{user}}=await client.auth.getUser();
 if(!user) return Response.json({error:'Please sign in.'},{status:401,headers});
 try { const {data,error}=await alertAdmin().from('job_alert_preferences').select('email_enabled,whatsapp_requested,frequency,query,location').eq('user_id',user.id).maybeSingle(); if(error) throw error;
 const {data:profile}=await client.from('career_profiles').select('preferences').eq('user_id',user.id).maybeSingle();
 const preferences=profile?.preferences??{};
 const first=(value:unknown)=>Array.isArray(value)&&typeof value[0]==='string'?value[0].slice(0,100):'';
 return Response.json({preferences:data,email:user.email,suggested:{query:first(preferences.roles),location:first(preferences.locations)||'India'},emailReady:alertsReady(),whatsappReady:false},{headers});
 } catch {return Response.json({error:'Job alerts are not configured yet. Please try later.'},{status:503,headers});}
}
export async function PUT(request:Request) {
 if(!isDocumentRequestOrigin(request)) return Response.json({error:'Invalid request origin.'},{status:403,headers});
 const client=await createClient(),{data:{user}}=await client.auth.getUser();
 if(!user) return Response.json({error:'Please sign in.'},{status:401,headers});
 let input:ReturnType<typeof parseAlertInput>;
 try {const body=await request.text(); if(body.length>2048) throw Error('Request too large.'); input=parseAlertInput(JSON.parse(body));} catch(e){return Response.json({error:e instanceof Error?e.message:'Invalid preferences.'},{status:400,headers});}
 if(input.whatsapp_requested) return Response.json({error:'WhatsApp alerts are not available.'},{status:400,headers});
 if(input.email_enabled&&(!user.email||!user.email_confirmed_at)) return Response.json({error:'Verify your account email before enabling alerts.'},{status:400,headers});
 try {
 const admin=alertAdmin(),{data:old,error:readError}=await admin.from('job_alert_preferences').select('email_enabled,whatsapp_requested,email_consented_at,whatsapp_consented_at').eq('user_id',user.id).maybeSingle(); if(readError) throw readError;
 const now=new Date().toISOString();
 const {error}=await admin.from('job_alert_preferences').upsert({user_id:user.id,...input,consent_version:'job-alerts-v1',email_consented_at:input.email_enabled?(old?.email_enabled?old.email_consented_at:now):null,whatsapp_consented_at:input.whatsapp_requested?(old?.whatsapp_requested?old.whatsapp_consented_at:now):null,updated_at:now}); if(error) throw error;
 return Response.json({saved:true,emailReady:alertsReady(),whatsappReady:false},{headers});
 } catch {return Response.json({error:'Could not save alerts. Please retry.'},{status:503,headers});}
}
