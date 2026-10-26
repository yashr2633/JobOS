import Link from "next/link";
export default function SetupNotice() {
  return <section className="product-panel"><p className="product-kicker">Employer workspace</p><h1 className="text-2xl font-semibold">Workspace setup required</h1><p className="mt-4 max-w-xl text-sm leading-7 text-text-secondary">The employer workspace cannot load its data. If this is a new installation, the employer database migration must be applied before companies, jobs and applications can be managed.</p><Link className="product-button mt-6" href="/">Return to your dashboard</Link></section>;
}
