import { describe, it, expect } from "vitest";
import {
  compareAudio,
  audioQuality,
  videoQuality,
  summarize,
} from "../src/quality";
import {
  jobKey,
  planKey,
  type Candidate,
  type MediaRecord,
} from "../src/types";
import { filename } from "../src/security";
const record: MediaRecord = {
  tweetId: "123",
  sourceTweetId: "123",
  mediaId: "456",
  author: "test",
  index: 1,
  poster: "",
  animated: false,
  variants: [],
  source: "graphql",
  observedAt: 0,
};
const candidate = (
  id: string,
  bitrate: number,
  sampleRate = 48000,
  channels = 2,
): Candidate => ({
  id,
  kind: "hls",
  mode: "audio",
  url: "",
  inputKey: id,
  width: 0,
  height: 0,
  audio: true,
  label: "AAC",
  codec: "aac",
  bitrate,
  sampleRate,
  channels,
  bitrateEstimated: true,
});
describe("audio quality and download identity", () => {
  it("ranks audio independently of its video resolution and default order", () => {
    const low = candidate("default", 64000),
      high = candidate("high", 192000);
    expect([low, high].sort(compareAudio)[0]).toBe(high);
  });
  it("uses sample rate and channels for equal bitrates", () => {
    expect(
      [
        candidate("a", 128000, 44100),
        candidate("b", 128000, 48000, 1),
        candidate("c", 128000),
      ]
        .sort(compareAudio)
        .map((c) => c.id),
    ).toEqual(["c", "b", "a"]);
  });
  it("keeps audio and video jobs separate but shares media probing", () => {
    expect(jobKey(record, "audio")).not.toBe(jobKey(record, "video"));
    expect(planKey({ ...record, observedAt: 2 })).toBe(planKey(record));
  });
  it("uses M4A filenames and never calls extracted audio MP4", () => {
    expect(filename(record, "AAC_192kbps", "audio")).toBe(
      "x_test_123_1_AAC_192kbps.m4a",
    );
    expect(filename(record, "640x360")).toMatch(/\.mp4$/);
  });
  it("formats standard units and marks sampled bitrate estimates", () => {
    expect(audioQuality(candidate("a", 192000))).toBe(
      "AAC · ≈192 kb/s · 48 kHz · 2 ch",
    );
    expect(videoQuality({ width: 1920, height: 1080, fps: 29.97002997 })).toBe(
      "1920 × 1080 · 29.97 fps",
    );
    expect(audioQuality(undefined)).toBe("No audio track");
  });
  it("exposes summaries without source URLs", () => {
    const result = summarize({
      candidates: [],
      audioCandidates: [candidate("a", 128000)],
      warnings: [],
    });
    expect(result.audio?.bitrate).toBe(128000);
    expect(JSON.stringify(result)).not.toContain("url");
  });
});
