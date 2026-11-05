import Link from "next/link";
import Image from "next/image";

/** Original vector mark: a case outline with the application's tracking path. */
export default function Brand({ employer = false }: { employer?: boolean }) {
  return <Link href={employer ? "/employer" : "/"} className="product-brand" aria-label="JobTrackOS home">
    <span className="product-mark"><Image src="/brand-mark.svg" width={34} height={34} alt="" /></span>
    <span>JobTrackOS</span>{employer && <small>Employer</small>}
  </Link>;
}
