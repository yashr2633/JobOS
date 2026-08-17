"use client";

import type { MatchConfidence } from "@/lib/ai/types";

interface MatchScoreRingProps {
  /** Integer 0-100 */
  score: number;
  confidence: MatchConfidence | null;
  size?: "sm" | "md" | "lg";
}

const sizeClasses = {
  sm: "h-12 w-12 text-xs",
  md: "h-20 w-20 text-sm",
  lg: "h-28 w-28 text-base",
};

const confidenceColors = {
  low: "text-warning",
  medium: "text-accent",
  high: "text-success",
};

export default function MatchScoreRing({
  score,
  confidence,
  size = "md",
}: MatchScoreRingProps) {
  const radius = size === "sm" ? 20 : size === "md" ? 30 : 40;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;

  return (
    <div
      className={`flex items-center justify-center ${sizeClasses[size]} ${confidence ? confidenceColors[confidence] : "text-text-secondary"}`}
    >
      <svg className="transform -rotate-90" viewBox="0 0 80 80">
        {/* Background circle */}
        <circle
          cx="40"
          cy="40"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeOpacity={0.15}
          strokeWidth={8}
        />
        {/* Progress arc */}
        <circle
          cx="40"
          cy="40"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={8}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className="transition-all duration-700 ease-out"
        />
        {/* Score text */}
        <text
          x="40"
          y="42"
          textAnchor="middle"
          className="font-semibold fill-border"
        >
          {score}
        </text>
        <text
          x="40"
          y="56"
          textAnchor="middle"
          fontSize="8"
          className="fill-border"
        >
          /100
        </text>
      </svg>
    </div>
  );
}
