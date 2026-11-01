import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  type Claim,
  type ClaimProposal,
  type Declared,
  type Listing,
  type Policy,
} from "../claims/schema.ts";
import {
  DEFAULT_VERIFY,
  type Detection,
  declaredClaims,
  toDetections,
  type VerifyOptions,
  verifyProposal,
} from "../claims/verify.ts";
import type { SamFrame } from "../meta/sam.ts";
import type { Store } from "../store.ts";
import { extractEvidenceFrame, normalize, SAMPLE_FPS } from "./media.ts";

/** Muse Spark turns a clip into proposals. Proposals are not facts. */
export interface Proposer {
  propose(args: {
    videoPath: string;
    durationSec: number;
    styleNotes: string;
  }): Promise<ClaimProposal[]>;
}

/** SAM 3.1 looks for one concept in the clip and returns per-frame detections. */
export interface Segmenter {
  find(args: { videoPath: string; concept: string; frames: number }): Promise<SamFrame[]>;
}

export interface IngestResult {
  listing: Listing;
  counts: Record<Claim["provenance"], number>;
  concepts: number;
}

export const MAX_CONCEPTS = 14;

export async function ingestVideo(args: {
  id: string;
  video: string;
  declared: Declared;
  policy: Policy;
  brokerId: string;
  store: Store;
  proposer: Proposer;
  segmenter: Segmenter;
  styleNotes?: string;
  verify?: VerifyOptions;
  now?: () => Date;
  log?: (msg: string) => void;
}): Promise<IngestResult> {
  const log = args.log ?? (() => {});
  const now = (args.now ?? (() => new Date()))().toISOString();
  const dir = args.store.listingDir(args.id);
  mkdirSync(join(dir, "evidence"), { recursive: true });

  const clip = join(dir, "clip.mp4");
  const info = await normalize(args.video, clip);
  const frames = Math.floor(info.durationSec * SAMPLE_FPS);
  log(
    `normalized: ${info.durationSec.toFixed(1)}s, ${info.width}x${info.height}, ~${frames} frames at ${SAMPLE_FPS} fps`,
  );

  const proposals = await args.proposer.propose({
    videoPath: clip,
    durationSec: info.durationSec,
    styleNotes: args.styleNotes ?? "",
  });
  log(`Muse Spark proposed ${proposals.length} claims`);

  const concepts = [
    ...new Set(
      proposals
        .filter((p) => !p.subjective && p.concept)
        .map((p) => (p.concept as string).trim().toLowerCase()),
    ),
  ].slice(0, MAX_CONCEPTS);
  const clipHash = createHash("sha256").update(readFileSync(clip)).digest("hex").slice(0, 16);
  const detections = new Map<string, Detection[]>();
  for (const concept of concepts) {
    const cache = join(
      args.store.root,
      "cache",
      "sam",
      `${clipHash}-${createHash("sha256").update(concept).digest("hex").slice(0, 12)}.json`,
    );
    let found: SamFrame[];
    if (existsSync(cache)) {
      found = JSON.parse(readFileSync(cache, "utf8")) as SamFrame[];
    } else {
      found = await args.segmenter.find({ videoPath: clip, concept, frames });
      mkdirSync(join(args.store.root, "cache", "sam"), { recursive: true });
      writeFileSync(cache, JSON.stringify(found));
    }
    detections.set(concept, toDetections(found, SAMPLE_FPS));
    log(`SAM "${concept}": ${found.length} frames with detections`);
  }

  const verified: Claim[] = [];
  for (const p of proposals) {
    const key = p.concept?.trim().toLowerCase() ?? null;
    const claim = verifyProposal(
      p,
      key && detections.has(key) ? (detections.get(key) as Detection[]) : null,
      args.verify ?? DEFAULT_VERIFY,
    );
    if (claim.provenance === "visually_verified" && claim.evidence) {
      const image = `evidence/${claim.id}.jpg`;
      await extractEvidenceFrame(
        clip,
        claim.evidence.t_sec ?? 0,
        claim.evidence.box,
        join(dir, image),
      );
      claim.evidence = { ...claim.evidence, image };
    }
    verified.push(claim);
  }

  const listing: Listing = {
    id: args.id,
    createdAt: now,
    declared: args.declared,
    policy: args.policy,
    claims: [...declaredClaims(args.declared, args.brokerId, now), ...verified],
  };
  args.store.saveListing(listing);
  const counts = { visually_verified: 0, broker_declared: 0, unverified: 0, subjective: 0 };
  for (const c of listing.claims) counts[c.provenance]++;
  return { listing, counts, concepts: concepts.length };
}
