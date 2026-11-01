import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type ClaimProposal, DEFAULT_POLICY } from "../src/claims/schema.ts";
import { ingestVideo, type Proposer, type Segmenter } from "../src/extract/ingest.ts";
import { OfflineAnswerModel } from "../src/gateway/offline-model.ts";
import { renderReport } from "../src/report.ts";
import { Store } from "../src/store.ts";
import { applyClaimEdit, evalCases, styleGuide, styleNotes } from "../src/taste/edits.ts";

const declared = {
  title: "2 dorm Nunoa",
  operation: "rent" as const,
  commune: "Nunoa",
  address: null,
  price: { amount: 450000, currency: "CLP" as const },
  area_m2: 55,
  bedrooms: 2,
  bathrooms: 1,
  pets_allowed: true,
};

const proposal = (o: Partial<ClaimProposal>): ClaimProposal => ({
  id: "c1",
  category: "feature",
  statement: "Kitchen has an island",
  concept: "kitchen island",
  t_start: 1,
  t_end: 2.5,
  subjective: false,
  ...o,
});
const box = { x1: 100, y1: 100, x2: 500, y2: 400, w: 1280, h: 720 };

function makeVideo(dir: string): string {
  const out = join(dir, "in.mp4");
  execFileSync("ffmpeg", [
    "-y",
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc=duration=4:size=640x360:rate=10",
    "-f",
    "lavfi",
    "-i",
    "anullsrc=r=44100:cl=mono",
    "-t",
    "4",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    out,
  ]);
  return out;
}

describe("ingestVideo with fakes (no API, real ffmpeg)", () => {
  it("verifies what SAM can see, holds back what it cannot, and never asserts taste", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aval-ingest-"));
    const store = new Store(join(dir, ".aval"));
    const proposals = [
      proposal({}),
      proposal({ id: "c2", statement: "Has a swimming pool", concept: "swimming pool" }),
      proposal({ id: "c3", statement: "Very bright living room", concept: null, subjective: true }),
      proposal({
        id: "c4",
        statement: "Parquet floor",
        concept: "parquet floor",
        t_start: 0.5,
        t_end: 3,
      }),
    ];
    const proposer: Proposer = { propose: async () => proposals };
    const seen: string[] = [];
    const segmenter: Segmenter = {
      find: async ({ concept }) => {
        seen.push(concept);
        // SAM sees the island in frames 5..8 (1.0s-1.6s at 5 fps) and the pool nowhere.
        if (concept === "kitchen island")
          return [5, 6, 7, 8].map((frame) => ({
            frame,
            objects: [{ id: 1, box, confidence: 0.9, maskToken: null }],
          }));
        if (concept === "parquet floor")
          return [3, 4, 5].map((frame) => ({
            frame,
            objects: [{ id: 2, box, confidence: 0.3, maskToken: null }],
          }));
        return [];
      },
    };
    const r = await ingestVideo({
      id: "demo-1",
      video: makeVideo(dir),
      declared,
      policy: DEFAULT_POLICY,
      brokerId: "b1",
      store,
      proposer,
      segmenter,
      now: () => new Date("2026-11-01T00:00:00Z"),
    });

    const by = Object.fromEntries(r.listing.claims.map((c) => [c.id, c.provenance]));
    expect(by.c1).toBe("visually_verified");
    expect(by.c2).toBe("unverified");
    expect(by.c3).toBe("subjective");
    expect(by.c4).toBe("unverified"); // seen, but only with confidence 0.3
    expect(seen).toEqual(["kitchen island", "swimming pool", "parquet floor"]); // no SAM call for taste words
    expect(existsSync(join(store.listingDir("demo-1"), "evidence", "c1.jpg"))).toBe(true);
    expect(store.loadListing("demo-1")?.claims.find((c) => c.id === "c1")?.evidence?.image).toBe(
      "evidence/c1.jpg",
    );

    // Second run is served from the SAM cache: nothing is paid twice.
    seen.length = 0;
    await ingestVideo({
      id: "demo-1",
      video: join(dir, "in.mp4"),
      declared,
      policy: DEFAULT_POLICY,
      brokerId: "b1",
      store,
      proposer,
      segmenter,
    });
    expect(seen).toEqual([]);
  }, 60_000);

  it("renders a report that separates the broker view from the agent view", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aval-report-"));
    const store = new Store(join(dir, ".aval"));
    const proposer: Proposer = {
      propose: async () => [
        proposal({}),
        proposal({ id: "c3", statement: "Very bright", concept: null, subjective: true }),
      ],
    };
    const segmenter: Segmenter = {
      find: async () =>
        [5, 6, 7].map((frame) => ({
          frame,
          objects: [{ id: 1, box, confidence: 0.9, maskToken: null }],
        })),
    };
    const { listing } = await ingestVideo({
      id: "demo-2",
      video: makeVideo(dir),
      declared,
      policy: DEFAULT_POLICY,
      brokerId: "b1",
      store,
      proposer,
      segmenter,
    });
    const html = renderReport(listing);
    expect(html).toContain("verified by video");
    expect(html).toContain("never stated");
    expect(html).toContain("What a buyer's agent is told");
    expect(html).toContain("evidence/c1.jpg");
  }, 60_000);

  it("rejects a clip over the length cap before spending anything", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aval-long-"));
    const long = join(dir, "long.mp4");
    execFileSync("ffmpeg", [
      "-y",
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=black:s=160x90:r=1:d=200",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      long,
    ]);
    const proposer: Proposer = {
      propose: async () => {
        throw new Error("must not be called");
      },
    };
    await expect(
      ingestVideo({
        id: "long-1",
        video: long,
        declared,
        policy: DEFAULT_POLICY,
        brokerId: "b",
        store: new Store(join(dir, ".aval")),
        proposer,
        segmenter: { find: async () => [] },
      }),
    ).rejects.toThrow(/limit/);
  }, 60_000);
});

describe("taste module: corrections become style and eval cases", () => {
  it("learns words the broker keeps deleting and exports eval cases, without touching provenance", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aval-taste-"));
    const store = new Store(join(dir, ".aval"));
    const proposer: Proposer = {
      propose: async () => [
        proposal({ statement: "Beautiful modern kitchen with an island" }),
        proposal({
          id: "c2",
          statement: "Beautiful modern bathroom with a bathtub",
          concept: "bathtub",
        }),
      ],
    };
    const segmenter: Segmenter = {
      find: async () =>
        [5, 6, 7].map((frame) => ({
          frame,
          objects: [{ id: 1, box, confidence: 0.9, maskToken: null }],
        })),
    };
    await ingestVideo({
      id: "demo-3",
      video: makeVideo(dir),
      declared,
      policy: DEFAULT_POLICY,
      brokerId: "b",
      store,
      proposer,
      segmenter,
    });
    applyClaimEdit(store, "demo-3", "c1", "Kitchen with an island");
    applyClaimEdit(store, "demo-3", "c2", "Bathroom with a bathtub");
    const g = styleGuide(store);
    expect(g.avoid).toEqual(expect.arrayContaining(["beautiful", "modern"]));
    expect(styleNotes(g)).toContain("beautiful");
    expect(evalCases(store)).toHaveLength(2);
    expect(store.loadListing("demo-3")?.claims.find((c) => c.id === "c1")?.provenance).toBe(
      "visually_verified",
    );
    expect(() => applyClaimEdit(store, "demo-3", "nope", "x")).toThrow(/No such claim/);
    expect(() => applyClaimEdit(store, "demo-3", "c1", "")).toThrow(/1-200/);
  }, 60_000);
});

describe("offline answer model", () => {
  it("answers from matching facts and admits when it cannot", async () => {
    const m = new OfflineAnswerModel();
    const facts = [
      {
        id: "v1",
        statement: "Kitchen has an island",
        provenance: "visually_verified" as const,
        evidence: "seen",
      },
    ];
    expect(
      (await m.answer({ question: "does it have a kitchen island?", facts })).segments[0]
        ?.claim_ids,
    ).toEqual(["v1"]);
    expect((await m.answer({ question: "is there a pool", facts })).cannot_answer).toBe(true);
  });
});

describe("repository hygiene", () => {
  it("does not track secrets or local state", () => {
    const ignore = readFileSync(join(import.meta.dirname, "..", ".gitignore"), "utf8");
    for (const p of [".env", ".aval/", "media/"]) expect(ignore).toContain(p);
  });
});
