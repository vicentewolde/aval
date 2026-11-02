import { z } from "zod";
import type { MetaClient } from "../meta/client.ts";
import { DOC_TYPES, type Extraction, ExtractionSchema, KEYS } from "./schema.ts";

/** Reads one PDF and says what it contains. It reads; it never decides (rules.ts decides). */
export interface DocReader {
  read(pdfPath: string): Promise<Extraction>;
}

const INSTRUCTIONS = `You read one Chilean real-estate certificate (a PDF) for a title review.
Rules:
1. Decide doc_type from the document's own title: certificado_dominio (Certificado de dominio vigente), certificado_gravamenes (Certificado de hipotecas y gravamenes, prohibiciones, interdicciones), certificado_contribuciones (Certificado de deuda de contribuciones), certificado_gastos_comunes (Certificado de gastos comunes).
2. Return only fields from this list for that type, and only ones the document actually states:
${DOC_TYPES.map((t) => `   ${t}: ${KEYS[t].join(", ")}`).join("\n")}
3. "value" is the value exactly as written. "quote" is the line or phrase it came from, copied word for word. "page" is the page number (starting at 1).
4. For certificado_gravamenes: one "gravamen" field per registered encumbrance (hipoteca, prohibicion, embargo, litigio, servidumbre, usufructo...). If the document says there are none, return one "sin_gravamenes" field instead.
5. For debts, "deuda" is the amount or the statement that there is none, as written.
6. Never guess, never complete, never normalize. If a field is not in the document, leave it out.
Reply as JSON matching the schema.`;

export class MuseDocReader implements DocReader {
  private readonly client: MetaClient;

  constructor(client: MetaClient) {
    this.client = client;
  }

  async read(pdfPath: string): Promise<Extraction> {
    const fileId = await this.client.uploadFile(pdfPath);
    try {
      const r = await this.client.respond({
        model: "muse-spark-1.3",
        instructions: INSTRUCTIONS,
        input: [
          {
            type: "message",
            role: "user",
            content: [
              { type: "input_text", text: "Read this certificate." },
              { type: "input_file", file_id: fileId },
            ],
          },
        ],
        jsonSchema: {
          name: "certificate_fields",
          schema: z.toJSONSchema(ExtractionSchema) as Record<string, unknown>,
        },
        maxOutputTokens: 3000,
        reasoningEffort: "low",
        estInputTokens: 6000,
        label: "read-certificate",
      });
      return ExtractionSchema.parse(JSON.parse(r.text));
    } finally {
      await this.client.deleteFile(fileId).catch(() => {});
    }
  }
}
