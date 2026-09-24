export type Source = "graphql" | "ssr" | "initial" | "syndication";
export type DownloadMode = "video" | "audio";
export interface Variant {
  kind: "mp4" | "hls";
  url: string;
  bitrate?: number;
  width?: number;
  height?: number;
}
export interface MediaRecord {
  tweetId: string;
  sourceTweetId: string;
  mediaId: string;
  author: string;
  index: number;
  poster: string;
  durationMs?: number;
  animated: boolean;
  variants: Variant[];
  source: Source;
  observedAt: number;
}
export interface Candidate extends Variant {
  mode?: DownloadMode;
  id: string;
  width: number;
  height: number;
  fps?: number;
  codec?: string;
  audio: boolean;
  label: string;
  inputKey: string;
  trackId?: number;
  audioTrackId?: number;
  sampleRate?: number;
  channels?: number;
  bitrateEstimated?: boolean;
}
export interface MediaPlan {
  candidates: Candidate[];
  audioCandidates: Candidate[];
  warnings: string[];
}
export interface QualitySummary {
  pending?: boolean;
  video?: Pick<Candidate, "width" | "height" | "fps">;
  audio?: Pick<
    Candidate,
    "codec" | "bitrate" | "sampleRate" | "channels" | "bitrateEstimated"
  >;
  warnings: string[];
  checkedAt: number;
  error?: string;
}
export type JobState =
  | "queued"
  | "analyzing"
  | "waiting"
  | "merging"
  | "saving"
  | "complete"
  | "failed"
  | "cancelled"
  | "interrupted";
export interface Job {
  mode: DownloadMode;
  id: string;
  key: string;
  record: MediaRecord;
  state: JobState;
  createdAt: number;
  updatedAt: number;
  tabId?: number;
  downloadId?: number;
  filename?: string;
  candidate?: Candidate;
  progress?: number;
  warnings: string[];
  error?: string;
}
export const ACTIVE = new Set<JobState>([
  "queued",
  "analyzing",
  "waiting",
  "merging",
  "saving",
]);
export const ALL_STATES: JobState[] = [
  "queued",
  "analyzing",
  "waiting",
  "merging",
  "saving",
  "complete",
  "failed",
  "cancelled",
  "interrupted",
];
export const CHANNEL = "x-video-downloader/v1";
export const MAX_JSON = 4 * 1024 * 1024;
export const MAX_RECORDS = 500;
export const QUALITY_TTL = 15 * 60 * 1000;
export const PLAN_TTL = 2 * 60 * 1000;
/** A watcher is only worth notifying while its inspection may still land. */
export const WATCHER_TTL = 2 * 60 * 1000;
/** A pending probe older than this was dropped, so the tab asks again. */
export const PROBE_STALE = 45 * 1000;
export const keyOf = (r: MediaRecord) => `${r.sourceTweetId}:${r.mediaId}`;
export const jobKey = (r: MediaRecord, mode: DownloadMode) =>
  `${keyOf(r)}:${mode}`;
export const planKey = (r: MediaRecord) =>
  `${keyOf(r)}:${r.variants
    .map((v) => v.url)
    .sort()
    .join("|")}`;
export const extensionOf = (mode: DownloadMode = "video") =>
  mode === "audio" ? "m4a" : "mp4";
export const errorText = (e: unknown) =>
  e instanceof Error ? e.message : String(e);
