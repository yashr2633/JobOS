import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL } from '../supabase/env';
export function alertAdmin() {
 const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!key) throw Error('Alert database access is not configured.');
 return createClient(SUPABASE_URL,key,{auth:{persistSession:false,autoRefreshToken:false}});
}
export function alertsReady() { return process.env.JOB_ALERTS_ENABLED==='true' && !!process.env.BREVO_API_KEY && !!process.env.JOB_ALERT_FROM_EMAIL && !!process.env.CRON_SECRET; }
