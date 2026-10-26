import Link from "next/link";

/** Original vector mark: a case outline with the application's tracking path. */
export default function Brand({ employer = false }: { employer?: boolean }) {
  return <Link href={employer ? "/employer" : "/"} className="product-brand" aria-label="JobTrackOS home">
    <span className="product-mark"><svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M11 9V7.5A2.5 2.5 0 0 1 13.5 5h5A2.5 2.5 0 0 1 21 7.5V9M6 10h20v15H6z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"/><path d="M6 15.5c6.5 4.5 13.5 4.5 20 0M12 22h4l4-4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg></span>
    <span>JobTrackOS</span>{employer && <small>Employer</small>}
  </Link>;
}
