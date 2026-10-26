import { employerSession } from "@/lib/employer/data";
import { CompanyForm } from "../../components/EmployerForms";
import SetupNotice from "../../components/SetupNotice";
export default async function CompanyPage() { const { company, setupError } = await employerSession(); return setupError ? <SetupNotice /> : <><div className="product-heading"><div><p className="product-kicker">Company</p><h1>Your company profile</h1><p>Keep the information candidates see accurate and up to date.</p></div></div><CompanyForm company={company} /></>; }
