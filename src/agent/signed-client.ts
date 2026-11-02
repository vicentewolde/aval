import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { signRequest } from "../gateway/identity.ts";

/**
 * An MCP client for a buyer's agent. With an identity, every request is signed (Ed25519) over the
 * tool name and the exact body, so the gateway knows which operator is asking. Without one, the
 * agent is anonymous: it can read verified facts but not request visits.
 */
export async function connectAgent(
  url: string,
  identity?: { agentId: string; privateKeyPem: string },
): Promise<Client> {
  const signingFetch: typeof fetch = async (input, init) => {
    const body = typeof init?.body === "string" ? init.body : "";
    if (identity && body) {
      const rpc = JSON.parse(body) as { method?: string; params?: { name?: string } };
      const tool = rpc.method === "tools/call" ? (rpc.params?.name ?? "") : (rpc.method ?? "");
      const headers = new Headers(init?.headers);
      for (const [k, v] of Object.entries(
        signRequest(identity.privateKeyPem, identity.agentId, tool, body),
      ))
        headers.set(k, v);
      return fetch(input, { ...init, headers });
    }
    return fetch(input, init);
  };
  const client = new Client({ name: identity?.agentId ?? "anonymous-agent", version: "1" });
  await client.connect(new StreamableHTTPClientTransport(new URL(url), { fetch: signingFetch }));
  return client;
}
