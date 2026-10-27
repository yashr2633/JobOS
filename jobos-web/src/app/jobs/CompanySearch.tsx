"use client";
import { useMemo } from "react";
import { companySuggestions } from "@/lib/jobs/companies";
import JobSearchInput from "./JobSearchInput";
export default function CompanySearch({ value, onChange, listed = [] }: { value: string; onChange: (value: string) => void; listed?: string[] }) {
  const vocabulary = useMemo(() => companySuggestions(value, listed, 20).map(company => ({ value: company.name, kind: "Company" as const })), [value, listed]);
  return <JobSearchInput label="Company" companiesOnly value={value} onChange={onChange} vocabulary={vocabulary} />;
}
