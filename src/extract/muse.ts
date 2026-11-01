import { z } from "zod";
import { type ClaimProposal, ProposalListSchema } from "../claims/schema.ts";
import type { MetaClient } from "../meta/client.ts";
import type { Proposer, Segmenter } from "./ingest.ts";

const INSTRUCTIONS = `You watch a real-estate walkthrough video and list what can be SEEN, for a listing registry.
Rules:
1. Propose at most 12 claims, each about one concrete thing visible in the video: rooms, fixtures, appliances, finishes, views, layout.
2. For each claim give t_start and t_end in seconds (where it is on screen) and "concept": a short English noun phrase a segmentation model can find in a frame (for example "kitchen island", "bathtub", "balcony", "hardwood floor"). Use null if nothing visible would prove it.
3. Set subjective=true for taste or judgement words (bright, spacious, cozy, modern, quiet, great view). State what is visible instead, if anything, as a separate claim.
4. Never infer what is not shown: no square meters, no room counts you cannot count on screen, no neighbourhood facts, no condition you cannot see.
5. Statements are short, neutral and in English. Ids are c1, c2, ... in order.
Reply as JSON matching the schema.`;

/** Muse Spark watches the clip (Files API + video input) and returns claim proposals. */
export class MuseProposer implements Proposer {
  private readonly client: MetaClient;

  constructor(client: MetaClient) {
    this.client = client;
  }

  async propose({
    videoPath,
    durationSec,
    styleNotes,
  }: {
    videoPath: string;
    durationSec: number;
    styleNotes: string;
  }): Promise<ClaimProposal[]> {
    const fileId = await this.client.uploadFile(videoPath);
    try {
      const prompt = `The video is ${durationSec.toFixed(0)} seconds long.${styleNotes ? `\nBroker style notes (wording only, never new facts):\n${styleNotes}` : ""}`;
      const r = await this.client.respond({
        model: "muse-spark-1.3",
        instructions: INSTRUCTIONS,
        input: [
          {
            type: "message",
            role: "user",
            content: [
              { type: "input_text", text: prompt },
              { type: "input_video", file_id: fileId },
            ],
          },
        ],
        jsonSchema: {
          name: "claim_proposals",
          schema: z.toJSONSchema(ProposalListSchema) as Record<string, unknown>,
        },
        maxOutputTokens: 3000,
        reasoningEffort: "low",
        // Video token counts are not documented; assume a generous 6k tokens per second so the guard stays safe.
        estInputTokens: Math.ceil(durationSec * 6000) + 1000,
        label: "propose-claims",
      });
      return ProposalListSchema.parse(JSON.parse(r.text)).claims;
    } finally {
      await this.client.deleteFile(fileId).catch(() => {});
    }
  }
}

/** One SAM 3.1 request per concept, over the normalized clip. */
export class SamSegmenter implements Segmenter {
  private readonly client: MetaClient;
  private fileId: string | null = null;
  private path: string | null = null;

  constructor(client: MetaClient) {
    this.client = client;
  }

  async find({
    videoPath,
    concept,
    frames,
  }: {
    videoPath: string;
    concept: string;
    frames: number;
  }) {
    if (this.path !== videoPath || !this.fileId) {
      this.fileId = await this.client.uploadFile(videoPath);
      this.path = videoPath;
    }
    const r = await this.client.segmentVideo({
      concept,
      fileId: this.fileId,
      frames,
      label: `sam:${concept}`,
    });
    return r.frames;
  }

  async close(): Promise<void> {
    if (this.fileId) await this.client.deleteFile(this.fileId).catch(() => {});
    this.fileId = null;
  }
}
