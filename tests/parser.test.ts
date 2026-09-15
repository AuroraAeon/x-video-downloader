import { describe, it, expect } from "vitest";
import { SsrDecoder } from "../src/ssr";
import { extractMedia, expandRelay, mergeRecord } from "../src/extract";
import {
  mediaUrl,
  postUrl,
  validateRecord,
  safeJson,
  filename,
} from "../src/security";
import { compareCandidates } from "../src/quality";
import { MAX_JSON, type Candidate } from "../src/types";

const media = {
  id_str: "1001551417340022785",
  type: "video",
  media_url_https:
    "https://pbs.twimg.com/ext_tw_video_thumb/1001551417340022785/pu/img/a.jpg",
  video_info: {
    duration_millis: 3000,
    variants: [
      {
        bitrate: 832000,
        content_type: "video/mp4",
        url: "https://video.twimg.com/ext_tw_video/1001551417340022785/pu/vid/480x360/a.mp4?tag=3",
      },
      {
        content_type: "application/x-mpegURL",
        url: "https://video.twimg.com/ext_tw_video/1001551417340022785/pl/a.m3u8",
      },
    ],
  },
};
const tweet = (id = "1001551623938805763") => ({
  __typename: "Tweet",
  rest_id: id,
  core: { user_results: { result: { core: { screen_name: "test" } } } },
  media_entities2: [media],
});
describe("media metadata", () => {
  it("extracts current GraphQL and preserves large IDs", () => {
    const r = extractMedia(
      { data: { tweet_result_by_rest_id: { result: tweet() } } },
      "graphql",
    )[0]!;
    expect(r.tweetId).toBe("1001551623938805763");
    expect(r.variants[0]).toMatchObject({ width: 480, height: 360 });
    expect(r.variants[1]?.bitrate).toBeUndefined();
  });
  it("handles legacy, visibility wrappers, quote and retweet independently", () => {
    const legacy = {
      __typename: "Tweet",
      rest_id: "123",
      legacy: {
        extended_entities: { media: [media] },
        retweeted_status_result: { result: tweet("456") },
      },
      quoted_status_result: {
        result: {
          __typename: "TweetWithVisibilityResults",
          tweet: tweet("789"),
        },
      },
    };
    expect(
      extractMedia(
        { errors: [{ message: "partial" }], data: legacy },
        "graphql",
      )
        .map((r) => r.tweetId)
        .sort(),
    ).toEqual(["123", "456", "789"]);
  });
  it("handles card JSON bindings in list and map form", () => {
    for (const binding_values of [
      [
        {
          key: "unified_card",
          value: {
            string_value: JSON.stringify({ media_entities: { key: media } }),
          },
        },
      ],
      {
        unified_card: {
          string_value: JSON.stringify({ media_entities: { key: media } }),
        },
      },
    ]) {
      expect(
        extractMedia(
          { __typename: "Tweet", id_str: "123", card: { binding_values } },
          "syndication",
        ),
      ).toHaveLength(1);
    }
  });
  it("handles multiple media and animated GIF without mixing photo indexes", () => {
    const t = tweet();
    t.media_entities2 = [
      { ...media, type: "photo" },
      media,
      { ...media, id_str: "333", type: "animated_gif" },
    ];
    const r = extractMedia(t, "graphql");
    expect(r.map((x) => x.index)).toEqual([2, 3]);
    expect(r[1]?.animated).toBe(true);
  });
  it("rejects unavailable, broken and unsafe media without throwing", () => {
    expect(
      extractMedia(
        { data: { __typename: "TweetUnavailable", reason: "Protected" } },
        "graphql",
      ),
    ).toEqual([]);
    expect(
      extractMedia(
        {
          ...tweet(),
          media_entities2: [
            {
              ...media,
              video_info: {
                variants: [
                  {
                    content_type: "video/mp4",
                    url: "https://evil.example/a.mp4",
                  },
                ],
              },
            },
          ],
        },
        "graphql",
      ),
    ).toEqual([]);
  });
  it("renews signed URLs without accumulating stale signatures", () => {
    const a = extractMedia(tweet(), "graphql")[0]!,
      b = structuredClone(a);
    b.variants[0]!.url = b.variants[0]!.url.replace("tag=3", "tag=4");
    b.source = "syndication";
    const merged = mergeRecord(a, b);
    expect(merged.variants).toHaveLength(2);
    expect(merged.variants[0]!.url).toContain("tag=4");
    expect(merged.source).toBe("graphql");
  });
});
describe("SSR data decoder", () => {
  it("decodes actual assignment-style Relay references without executing code", () => {
    const source =
      '($R=>$R[0]={dehydratedData:$R[1]={relayRecords:$R[2]={"t":$R[3]={__id:"t",__typename:"Tweet",rest_id:"123",media_entities2:$R[4]={__refs:$R[5]=["m"]}},"m":$R[6]={__id:"m",__typename:"ApiMediaEntity",id_str:"444",type:"video",video_info:$R[7]={__ref:"v"}},"v":$R[8]={variants:$R[9]={__refs:$R[10]=["p"]}},"p":$R[11]={content_type:"video/mp4",url:"https://video.twimg.com/ext_tw_video/444/vid/1280x720/a.mp4",bitrate:1000000}}}})($R["tsr"]);';
    const r = new SsrDecoder().decode(source);
    expect(r).toHaveLength(1);
    expect(r[0]?.mediaId).toBe("444");
    expect(r[0]?.variants[0]?.width).toBe(1280);
  });
  it("decodes legacy initial state data and ignores executable expressions", () => {
    const d = new SsrDecoder();
    expect(
      d.decode(`window.__INITIAL_STATE__=${JSON.stringify(tweet())};`),
    ).toHaveLength(1);
    expect(
      d.decode('window.__INITIAL_STATE__=(()=>{throw Error("executed")})();'),
    ).toEqual([]);
    expect(
      d.decode(
        "let relayRecords={__proto__:{polluted:true},constructor:{prototype:{polluted:true}}};",
      ),
    ).toEqual([]);
    expect(({} as any).polluted).toBeUndefined();
  });
  it("bounds malformed or oversized input and circular Relay references", () => {
    expect(
      new SsrDecoder().decode("relayRecords " + "x".repeat(MAX_JSON)),
    ).toEqual([]);
    expect(new SsrDecoder().decode("relayRecords {broken")).toEqual([]);
    expect(() =>
      expandRelay({
        t: { __typename: "Tweet", rest_id: "1", next: { __ref: "t" } },
      }),
    ).not.toThrow();
    expect(() => safeJson("x".repeat(MAX_JSON + 1))).toThrow();
  });
});
describe("security and ranking", () => {
  it.each([
    "http://video.twimg.com/ext_tw_video/1/a.mp4",
    "https://video.twimg.com.evil.test/ext_tw_video/1/a.mp4",
    "https://u:p@video.twimg.com/ext_tw_video/1/a.mp4",
    "https://video.twimg.com:444/ext_tw_video/1/a.mp4",
    "https://video.twimg.com/ext_tw_video/../../a.mp4",
    "file:///a",
    "blob:https://x.com/a",
  ])("rejects unsafe address %s", (url) =>
    expect(mediaUrl(url)).toBeUndefined(),
  );
  it("rejects invalid record IDs and path traversal filename content", () => {
    const r = extractMedia(tweet(), "graphql")[0]!;
    expect(
      validateRecord({ ...r, tweetId: 1001551623938805763 }),
    ).toBeUndefined();
    expect(validateRecord({ ...r, author: "../bad" })).toBeUndefined();
    expect(filename(r, "480/360")).not.toContain("/");
  });
  it("parses canonical and media status paths", () => {
    expect(postUrl("https://x.com/i/web/status/123")?.id).toBe("123");
    expect(postUrl("/test/status/123/video/2")?.index).toBe(2);
    expect(postUrl("https://evil.test/test/status/123")).toBeUndefined();
  });
  it("prioritizes pixels, FPS, comparable bitrate and direct MP4 ties", () => {
    const c = (
      id: string,
      w: number,
      h: number,
      kind: "hls" | "mp4",
      fps = 30,
      bitrate = 100,
    ): Candidate => ({
      id,
      url: "",
      inputKey: "",
      kind,
      width: w,
      height: h,
      fps,
      bitrate,
      codec: "avc",
      audio: true,
      label: "",
    });
    const a = [
      c("sd", 640, 360, "mp4"),
      c("hd", 1920, 1080, "hls"),
      c("hd60", 1920, 1080, "hls", 60),
      c("direct", 1920, 1080, "mp4", 60),
    ];
    expect(a.sort(compareCandidates).map((c) => c.id)).toEqual([
      "direct",
      "hd60",
      "hd",
      "sd",
    ]);
  });
});
