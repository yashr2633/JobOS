"use client";
import { useState } from "react";
import CareerProfileForm from "../jobs/CareerProfileForm";
import type { CareerProfile, ResumeEvidence } from "@/lib/jobs/types";
export default function CareerPreferences({ initial, resumes }: { initial: CareerProfile; resumes: ResumeEvidence[] }) {
  const [profile, setProfile] = useState(initial);
  const [library, setLibrary] = useState(resumes);
  const [editing, setEditing] = useState(false);
  return <section className="product-panel"><div className="flex items-start justify-between gap-4"><div><h2>Career preferences</h2><p className="mt-2 text-sm text-text-secondary">Preferred roles, skills, locations, work mode and matching resume.</p></div><button className="product-button" onClick={() => setEditing(value => !value)}>{editing ? "Close" : "Edit preferences"}</button></div>{editing ? <div className="mt-6"><CareerProfileForm profile={profile} resumes={library} onResumesChange={setLibrary} onCancel={() => setEditing(false)} onSave={value => { setProfile(value); setEditing(false); }} /></div> : <dl className="mt-6 grid gap-5 text-sm sm:grid-cols-2">{[["Target roles", profile.roles.join(", ")], ["Skills", profile.skills.join(", ")], ["Locations", profile.locations.join(", ")], ["Work mode", profile.workModes.join(", ")]].map(([label, value]) => <div key={label}><dt className="text-xs text-text-muted">{label}</dt><dd className="mt-2">{value || "Not set"}</dd></div>)}</dl>}</section>;
}
