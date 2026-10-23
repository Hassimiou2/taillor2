import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

function decodeHex(value: string): Uint8Array | null {
  if (!/^[0-9a-f]{64}$/i.test(value)) return null;
  return Uint8Array.from(value.match(/.{2}/g) ?? [], (byte) => Number.parseInt(byte, 16));
}

async function verifySignature(body: Uint8Array, timestamp: string, signature: string, secret: string) {
  if (!/^\d{1,12}$/.test(timestamp)) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp)) > 300) return false;

  const provided = decodeHex(signature);
  if (!provided) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signedBody = new Uint8Array(new TextEncoder().encode(`${timestamp}.`).length + body.length);
  signedBody.set(new TextEncoder().encode(`${timestamp}.`));
  signedBody.set(body, new TextEncoder().encode(`${timestamp}.`).length);
  const expected = new Uint8Array(await crypto.subtle.sign(
    "HMAC",
    key,
    signedBody,
  ));
  if (provided.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) difference |= provided[index] ^ expected[index];
  return difference === 0;
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return jsonResponse({ error: "Méthode non autorisée." }, 405);
  if (Number(request.headers.get("content-length") ?? 0) > 1_000_000) {
    return jsonResponse({ error: "Notification trop volumineuse." }, 413);
  }

  const signingSecret = Deno.env.get("SASPAY_WEBHOOK_SECRET");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!signingSecret || !supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: "Le webhook n’est pas encore configuré." }, 503);
  }

  const rawBytes = new Uint8Array(await request.arrayBuffer());
  if (rawBytes.length > 1_000_000) return jsonResponse({ error: "Notification trop volumineuse." }, 413);
  const rawBody = new TextDecoder("utf-8", { fatal: true }).decode(rawBytes);

  const signature = request.headers.get("X-Webhook-Signature") ?? "";
  const timestamp = request.headers.get("X-Webhook-Timestamp") ?? "";
  const headerEvent = request.headers.get("X-Webhook-Event") ?? "";
  if (!await verifySignature(rawBytes, timestamp, signature, signingSecret)) {
    return jsonResponse({ error: "Signature webhook invalide ou expirée." }, 401);
  }

  let payload: {
    event?: string;
    data?: {
      id?: string;
      reference?: string;
      status?: string;
      amount?: string | number;
      currency?: string;
      metadata?: { billing_session_id?: string };
    };
  };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return jsonResponse({ error: "Corps JSON invalide." }, 400);
  }

  const event = payload.event;
  const transaction = payload.data;
  if (!event || event !== headerEvent) return jsonResponse({ error: "Événement incohérent." }, 400);
  if (!["transaction.success", "transaction.failed", "transaction.cancelled"].includes(event)) {
    return jsonResponse({ received: true, ignored: true });
  }
  if (!transaction?.id || !transaction.reference || transaction.currency !== "XOF") {
    return jsonResponse({ error: "Données de transaction incomplètes." }, 400);
  }

  const amount = Number(transaction.amount);
  if (!Number.isFinite(amount) || amount <= 0) return jsonResponse({ error: "Montant de transaction invalide." }, 400);
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  let query = admin.from("billing_sessions")
    .select("id, amount, provider_checkout_id")
    .eq("status", "pending")
    .eq("amount", amount)
    .not("provider_checkout_id", "is", null);

  const metadataSessionId = transaction.metadata?.billing_session_id;
  if (metadataSessionId) query = query.eq("id", metadataSessionId);
  const { data: candidates, error: candidatesError } = await query.limit(51);
  if (candidatesError) return jsonResponse({ error: "Impossible de retrouver la session d’abonnement." }, 503);
  if (!candidates?.length) return jsonResponse({ received: true, ignored: true });
  if (candidates.length > 50) return jsonResponse({ error: "Trop de paiements en attente pour une vérification sûre." }, 503);

  const apiKey = Deno.env.get("SASPAY_API_KEY");
  if (!apiKey) return jsonResponse({ error: "La vérification SasPay n’est pas configurée." }, 503);

  let matchingBillingId: string | null = null;
  let providerStillPending = false;
  for (const candidate of candidates) {
    const providerCheckoutId = candidate.provider_checkout_id;
    if (!providerCheckoutId) continue;

    let statusResponse: Response;
    try {
      statusResponse = await fetch(
        `https://api.saspay.me/api/v1/checkout-sessions/${providerCheckoutId}/status/`,
        { headers: { Authorization: `Bearer ${apiKey}` } },
      );
    } catch {
      return jsonResponse({ error: "Impossible de vérifier le statut auprès de SasPay." }, 503);
    }

    const statusPayload = await statusResponse.json().catch(() => null);
    if (!statusResponse.ok || statusPayload?.success !== true) {
      return jsonResponse({ error: "SasPay n’a pas pu vérifier la session candidate." }, 503);
    }
    const providerStatus = statusPayload.data?.transaction_status ?? statusPayload.data?.status;
    if (providerStatus === "PENDING") providerStillPending = true;
    if (
      statusPayload.data?.transaction_id === transaction.id &&
      statusPayload.data?.transaction_reference === transaction.reference &&
      (providerStatus === "SUCCESS" || providerStatus === "PAID" ||
        providerStatus === "FAILED" || providerStatus === "CANCELLED")
    ) {
      matchingBillingId = candidate.id;
      break;
    }
  }

  if (!matchingBillingId) {
    if (providerStillPending) return jsonResponse({ error: "La transaction est encore en cours de synchronisation chez SasPay." }, 503);
    return jsonResponse({ received: true, ignored: true });
  }

  if (event === "transaction.success") {
    const { error: activationError } = await admin.rpc("activate_saspay_subscription", {
      p_billing_session_id: matchingBillingId,
    });
    if (activationError) return jsonResponse({ error: "L’activation de l’abonnement a échoué." }, 503);
  } else {
    const { error: updateError } = await admin.from("billing_sessions")
      .update({ status: "failed" })
      .eq("id", matchingBillingId)
      .eq("status", "pending");
    if (updateError) return jsonResponse({ error: "Le statut du paiement n’a pas pu être enregistré." }, 503);
  }

  return jsonResponse({ received: true, processed: true });
});
