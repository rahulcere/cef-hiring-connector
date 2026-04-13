import { NextResponse } from "next/server";
import { ClientSdk, ClientContext, JsonSigner } from "@cef-ai/client-sdk";

export const dynamic = "force-dynamic";

export async function GET() {
  const steps: Record<string, unknown> = {};

  try {
    const walletJson = JSON.parse(process.env.CEF_WALLET_JSON || "{}");
    steps.walletParsed = { address: walletJson.address, hasEncoded: !!walletJson.encoded };

    const signer = new JsonSigner(walletJson, {
      passphrase: process.env.CEF_WALLET_PASSPHRASE,
    });
    await signer.isReady();
    (signer as any).signRawBytes = (bytes: Uint8Array) => signer.sign(bytes);
    steps.signerReady = { publicKey: signer.publicKey };

    const context = new ClientContext({
      agentService: process.env.CEF_AS_PUBKEY!,
      workspace: process.env.CEF_WORKSPACE_ID!,
      stream: process.env.CEF_STREAM_ID!,
    });
    steps.contextCreated = true;

    const client = new ClientSdk({
      url: process.env.CEF_ORCHESTRATOR_URL!,
      garUrl: process.env.CEF_GAR_URL!,
      eventRuntimeUrl: "https://events.compute.test.ddcdragon.com",
      context,
      wallet: signer,
    });
    steps.clientCreated = true;

    try {
      const agreement = await client.agreement.create(process.env.CEF_AS_PUBKEY!, {
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
      steps.agreementResult = agreement;
    } catch (err: any) {
      steps.agreementError = { message: err.message, name: err.name, stack: err.stack?.split("\n").slice(0, 5) };
    }

    try {
      const testEvent = await client.event.create("USER_CONVERSATION", {
        event_type: "HEALTH_CHECK",
        test: true,
      });
      steps.eventResult = testEvent;
    } catch (err: any) {
      steps.eventError = { message: err.message, name: err.name };
    }

    return NextResponse.json({ ok: true, steps });
  } catch (err: any) {
    return NextResponse.json({ ok: false, steps, error: err.message, stack: err.stack?.split("\n").slice(0, 5) });
  }
}
