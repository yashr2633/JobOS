import { alertAdmin } from '@/lib/alerts/server';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex','Content-Type':'text/html; charset=utf-8'};
export async function GET(request:Request) {
 const token=new URL(request.url).searchParams.get('token')??'';
 if(!/^[a-f0-9-]{36}$/i.test(token)) return new Response('Invalid unsubscribe link.',{status:400,headers});
 return new Response(`<html><head><meta name="viewport" content="width=device-width"></head><body><h1>Stop JobTrackOS emails?</h1><p>This stops your matching job emails.</p><form method="post"><input type="hidden" name="token" value="${token}"><button>Unsubscribe from job emails</button></form></body></html>`,{headers});
}
export async function POST(request:Request) {
 const url=new URL(request.url); let token=url.searchParams.get('token');
 if(!token) {const text=await request.text(); if(text.length>2048) return new Response('Invalid request.',{status:400,headers}); token=new URLSearchParams(text).get('token');}
 if(!token||!/^[a-f0-9-]{36}$/i.test(token)) return new Response('Invalid unsubscribe link.',{status:400,headers});
 try {const {error}=await alertAdmin().from('job_alert_preferences').update({email_enabled:false,whatsapp_requested:false,email_consented_at:null,whatsapp_consented_at:null,updated_at:new Date().toISOString()}).eq('unsubscribe_token',token);if(error) throw error;
 return new Response('<h1>Job alerts stopped</h1><p>You can change your preferences in JobTrackOS settings.</p>',{headers});
 } catch{return new Response('Could not stop alerts. Please retry.',{status:503,headers});}
}
