import { ClientSdk, ClientContext, JsonSigner } from "@cef-ai/client-sdk";

let clientPromise: Promise<ClientSdk> | null = null;

export function getCefClient(): Promise<ClientSdk> {
  if (clientPromise) return clientPromise;

  clientPromise = (async () => {
    const walletJson = JSON.parse(process.env.CEF_WALLET_JSON || "{}");
    const signer = new JsonSigner(walletJson, {
      passphrase: process.env.CEF_WALLET_PASSPHRASE,
    });
    await signer.isReady();

    (signer as any).signRawBytes = (bytes: Uint8Array) => signer.sign(bytes);

    const context = new ClientContext({
      agentService: process.env.CEF_AS_PUBKEY!,
      workspace: process.env.CEF_WORKSPACE_ID!,
      stream: process.env.CEF_STREAM_ID!,
    });

    const client = new ClientSdk({
      url: process.env.CEF_ORCHESTRATOR_URL!,
      garUrl: process.env.CEF_GAR_URL!,
      eventRuntimeUrl: "https://events.compute.test.ddcdragon.com",
      context,
      wallet: signer,
    });

    try {
      await client.agreement.create(process.env.CEF_AS_PUBKEY!, {
        metadata: {
          scopes: [
            {
              context: {
                workspace_id: process.env.CEF_WORKSPACE_ID!,
                stream_id: process.env.CEF_STREAM_ID!,
              },
            },
          ],
        },
      }, 86400);
    } catch {
      // Agreement may already exist — that's fine
    }

    return client;
  })();

  return clientPromise;
}
