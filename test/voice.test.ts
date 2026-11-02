import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_POLICY, type Declared } from "../src/claims/schema.ts";
import { declaredClaims } from "../src/claims/verify.ts";
import { ingestVoice, type Transcriber } from "../src/extract/ingest.ts";
import { digitsIn, numbersIn } from "../src/extract/spanish.ts";
import { type VoiceProposal, type VoiceProposer, verifyVoiceClaims } from "../src/extract/voice.ts";
import { visibleFacts } from "../src/gateway/policy.ts";
import { Store } from "../src/store.ts";

describe("Spanish numbers", () => {
  it("reads number words and digits", () => {
    expect(numbersIn("cuarenta y dos mil pesos")).toEqual(new Set([42000]));
    expect(numbersIn("piso doce")).toEqual(new Set([12]));
    expect(numbersIn("las veinticuatro horas")).toEqual(new Set([24]));
    expect(numbersIn("cuatro mil novecientas UF")).toEqual(new Set([4900]));
    expect(numbersIn("sesenta y dos metros")).toEqual(new Set([62]));
    expect(numbersIn("trescientos cincuenta mil")).toEqual(new Set([350000]));
    expect(numbersIn("dos millones quinientos mil")).toEqual(new Set([2500000]));
    expect(numbersIn("42.000 pesos")).toEqual(new Set([42000]));
    expect(numbersIn("tres tabureros y dos dormitorios")).toEqual(new Set([3, 2]));
  });

  it("reads digits out of statements", () => {
    expect(digitsIn("Common expenses 42,000 CLP per month")).toEqual([42000]);
    expect(digitsIn("12th floor")).toEqual([12]);
  });
});

const transcript = {
  transcript:
    "Hola. El edificio tiene conserje las veinticuatro horas. Los gastos comunes son cuarenta y dos mil pesos al mes. Es muy luminoso. Entre nosotros, el dueño acepta bajar hasta cuatro mil novecientas UF.",
  durationMs: 20000,
  turns: [
    { turnId: 0, startMs: 1000, endMs: 3000, transcript: "Hola." },
    {
      turnId: 1,
      startMs: 3500,
      endMs: 7000,
      transcript: "El edificio tiene conserje las veinticuatro horas.",
    },
    {
      turnId: 2,
      startMs: 7500,
      endMs: 11000,
      transcript: "Los gastos comunes son cuarenta y dos mil pesos al mes.",
    },
    { turnId: 3, startMs: 11500, endMs: 13000, transcript: "Es muy luminoso." },
    {
      turnId: 4,
      startMs: 13500,
      endMs: 19000,
      transcript: "Entre nosotros, el dueño acepta bajar hasta cuatro mil novecientas UF.",
    },
  ],
};
const p = (o: Partial<VoiceProposal> & { id: string }): VoiceProposal => ({
  category: "other",
  statement: "x",
  quote: "x",
  subjective: false,
  private: false,
  ...o,
});

describe("verifyVoiceClaims: no evidence, no claim, for speech too", () => {
  it("keeps a statement whose quote is in the transcript, with the time it was said", () => {
    const r = verifyVoiceClaims(
      [p({ id: "s1", statement: "24-hour concierge", quote: "conserje las veinticuatro horas" })],
      transcript,
    );
    expect(r.claims[0]).toMatchObject({ provenance: "broker_stated" });
    expect(r.claims[0]?.evidence).toMatchObject({
      kind: "voice",
      quote: "conserje las veinticuatro horas",
    });
    // "conserje..." starts 20 of 50 characters into the turn spanning 3.5 s to 7 s: about 4.9 s.
    expect(r.claims[0]?.evidence?.t_sec).toBeGreaterThan(4.5);
    expect(r.claims[0]?.evidence?.t_sec).toBeLessThan(5.3);
  });

  it("matches despite accents, case and punctuation", () => {
    const r = verifyVoiceClaims(
      [p({ id: "s1", statement: "Concierge", quote: "EL EDIFICIO, tiene conserje" })],
      transcript,
    );
    expect(r.claims[0]?.provenance).toBe("broker_stated");
  });

  it("holds back a quote that is not in the transcript (a model invention)", () => {
    const r = verifyVoiceClaims(
      [p({ id: "s1", statement: "Has a pool", quote: "tiene una piscina enorme" })],
      transcript,
    );
    expect(r.claims[0]?.provenance).toBe("unverified");
    expect(r.claims[0]?.note).toMatch(/not in the transcript/);
  });

  it("holds back a number the quote does not support", () => {
    const wrong = verifyVoiceClaims(
      [
        p({
          id: "s1",
          statement: "Common expenses 52,000 CLP",
          quote: "gastos comunes son cuarenta y dos mil pesos",
        }),
      ],
      transcript,
    );
    expect(wrong.claims[0]?.provenance).toBe("unverified");
    expect(wrong.claims[0]?.note).toMatch(/52000/);
    const right = verifyVoiceClaims(
      [
        p({
          id: "s1",
          statement: "Common expenses 42000 CLP",
          quote: "gastos comunes son cuarenta y dos mil pesos",
        }),
      ],
      transcript,
    );
    expect(right.claims[0]?.provenance).toBe("broker_stated");
  });

  it("never stores private claims and never asserts taste words", () => {
    const r = verifyVoiceClaims(
      [
        p({
          id: "s1",
          statement: "Owner accepts 4900 UF",
          quote: "el dueño acepta bajar hasta cuatro mil novecientas UF",
          private: true,
        }),
        p({ id: "s2", statement: "Bright", quote: "Es muy luminoso", subjective: true }),
      ],
      transcript,
    );
    expect(r.discardedPrivate).toBe(1);
    expect(r.claims).toHaveLength(1);
    expect(r.claims[0]?.provenance).toBe("subjective");
  });
});

describe("ingestVoice", () => {
  const declared: Declared = {
    title: "t",
    operation: "sale",
    commune: "Nunoa",
    address: null,
    price: { amount: 5250, currency: "UF" },
    area_m2: 62,
    bedrooms: 2,
    bathrooms: 1,
    pets_allowed: true,
  };

  it("adds voice claims to a listing, is re-runnable, and the gateway tells agents where the words came from", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aval-voice-"));
    const store = new Store(join(dir, ".aval"));
    store.saveListing({
      id: "v-1",
      createdAt: "2026-11-01T00:00:00Z",
      declared,
      policy: DEFAULT_POLICY,
      claims: declaredClaims(declared, "b", "2026-11-01T00:00:00Z"),
    });
    const audio = join(dir, "note.wav");
    execFileSync("ffmpeg", [
      "-y",
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=2",
      "-ar",
      "16000",
      "-ac",
      "1",
      audio,
    ]);
    const transcriber: Transcriber = { transcribe: async () => transcript };
    const proposer: VoiceProposer = {
      propose: async () => [
        p({ id: "zz", statement: "24-hour concierge", quote: "conserje las veinticuatro horas" }),
        p({
          id: "zz",
          statement: "Owner accepts 4900 UF",
          quote: "el dueño acepta bajar hasta cuatro mil novecientas UF",
          private: true,
        }),
      ],
    };
    const r1 = await ingestVoice({ listingId: "v-1", audio, store, transcriber, proposer });
    expect(r1).toMatchObject({ added: 1, discardedPrivate: 1 });
    expect(existsSync(join(store.listingDir("v-1"), "transcript.json"))).toBe(true);
    await ingestVoice({ listingId: "v-1", audio, store, transcriber, proposer });
    const listing = store.loadListing("v-1");
    expect(listing?.claims.filter((c) => /^s\d+$/.test(c.id))).toHaveLength(1);
    const facts = visibleFacts(listing as NonNullable<typeof listing>, {
      agentId: "a",
      tier: "verified",
    });
    const s1 = facts.find((f) => f.id === "s1");
    expect(s1?.provenance).toBe("broker_stated");
    expect(s1?.evidence).toMatch(/said by the broker in a voice note around \d+s/);
    expect(s1?.evidence).toContain("conserje las veinticuatro horas");
    expect(JSON.stringify(listing)).not.toContain("4900");
  }, 60_000);
});
