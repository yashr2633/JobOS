import { ImageResponse } from "next/og";

export const alt = "JobTrackOS — Job Application Tracker & Resume Match";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** Static share image only; no changes to the app UI and no external assets. */
export default function OpenGraphImage() {
  return new ImageResponse(
    <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", padding: 80, background: "#0c0c0f", color: "#f1f1f3", fontFamily: "sans-serif" }}>
      <div style={{ display: "flex", fontSize: 64, fontWeight: 700, color: "#a5a0ff" }}>JobTrackOS</div>
      <div style={{ display: "flex", marginTop: 48, fontSize: 58, lineHeight: 1.2 }}>Job Application Tracker</div>
      <div style={{ display: "flex", marginTop: 12, fontSize: 58, lineHeight: 1.2 }}>&amp; Resume Match</div>
      <div style={{ display: "flex", marginTop: "auto", fontSize: 30, color: "#a3a3ad" }}>www.jobtrackos.online</div>
    </div>,
    size,
  );
}
