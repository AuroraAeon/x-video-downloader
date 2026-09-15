import { mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
export const root = path.resolve("output/fixtures");
export async function makeFixtures() {
  await mkdir(root, { recursive: true });
  const ff = (args) =>
    execFileSync(
      "ffmpeg",
      ["-hide_banner", "-loglevel", "error", "-y", ...args],
      { stdio: "pipe" },
    );
  ff([
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=320x180:rate=30",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=48000",
    "-t",
    "3",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-movflags",
    "+faststart",
    `${root}/low.mp4`,
  ]);
  ff([
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=640x360:rate=30",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=48000",
    "-t",
    "3",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-movflags",
    "+faststart",
    `${root}/high.mp4`,
  ]);
  ff([
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=640x360:rate=30",
    "-t",
    "3",
    "-an",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-g",
    "30",
    "-pix_fmt",
    "yuv420p",
    "-f",
    "hls",
    "-hls_time",
    "1",
    "-hls_segment_type",
    "fmp4",
    "-hls_fmp4_init_filename",
    "init.mp4",
    "-hls_segment_filename",
    `${root}/v%d.m4s`,
    `${root}/video.m3u8`,
  ]);
  ff([
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=48000",
    "-t",
    "3",
    "-vn",
    "-c:a",
    "aac",
    "-f",
    "hls",
    "-hls_time",
    "1",
    "-hls_segment_type",
    "fmp4",
    "-hls_fmp4_init_filename",
    "audio-init.mp4",
    "-hls_segment_filename",
    `${root}/a%d.m4s`,
    `${root}/audio.m3u8`,
  ]);
  ff([
    "-i",
    `${root}/low.mp4`,
    "-c",
    "copy",
    "-f",
    "hls",
    "-hls_time",
    "1",
    "-hls_segment_filename",
    `${root}/ts%d.ts`,
    `${root}/legacy.m3u8`,
  ]);
  await writeFile(
    `${root}/master.m3u8`,
    '#EXTM3U\n#EXT-X-VERSION:7\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="Audio",DEFAULT=YES,AUTOSELECT=YES,URI="audio.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=1200000,RESOLUTION=640x360,FRAME-RATE=30,CODECS="avc1.42c01e,mp4a.40.2",AUDIO="audio"\nvideo.m3u8\n',
  );
  ff([
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=880:sample_rate=48000",
    "-t",
    "3",
    "-ac",
    "2",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    `${root}/audio-high.m4a`,
  ]);
  ff([
    "-i",
    `${root}/audio-high.m4a`,
    "-c",
    "copy",
    "-f",
    "hls",
    "-hls_time",
    "1",
    "-hls_segment_type",
    "fmp4",
    "-hls_fmp4_init_filename",
    "high-audio-init.mp4",
    "-hls_segment_filename",
    `${root}/ha%d.m4s`,
    `${root}/high-audio.m3u8`,
  ]);
  ff(["-i", `${root}/high.mp4`, "-an", "-c:v", "copy", `${root}/silent.mp4`]);
  ff(["-i", `${root}/high.mp4`, "-frames:v", "1", `${root}/poster.png`]);
  await writeFile(
    `${root}/master-audio.m3u8`,
    '#EXTM3U\n#EXT-X-VERSION:7\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="Low",DEFAULT=YES,AUTOSELECT=YES,URI="audio.m3u8"\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="High",DEFAULT=NO,AUTOSELECT=YES,URI="high-audio.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=1400000,RESOLUTION=640x360,FRAME-RATE=30,CODECS="avc1.42c01e,mp4a.40.2",AUDIO="audio"\nvideo.m3u8\n',
  );
}
export const poster =
  "https://pbs.twimg.com/ext_tw_video_thumb/111/pu/img/a.jpg";
export function tweet(id = "1000000000000000001", mode = "normal") {
  const base = `https://video.twimg.com/ext_tw_video/111/${mode}/`;
  const result = {
    __typename: "Tweet",
    rest_id: id,
    core: { user_results: { result: { core: { screen_name: "fixture" } } } },
    media_entities2: [
      {
        id_str: "111",
        type: "video",
        media_url_https: poster,
        video_info: {
          duration_millis: 3000,
          variants:
            mode === "legacy"
              ? [
                  {
                    content_type: "application/x-mpegURL",
                    url: base + "legacy.m3u8",
                  },
                ]
              : [
                  {
                    content_type: "video/mp4",
                    bitrate: mode === "nativefail" ? 3000000 : 500000,
                    url:
                      base + (mode === "nativefail" ? "high.mp4" : "low.mp4"),
                  },
                  {
                    content_type: "application/x-mpegURL",
                    url:
                      base +
                      (mode === "audioquality"
                        ? "master-audio.m3u8"
                        : "master.m3u8"),
                  },
                ],
        },
      },
    ],
  };
  if (mode === "silent")
    result.media_entities2[0].video_info.variants = [
      { content_type: "video/mp4", url: base + "silent.mp4" },
    ];
  if (mode === "directaudio")
    result.media_entities2[0].video_info.variants = [
      { content_type: "video/mp4", url: base + "low.mp4" },
    ];
  return result;
}
export function html(data, ssr = false) {
  const source = ssr
    ? `window.__INITIAL_STATE__=${JSON.stringify(data)}`
    : `fetch('https://api.x.com/graphql/new-query-id/TweetResultByRestId?variables=%7B%7D').then(r=>r.json())`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>X extension fixture</title><style>body{margin:0;background:#f7f9fa;font:16px system-ui;color:#192830}main{max-width:680px;margin:30px auto}article{background:white;padding:22px;border-bottom:1px solid #ccd9dd}.video{position:relative;width:100%;aspect-ratio:16/9;background:#172830}video{width:100%;height:100%;object-fit:contain}a{color:#086d8c}h1{font-size:24px}p{line-height:1.5}</style></head><body><main><h1>Video post</h1><article><p>@fixture</p><div class="video"><video poster="${poster}" controls></video></div><p><a href="/fixture/status/${data.rest_id}">Post ${data.rest_id}</a></p></article></main><script>${source}</script></body></html>`;
}
