'use client';
import {useEffect,useState} from 'react';
import Link from 'next/link';
import SettingsCard from '../components/SettingsCard';
export default function AlertSettings(){
 const [form,setForm]=useState({emailEnabled:false,whatsappRequested:false,frequency:'weekly',query:'',location:'India'}),[message,setMessage]=useState(''),[ready,setReady]=useState(false),[busy,setBusy]=useState(true),[loaded,setLoaded]=useState(false);
 useEffect(()=>{fetch('/api/job-alerts').then(async r=>{const b=await r.json();if(!r.ok) throw Error(b.error);const p=b.preferences,search=new URLSearchParams(window.location.search);setForm({emailEnabled:p?.email_enabled??false,whatsappRequested:p?.whatsapp_requested??false,frequency:p?.frequency??'weekly',query:(search.get('q')||p?.query||'').slice(0,100),location:(search.get('location')||p?.location||'India').slice(0,100)});setReady(b.emailReady);setLoaded(true);}).catch(e=>setMessage(e.message)).finally(()=>setBusy(false));},[]);
 const input='mt-1 w-full rounded-lg border border-border bg-surface px-3 py-3 text-text';
 return <SettingsCard title="Don’t miss an opportunity" description="Enable matching job emails once. We will automatically check for new jobs at your chosen frequency."><form className="max-w-xl space-y-5" onSubmit={async e=>{e.preventDefault();setBusy(true);try{const r=await fetch('/api/job-alerts',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({...form,whatsappRequested:false})});const b=await r.json();if(!r.ok)throw Error(b.error);setReady(b.emailReady);setMessage(b.emailReady?'Preferences saved. Alerts are sent only when new matching jobs are available.':'Preferences saved. Email delivery will start after the sender is configured.');}catch(e){setMessage(e instanceof Error?e.message:'Could not save.');}finally{setBusy(false);}}}>
 <label className="block text-sm">Role or company<input className={input} maxLength={100} placeholder="Sales Executive" value={form.query} onChange={e=>setForm({...form,query:e.target.value})}/></label>
 <label className="block text-sm">City or India<input className={input} maxLength={100} value={form.location} onChange={e=>setForm({...form,location:e.target.value})}/></label>
 <label className="block text-sm">Frequency<select className={input} value={form.frequency} onChange={e=>setForm({...form,frequency:e.target.value})}><option value="daily">Daily</option><option value="weekly">Weekly</option></select></label>
 <label className="flex items-start gap-3"><input type="checkbox" className="mt-1 size-5 shrink-0" checked={form.emailEnabled} onChange={e=>setForm({...form,emailEnabled:e.target.checked})}/><span>Email me matching job alerts at my verified account email. I can unsubscribe at any time.</span></label>
 {!ready&&<p className="text-sm text-text-secondary">Email delivery is awaiting sender setup.</p>}
 <p className="text-sm text-text-secondary">No resume or mailbox contents are included in alerts. A matching job is not an employer shortlist or hiring guarantee.</p>
 <button disabled={busy||!loaded} className="min-h-11 rounded-lg bg-accent px-5 py-3 font-semibold text-accent-fg disabled:opacity-50">{busy?'Please wait…':'Save alert preferences'}</button><p role="status" className="text-sm">{message}</p><Link href="/jobs" className="inline-flex min-h-11 items-center font-medium text-accent">Continue to Find Jobs →</Link>
 </form></SettingsCard>;
}
