import { t } from "./i18n";
import {
  Input,
  UrlSource,
  HLS_FORMATS,
  MP4,
  Output,
  Mp4OutputFormat,
  StreamTarget,
  Conversion,
  BlobSource,
  type InputVideoTrack,
  type InputAudioTrack,
} from "mediabunny";
import { createMediaFetch, DownloadError } from "./network";
import { compareCandidates, compareAudio, summarize } from "./quality";
import { ProbeSources } from "./probe-source";
import { mapLimit, Limiter } from "./concurrency";
import {
  errorText,
  type MediaRecord,
  type Candidate,
  type Variant,
  type DownloadMode,
  type MediaPlan,
  extensionOf,
} from "./types";

const control = new AbortController();
const inputs = new Set<Input>();
const probeFactories = new WeakMap<Input, ProbeSources>();
let conversion: Conversion | undefined;
function open(v: Variant, probe?: ProbeSources): Input {
  const input = new Input({
    source: probe
      ? probe.source(v.url)
      : new UrlSource(v.url, {
          fetchFn: createMediaFetch(control.signal),
          maxCacheSize: 8 * 1024 * 1024,
          parallelism: 2,
          getRetryDelay: () => null,
          handleUnhandledError: () => {},
        }),
    formats: v.kind === "hls" ? HLS_FORMATS : [MP4],
    formatOptions: { hls: { offsetTimestampsByDateTime: false } },
  });
  inputs.add(input);
  if (probe) probeFactories.set(input, probe);
  return input;
}
async function describeAudio(
  audio: InputAudioTrack,
  v: Variant,
  inputKey: string,
): Promise<Candidate> {
  if (await audio.isLive())
    throw new DownloadError("LIVE", t("errLiveAudio"));
  const [codec, sampleRate, channels, stats] = await Promise.all([
    audio.getCodec(),
    audio.getSampleRate(),
    audio.getNumberOfChannels(),
    audio.computePacketStats(96),
  ]);
  if (!codec || !stats.packetCount)
    throw new DownloadError("NO_AUDIO", t("errNoAudioData"));
  const bitrate = stats.averageBitrate;
  return {
    ...v,
    mode: "audio",
    id: `${inputKey}:audio:${audio.number}`,
    inputKey,
    audioTrackId: audio.number,
    width: 0,
    height: 0,
    audio: true,
    codec,
    sampleRate,
    channels,
    bitrate,
    bitrateEstimated: true,
    label: `${codec.toUpperCase()}_${Math.round(bitrate / 1000)}kbps`,
  };
}
function close(input: Input) {
  input.dispose();
  inputs.delete(input);
  probeFactories.get(input)?.dispose();
}
async function describe(
  video: InputVideoTrack,
  v: Variant,
  inputKey: string,
): Promise<Candidate> {
  if (await video.isLive())
    throw new DownloadError("LIVE", t("errLiveMedia"));
  const audioTracks = await video.getPairableAudioTracks();
  const scored = await Promise.all(
    audioTracks.map(async (track) => ({
      track,
      bitrate: (await track.getBitrate()) ?? 0,
      primary: (await track.getDisposition()).primary,
    })),
  );
  scored.sort(
    (a, b) =>
      Number(!!b.primary) - Number(!!a.primary) || b.bitrate - a.bitrate,
  );
  const audio = scored[0]?.track;
  const [width, height, codec, rate] = await Promise.all([
    video.getDisplayWidth(),
    video.getDisplayHeight(),
    video.getCodec(),
    video.computeFrameRateMetrics({ targetPacketCount: 64 }),
  ]);
  if (!width || !height)
    throw new DownloadError("NO_SIZE", t("errNoResolution"));
  if (audio) await audio.getDecoderConfig();
  return {
    ...v,
    id: `${inputKey}:${video.number}`,
    inputKey,
    trackId: video.number,
    audioTrackId: audio?.number,
    width,
    height,
    codec: codec ?? undefined,
    fps: rate.bestGuessFrameRate ?? undefined,
    bitrate:
      v.bitrate ??
      (await video.getAverageBitrate()) ??
      (await video.getBitrate()) ??
      undefined,
    audio: !!audio,
    label: `${width}x${height}`,
  };
}
async function plan(
  record: MediaRecord,
  requestId: string,
): Promise<MediaPlan> {
  const networkSlots = new Limiter(4);
  const candidates: Candidate[] = [],
    audioCandidates: Candidate[] = [],
    warnings: string[] =
      record.source === "syndication"
        ? [t("warnSyndicationMissing")]
        : [];
  await mapLimit(record.variants, 3, async (v, i) => {
    control.signal.throwIfAborted();
    const input = open(v, new ProbeSources(control.signal, networkSlots));
    const deadline = setTimeout(() => input.dispose(), 12000);
    try {
      const tracks = await input.getVideoTracks();
      await Promise.all([
        mapLimit(
          (await input.getAudioTracks()).slice(0, 16),
          3,
          async (audio) => {
            try {
              audioCandidates.push(await describeAudio(audio, v, String(i)));
            } catch (e) {
              if ((e as DownloadError).stop) throw e;
              warnings.push(t("warnTrackUncheckable", errorText(e)));
            }
          },
        ),
        mapLimit(tracks.slice(0, 12), 3, async (video) => {
          try {
            if (v.kind === "hls" && (await video.hasOnlyKeyPackets())) return;
            candidates.push(await describe(video, v, String(i)));
          } catch (e) {
            if ((e as DownloadError).stop) throw e;
            warnings.push(
              t("warnVariantUnparsed", [v.kind.toUpperCase(), errorText(e)]),
            );
          }
        }),
      ]);
    } catch (e) {
      if ((e as DownloadError).stop) throw e;
      warnings.push(t("warnCandidateUnavailable", [v.kind.toUpperCase(), errorText(e)]));
    } finally {
      clearTimeout(deadline);
      close(input);
    }
    postMessage({
      type: "partial",
      requestId,
      quality: {
        ...summarize({
          candidates: [...candidates].sort(compareCandidates),
          audioCandidates: [...audioCandidates].sort(compareAudio),
          warnings: [...warnings],
        }),
        pending: true,
      },
    });
  });
  if (candidates.some((c) => c.audio)) {
    const silent = candidates.filter((c) => !c.audio);
    if (silent.length) {
      warnings.push(t("warnExcludedUnpaired"));
      for (const c of silent) candidates.splice(candidates.indexOf(c), 1);
    }
  }
  candidates.sort(compareCandidates);
  audioCandidates.sort(compareAudio);
  if (!candidates.length && !audioCandidates.length)
    throw new DownloadError(
      "NO_CANDIDATE",
      warnings.at(-1) ?? t("errNoDownloadableVideo"),
    );
  return {
    candidates,
    audioCandidates,
    warnings: [...new Set(warnings)].slice(0, 12),
  };
}
async function render(
  jobId: string,
  candidate: Candidate,
  record: MediaRecord,
  mode: DownloadMode = "video",
) {
  const estimate = await navigator.storage.estimate();
  const expected =
    candidate.bitrate && record.durationMs
      ? (candidate.bitrate * record.durationMs) / 8000
      : 0;
  if (
    expected &&
    estimate.quota &&
    estimate.quota - (estimate.usage ?? 0) < expected * 1.15
  )
    throw new DownloadError("QUOTA", t("errQuota"), true);
  const root = await navigator.storage.getDirectory();
  const dir = await root.getDirectoryHandle("xvd-temp", { create: true });
  const outputName = `${jobId}.${extensionOf(mode)}`;
  const file = await dir.getFileHandle(outputName, { create: true });
  const writable = await file.createWritable();
  const input = open(candidate);
  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: "fragmented" }),
    target: new StreamTarget(writable, {
      chunked: true,
      chunkSize: 1024 * 1024,
    }),
  });
  try {
    const video =
      mode === "video"
        ? (await input.getVideoTracks()).find(
            (v) => v.number === candidate.trackId,
          )
        : undefined;
    if (mode === "video" && (!video || (await video.isLive())))
      throw new DownloadError("CHANGED", t("errPlanChanged"));
    const audios = video
      ? await video.getPairableAudioTracks()
      : await input.getAudioTracks();
    const audio = audios.find((a) => a.number === candidate.audioTrackId);
    if ((candidate.audio && !audio) || (audio && (await audio.isLive())))
      throw new DownloadError("NO_AUDIO", t("errMissingPairedTrack"));
    conversion = await Conversion.init({
      input,
      output,
      tracks: "all",
      copy: { mode: "forced" },
      tags: {},
      showWarnings: false,
      video: (track) => ({
        discard: mode === "audio" || track.number !== video?.number,
      }),
      audio: (track) => ({ discard: track.number !== audio?.number }),
    });
    const required = conversion.discardedTracks.filter(
      (d) => d.track === video || d.track === audio,
    );
    if (!conversion.isValid || required.length)
      throw new DownloadError("COPY_FAILED", t("errMuxFailed"));
    let last = 0;
    conversion.onProgress = (progress) => {
      if (Date.now() - last > 700) {
        last = Date.now();
        postMessage({ type: "progress", progress });
      }
    };
    await conversion.execute();
    const completed = await file.getFile();
    if (completed.size < 256)
      throw new DownloadError("EMPTY_FILE", t("errEmptyMux"));
    const verify = new Input({
      source: new BlobSource(completed),
      formats: [MP4],
    });
    try {
      const actual = await verify.getPrimaryVideoTrack(),
        actualAudio = await verify.getPrimaryAudioTrack();
      if (
        mode === "video" &&
        (!actual ||
          (await actual.getDisplayWidth()) !== candidate.width ||
          (await actual.getDisplayHeight()) !== candidate.height ||
          (candidate.audio && !(await verify.getAudioTracks()).length))
      )
        throw new DownloadError(
          "VERIFY_FAILED",
          t("errVerifyVideo"),
        );
      if (
        mode === "audio" &&
        (actual ||
          !actualAudio ||
          (await actualAudio.getCodec()) !== candidate.codec ||
          (await actualAudio.getSampleRate()) !== candidate.sampleRate ||
          (await actualAudio.getNumberOfChannels()) !== candidate.channels)
      )
        throw new DownloadError("VERIFY_AUDIO", t("errVerifyAudio"));
    } finally {
      verify.dispose();
    }
    return { file: outputName, size: completed.size };
  } catch (e) {
    try {
      await output.cancel();
    } catch {}
    try {
      await writable.abort();
    } catch {}
    if ((e as DOMException).name === "QuotaExceededError")
      throw new DownloadError("QUOTA", t("errDiskQuota"), true);
    throw e;
  } finally {
    close(input);
    conversion = undefined;
  }
}
onmessage = (event) => {
  const m = event.data;
  if (m.type === "cancel") {
    control.abort();
    for (const input of inputs) input.dispose();
    void conversion?.cancel().catch(() => {});
    return;
  }
  void (
    m.type === "plan"
      ? plan(m.record, m.requestId)
      : render(m.jobId, m.candidate, m.record, m.mode)
  )
    .then((result) =>
      postMessage({ type: "result", requestId: m.requestId, result }),
    )
    .catch((e) =>
      postMessage({
        type: "error",
        requestId: m.requestId,
        error: errorText(e),
        stop: (e as DownloadError).stop === true || control.signal.aborted,
      }),
    );
};
