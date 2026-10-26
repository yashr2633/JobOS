import { redirect } from "next/navigation";
import { employerSession } from "@/lib/employer/data";
import { JobForm } from "../../../components/EmployerForms";
import SetupNotice from "../../../components/SetupNotice";
export default async function NewJob() { const { company, setupError } = await employerSession(); if (setupError) return <SetupNotice />; if (!company) redirect("/employer/company"); return <><div className="product-heading"><div><p className="product-kicker">Jobs / Create</p><h1>Create a job listing</h1><p>Give candidates clear responsibilities, requirements and application details.</p></div></div><JobForm /></>; }
