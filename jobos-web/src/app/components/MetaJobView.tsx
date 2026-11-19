"use client";
import { useEffect } from "react";
import { metaJobView } from "@/lib/analytics/metaPixel";

export default function MetaJobView({ jobId }: { jobId: string }) {
  useEffect(() => { metaJobView(jobId); return () => metaJobView(null); }, [jobId]);
  return null;
}
