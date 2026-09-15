import type { Candidate, MediaPlan, QualitySummary } from "./types";
export function compareCandidates(a: Candidate, b: Candidate): number {
  const pixels = b.width * b.height - a.width * a.height;
  if (pixels) return pixels;
  if (a.fps && b.fps && Math.abs(a.fps - b.fps) > 1) return b.fps - a.fps;
  if (
    a.codec &&
    a.codec === b.codec &&
    a.bitrate &&
    b.bitrate &&
    a.bitrate !== b.bitrate
  )
    return b.bitrate - a.bitrate;
  if (a.kind !== b.kind) return a.kind === "mp4" ? -1 : 1;
  return a.id.localeCompare(b.id);
}
export function compareAudio(a: Candidate, b: Candidate): number {
  return (
    (b.bitrate ?? 0) - (a.bitrate ?? 0) ||
    (b.sampleRate ?? 0) - (a.sampleRate ?? 0) ||
    (b.channels ?? 0) - (a.channels ?? 0) ||
    a.id.localeCompare(b.id)
  );
}
export function summarize(plan: MediaPlan): QualitySummary {
  const v = plan.candidates[0],
    a = plan.audioCandidates[0];
  return {
    video: v && { width: v.width, height: v.height, fps: v.fps },
    audio: a && {
      codec: a.codec,
      bitrate: a.bitrate,
      sampleRate: a.sampleRate,
      channels: a.channels,
      bitrateEstimated: a.bitrateEstimated,
    },
    warnings: plan.warnings,
    checkedAt: Date.now(),
  };
}
const number = (n: number) => Number(n.toFixed(2)).toString();
export function videoQuality(v: QualitySummary["video"]): string {
  return v
    ? `${v.width} × ${v.height}${v.fps ? ` · ${number(v.fps)} fps` : ""}`
    : "暂不可用";
}
export function audioQuality(a: QualitySummary["audio"]): string {
  if (!a) return "无音轨";
  return [
    a.codec?.toUpperCase(),
    a.bitrate
      ? `${a.bitrateEstimated ? "≈" : ""}${Math.round(a.bitrate / 1000)} kb/s`
      : undefined,
    a.sampleRate ? `${number(a.sampleRate / 1000)} kHz` : undefined,
    a.channels ? `${a.channels} ch` : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
}
