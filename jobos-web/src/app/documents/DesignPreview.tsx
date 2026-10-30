"use client";
import { composeDesign } from "@/lib/resume/designScene";
import type { ResumeDocument } from "@/lib/resume/documentModel";
import type { ResumeLayout } from "@/lib/resume/templates";
export default function DesignPreview({ document, layout, thumbnail = false }: { document: ResumeDocument; layout: ResumeLayout; thumbnail?: boolean }) {
  const pages = composeDesign(document, layout);
  return <div className={thumbnail ? "design-thumbnail" : "designed-pages"}>{(thumbnail ? pages.slice(0, 1) : pages).map((page, index) => <svg key={index} viewBox={`0 0 ${page.width} ${page.height}`} role={thumbnail ? undefined : "img"} aria-label={thumbnail ? undefined : `Document preview page ${index + 1}`} aria-hidden={thumbnail || undefined} style={{ fontFamily: layout.font === "serif" ? '"Times New Roman",serif' : 'Arial,sans-serif' }}>
    {page.elements.map((item, i) => item.kind === "text" ? <text key={i} x={item.x} y={item.y + item.size} fontSize={item.size} fontWeight={item.bold ? 700 : 400} fill={`#${item.color}`}>{item.text}</text>
      : item.kind === "rect" ? <rect key={i} x={item.x} y={item.y} width={item.width} height={item.height} fill={item.fill ? `#${item.fill}` : "none"} stroke={item.stroke ? `#${item.stroke}` : undefined} strokeWidth={item.thickness} />
        : <line key={i} x1={item.x} y1={item.y} x2={item.x2} y2={item.y2} stroke={`#${item.color}`} strokeWidth={item.thickness} />)}
  </svg>)}</div>;
}
