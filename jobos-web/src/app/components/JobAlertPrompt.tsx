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
 return <section aria-label="Email job updates" className="job-alert-prompt my-4">
  <div className="job-alert-heading"><span className="job-alert-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path strokeLinecap="round" strokeLinejoin="round" d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></svg></span><div><p className="product-kicker">Your next opportunity, in your inbox</p><h2>Don’t miss an opportunity</h2></div><span className="job-alert-status">{enabled?'Alerts on':'Job alerts'}</span></div>
  {enabled?<p className="mt-2 text-sm text-text-secondary">Your email alert preference is enabled. <Link className="font-medium text-accent underline" href="/settings/alerts">Manage or stop alerts</Link></p>:<>
   <p className="job-alert-description">Get new jobs matching your role and city sent to your verified account email. Set it up below so you can spend less time checking for updates.</p>
   <form onSubmit={enable} className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
    <label className="min-w-0 text-sm text-text">Role or company<input value={role} onChange={event=>setRole(event.target.value)} maxLength={100} required placeholder="Sales Executive" className="mt-1 min-h-11 w-full rounded-lg border border-border-strong bg-bg px-3 text-text"/></label>
    <label className="min-w-0 text-sm text-text">City or India<input value={city} onChange={event=>setCity(event.target.value)} maxLength={100} required className="mt-1 min-h-11 w-full rounded-lg border border-border-strong bg-bg px-3 text-text"/></label>
    <button disabled={busy} className="product-button product-button-primary self-end">{busy?'Saving…':'Enable daily job emails →'}</button>
   </form>
   <p className="job-alert-small">Daily updates when matching jobs are available. Change your preferences or unsubscribe anytime.</p>
  </>}
  {message&&<p role="status" className="mt-3 text-sm text-text-secondary">{message}</p>}
 </section>;
}
