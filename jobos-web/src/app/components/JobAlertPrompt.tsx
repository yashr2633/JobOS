'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

/** One explicit action enables future automated emails; browsing is not consent. */
export default function JobAlertPrompt({query='',location=''}:{query?:string;location?:string}) {
 const [role,setRole]=useState(query),[city,setCity]=useState(location||'India');
 const [enabled,setEnabled]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 useEffect(()=>{
  const controller=new AbortController();
  fetch('/api/job-alerts',{signal:controller.signal}).then(async response=>{
   if(!response.ok) return;
   const body=await response.json();
   if(controller.signal.aborted) return;
   setEnabled(body.preferences?.email_enabled===true);
   setRole(previous=>previous||body.suggested?.query||'');
   if(!location) setCity(body.suggested?.location||'India');
  }).catch(()=>{});
  return ()=>controller.abort();
 },[location]);
 async function enable(event:React.FormEvent) {
  event.preventDefault();setBusy(true);setMessage('');
  try {
   const response=await fetch('/api/job-alerts',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({emailEnabled:true,whatsappRequested:false,query:role,location:city,frequency:'daily'})});
   const body=await response.json().catch(()=>({error:'Could not enable alerts. Please retry.'}));
   if(!response.ok) throw Error(body.error||'Could not enable alerts.');
   setEnabled(true);setMessage(body.emailReady?'Daily job emails enabled. You will hear from us when new matching jobs are available.':'Your request is saved. Email delivery is awaiting sender setup.');
  } catch(error) {setMessage(error instanceof Error?error.message:'Could not enable alerts.');}
  finally {setBusy(false);}
 }
 return <section aria-label="Email job updates" className="my-4 rounded-xl border border-border-strong bg-surface p-4 sm:p-5">
  <h2 className="text-base font-semibold text-text">Don’t miss an opportunity</h2>
  {enabled?<p className="mt-2 text-sm text-text-secondary">Your email alert preference is enabled. <Link className="font-medium text-accent underline" href="/settings/alerts">Manage or stop alerts</Link></p>:<>
   <p className="mt-1 text-sm text-text-secondary">Get new jobs matching your role and location at your verified account email. Unsubscribe anytime.</p>
   <form onSubmit={enable} className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
    <label className="min-w-0 text-sm text-text">Role or company<input value={role} onChange={event=>setRole(event.target.value)} maxLength={100} required placeholder="Sales Executive" className="mt-1 min-h-11 w-full rounded-lg border border-border-strong bg-bg px-3 text-text"/></label>
    <label className="min-w-0 text-sm text-text">City or India<input value={city} onChange={event=>setCity(event.target.value)} maxLength={100} required className="mt-1 min-h-11 w-full rounded-lg border border-border-strong bg-bg px-3 text-text"/></label>
    <button disabled={busy} className="min-h-11 self-end rounded-lg bg-accent px-4 py-3 text-sm font-semibold text-accent-fg disabled:opacity-50">{busy?'Saving…':'Enable daily emails'}</button>
   </form>
  </>}
  {message&&<p role="status" className="mt-3 text-sm text-text-secondary">{message}</p>}
 </section>;
}
