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
import { compareCandidates, compareAudio } from "./quality";
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
let conversion: Conversion | undefined;
function open(v: Variant): Input {
  const input = new Input({
    source: new UrlSource(v.url, {
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
  return input;
}
async function describeAudio(
  audio: InputAudioTrack,
  v: Variant,
  inputKey: string,
): Promise<Candidate> {
  if (await audio.isLive())
    throw new DownloadError("LIVE", "正在直播的音轨不支持下载");
  const [codec, sampleRate, channels, stats] = await Promise.all([
    audio.getCodec(),
    audio.getSampleRate(),
    audio.getNumberOfChannels(),
    audio.computePacketStats(96),
  ]);
  if (!codec || !stats.packetCount)
    throw new DownloadError("NO_AUDIO", "音轨缺少可读取的数据");
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
}
async function describe(
  video: InputVideoTrack,
  v: Variant,
  inputKey: string,
): Promise<Candidate> {
  if (await video.isLive())
    throw new DownloadError("LIVE", "正在直播的媒体不支持下载");
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
    throw new DownloadError("NO_SIZE", "无法确认视频分辨率");
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
async function plan(record: MediaRecord): Promise<MediaPlan> {
  const candidates: Candidate[] = [],
    audioCandidates: Candidate[] = [],
    warnings: string[] =
      record.source === "syndication"
        ? ["公开嵌入接口可能缺少部分媒体版本"]
        : [];
  for (const [i, v] of record.variants.entries()) {
    control.signal.throwIfAborted();
    const input = open(v);
    const deadline = setTimeout(() => input.dispose(), 20000);
    try {
      const tracks = await input.getVideoTracks();
      for (const audio of (await input.getAudioTracks()).slice(0, 16)) {
        try {
          audioCandidates.push(await describeAudio(audio, v, String(i)));
        } catch (e) {
          if ((e as DownloadError).stop) throw e;
          warnings.push(`音轨无法检查：${errorText(e)}`);
        }
      }
      for (const video of tracks.slice(0, 12)) {
        try {
          if (v.kind === "hls" && (await video.hasOnlyKeyPackets())) continue;
          candidates.push(await describe(video, v, String(i)));
        } catch (e) {
          if ((e as DownloadError).stop) throw e;
          warnings.push(
            `一个 ${v.kind.toUpperCase()} 版本无法解析：${errorText(e)}`,
          );
        }
      }
    } catch (e) {
      if ((e as DownloadError).stop) throw e;
      warnings.push(`${v.kind.toUpperCase()} 候选不可用：${errorText(e)}`);
    } finally {
      clearTimeout(deadline);
      close(input);
    }
    postMessage({ type: "activity" });
  }
  if (candidates.some((c) => c.audio)) {
    const silent = candidates.filter((c) => !c.audio);
    if (silent.length) {
      warnings.push("已排除缺少配对音轨的版本");
      for (const c of silent) candidates.splice(candidates.indexOf(c), 1);
    }
  }
  candidates.sort(compareCandidates);
  audioCandidates.sort(compareAudio);
  if (!candidates.length && !audioCandidates.length)
    throw new DownloadError(
      "NO_CANDIDATE",
      warnings.at(-1) ?? "未找到可下载的视频轨",
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
    throw new DownloadError("QUOTA", "浏览器可用磁盘空间不足", true);
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
      throw new DownloadError("CHANGED", "媒体清单已变化，请重试");
    const audios = video
      ? await video.getPairableAudioTracks()
      : await input.getAudioTracks();
    const audio = audios.find((a) => a.number === candidate.audioTrackId);
    if ((candidate.audio && !audio) || (audio && (await audio.isLive())))
      throw new DownloadError("NO_AUDIO", "所选视频缺少配对音轨");
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
      throw new DownloadError("COPY_FAILED", "所选音视频轨无法无损封装为 MP4");
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
      throw new DownloadError("EMPTY_FILE", "合并结果为空");
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
          "合并文件的画质或音轨验证失败",
        );
      if (
        mode === "audio" &&
        (actual ||
          !actualAudio ||
          (await actualAudio.getCodec()) !== candidate.codec ||
          (await actualAudio.getSampleRate()) !== candidate.sampleRate ||
          (await actualAudio.getNumberOfChannels()) !== candidate.channels)
      )
        throw new DownloadError("VERIFY_AUDIO", "音频文件的编码或音轨校验失败");
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
      throw new DownloadError("QUOTA", "浏览器磁盘配额已用尽", true);
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
      ? plan(m.record)
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
