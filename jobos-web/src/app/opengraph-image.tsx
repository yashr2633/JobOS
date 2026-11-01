import { ImageResponse } from "next/og";

export const alt = "JobTrackOS — Find jobs and prepare your application";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** Static share image only; no changes to the app UI and no external assets. */
export default function OpenGraphImage() {
  return new ImageResponse(
    <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", padding: 80, background: "#102b55", color: "#ffffff", fontFamily: "sans-serif" }}>
      <div style={{ display: "flex", fontSize: 64, fontWeight: 700 }}>JobTrackOS</div>
      <div style={{ display: "flex", marginTop: 48, fontSize: 58, lineHeight: 1.2 }}>Find jobs. Prepare. Apply.</div>
      <div style={{ display: "flex", marginTop: 24, fontSize: 30, lineHeight: 1.4, color: "#d9e5ff" }}>Jobs in India · Resume Match · Resume &amp; Cover Letter Templates</div>
      <div style={{ display: "flex", marginTop: "auto", fontSize: 30 }}>www.jobtrackos.online</div>
    </div>,
    size,
  );
}
