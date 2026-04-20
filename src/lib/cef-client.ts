import {
  ClientSdk,
  ClientContext,
  JsonSigner,
  UriSigner,
} from "@cef-ai/client-sdk";
import type { GarSignerCapable, SignedWallet } from "@cef-ai/client-sdk";

let clientPromise: Promise<ClientSdk> | null = null;

/** Match @cef-ai/client-sdk v0.0.12 orchestrator + sidecar URLs (test defaults). */
const DEFAULT_TEST_ENDPOINTS = {
  eventRuntimeUrl: "https://events.compute.test.ddcdragon.com",
  agentRuntimeUrl: "https://agent.compute.test.ddcdragon.com",
  sisUrl: "https://sis.compute.test.ddcdragon.com",
  webTransportUrl: "https://sis-0.compute.test.ddcdragon.com:4433",
} as const;

function trimUrl(u: string) {
  return u.replace(/\/$/, "");
}

function normalizeGarUrl(g: string) {
  return g.endsWith("/") ? g : `${g}/`;
}

function resolveSdkConfig() {
  const url =
    process.env.CEF_ORCHESTRATOR_URL || process.env.BASE_URL || "";
  const garUrl = process.env.CEF_GAR_URL || process.env.GAR_URL || "";
  if (!url || !garUrl) {
    throw new Error(
      "Set CEF_ORCHESTRATOR_URL (or BASE_URL) and CEF_GAR_URL for ClientSdk",
    );
  }
  return {
    url: trimUrl(url),
    garUrl: normalizeGarUrl(garUrl),
    eventRuntimeUrl:
      process.env.CEF_EVENT_RUNTIME_URL ||
      process.env.EVENT_URL ||
      DEFAULT_TEST_ENDPOINTS.eventRuntimeUrl,
    agentRuntimeUrl:
      process.env.CEF_AGENT_RUNTIME_URL ||
      process.env.AGENT_RUNTIME_URL ||
      DEFAULT_TEST_ENDPOINTS.agentRuntimeUrl,
    sisUrl:
      process.env.CEF_SIS_URL ||
      process.env.SIS_URL ||
      DEFAULT_TEST_ENDPOINTS.sisUrl,
    webTransportUrl:
      process.env.CEF_WEB_TRANSPORT_URL ||
      process.env.WEB_TRANSPORT_URL ||
      DEFAULT_TEST_ENDPOINTS.webTransportUrl,
  };
}

/** GAR agreement flows expect `signRawBytes` (see SDK GarSignerCapable). */
function wrapForGar(signer: SignedWallet): SignedWallet & GarSignerCapable {
  const signBytes = (bytes: Uint8Array) =>
    (signer as { sign: (data: Uint8Array | string) => Promise<`0x${string}`> }).sign(bytes);
  return {
    get publicKey() {
      return signer.publicKey;
    },
    sign: signer.sign.bind(signer),
    signRawBytes: signBytes,
  } as SignedWallet & GarSignerCapable;
}

async function initWallet(): Promise<SignedWallet & GarSignerCapable> {
  const mnemonic = (
    process.env.CEF_WALLET_MNEMONIC ||
    process.env.WALLET_MNEMONIC ||
    ""
  ).trim();
  if (mnemonic) {
    const signer = new UriSigner(mnemonic, { type: "ed25519" });
    await signer.isReady();
    return wrapForGar(signer);
  }
  const walletJson = JSON.parse(process.env.CEF_WALLET_JSON || "{}");
  const signer = new JsonSigner(walletJson, {
    passphrase: process.env.CEF_WALLET_PASSPHRASE,
  });
  await signer.isReady();
  return wrapForGar(signer);
}

export function getCefClient(): Promise<ClientSdk> {
  if (clientPromise) return clientPromise;

  clientPromise = (async () => {
    const wallet = await initWallet();

    const context = new ClientContext({
      agentService:
        process.env.CEF_AS_PUBKEY || process.env.AGENT_SERVICE || "",
      workspace: process.env.CEF_WORKSPACE_ID || process.env.WORKSPACE || "",
      stream: process.env.CEF_STREAM_ID || process.env.STREAM_ID || "",
    });

    if (!context.agent_service || !context.workspace || !context.stream) {
      throw new Error(
        "Set CEF_AS_PUBKEY (or AGENT_SERVICE), CEF_WORKSPACE_ID (or WORKSPACE), CEF_STREAM_ID (or STREAM_ID)",
      );
    }

    const client = new ClientSdk({
      ...resolveSdkConfig(),
      context,
      wallet,
    });

    try {
      await client.agreement.create(
        context.agent_service,
        {
          metadata: {
            scopes: [
              {
                context: {
                  workspace_id: context.workspace,
                  stream_id: context.stream,
                },
              },
            ],
          },
        },
        86400,
      );
    } catch {
      // Agreement may already exist
    }

    return client;
  })();

  return clientPromise;
}

/** For tests or after env rotation */
export function resetCefClientCache() {
  clientPromise = null;
}
