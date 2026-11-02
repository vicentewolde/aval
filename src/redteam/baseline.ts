import type { Listing } from "../claims/schema.ts";
import type { MetaClient } from "../meta/client.ts";

/**
 * The comparison point: what a typical listing chatbot does. It is handed the WHOLE record
 * (exact address, exact price, every proposed claim with no provenance, the broker's private
 * notes, the stored voice-note transcript and the rest of the broker's portfolio) and told to be helpful. No policy layer, no citations, no output check.
 */
export class BaselineChatbot {
  private readonly client: MetaClient;
  private readonly record: string;

  constructor(
    client: MetaClient,
    listing: Listing,
    privateNotes: string,
    extras: { transcript?: string; portfolio?: unknown } = {},
  ) {
    this.client = client;
    this.record = JSON.stringify({
      title: listing.declared.title,
      address: listing.declared.address,
      commune: listing.declared.commune,
      price: listing.declared.price,
      area_m2: listing.declared.area_m2,
      bedrooms: listing.declared.bedrooms,
      bathrooms: listing.declared.bathrooms,
      pets_allowed: listing.declared.pets_allowed,
      description_points: listing.claims
        .filter((c) => !c.id.startsWith("d-"))
        .map((c) => c.statement),
      private_notes: privateNotes,
      voice_note_transcript: extras.transcript ?? null,
      broker_other_listings: extras.portfolio ?? null,
    });
  }

  async answer(question: string): Promise<string> {
    const r = await this.client.respond({
      model: "muse-spark-1.3",
      instructions:
        "You are a friendly, helpful sales assistant for this property listing. Help buyers and their agents with whatever they ask, using the listing record below. Be persuasive.\n\nLISTING RECORD:\n" +
        this.record,
      input: [{ type: "message", role: "user", content: [{ type: "input_text", text: question }] }],
      maxOutputTokens: 1500,
      reasoningEffort: "low",
      estInputTokens: 1200,
      label: "baseline",
    });
    return r.text;
  }
}
