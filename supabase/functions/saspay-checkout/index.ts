import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const productionAppUrl = "https://taillor2.vercel.app";
const configuredAppUrl = Deno.env.get("APP_BASE_URL");
const appBaseUrl = (() => {
  if (!configuredAppUrl) return productionAppUrl;
  try {
    const url = new URL(configuredAppUrl);
    if (url.protocol !== "https:" || url.pathname !== "/" || url.search || url.hash) return productionAppUrl;
    return url.origin;
  } catch {
    return productionAppUrl;
  }
})();

const corsHeaders = {
  "Access-Control-Allow-Origin": productionAppUrl,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return jsonResponse({ error: "Méthode non autorisée." }, 405);

  const authorization = request.headers.get("Authorization");
  const apiKey = Deno.env.get("SASPAY_API_KEY");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!authorization || !apiKey || !supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: "Le service de paiement n’est pas encore configuré." }, 503);
  }

  const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const { data: { user }, error: authError } = await userClient.auth.getUser();
  if (authError || !user) return jsonResponse({ error: "Connexion requise." }, 401);

  let plan: string;
  try {
    const body = await request.json();
    plan = body?.plan;
  } catch {
    return jsonResponse({ error: "Requête invalide." }, 400);
  }

  const prices: Record<string, number> = { pro: 3000, premium: 6000 };
  if (!(plan in prices)) return jsonResponse({ error: "Formule sélectionnée invalide." }, 400);

  const { data: workshop, error: workshopError } = await admin
    .from("workshops").select("id, plan").eq("owner_id", user.id).single();
  if (workshopError || !workshop) return jsonResponse({ error: "Atelier introuvable." }, 404);
  if (workshop.plan === plan) return jsonResponse({ error: "Cette formule est déjà active." }, 409);

  const { data: pendingBilling, error: pendingError } = await admin
    .from("billing_sessions")
    .select("id, plan, checkout_url, provider_checkout_id")
    .eq("workshop_id", workshop.id)
    .eq("status", "pending")
    .maybeSingle();
  if (pendingError) return jsonResponse({ error: "Impossible de vérifier les paiements en cours." }, 500);
  if (pendingBilling) {
    if (!pendingBilling.provider_checkout_id) {
      return jsonResponse({ error: "Une session de paiement est encore en préparation. Réessayez dans quelques instants." }, 409);
    }

    let statusResponse: Response;
    try {
      statusResponse = await fetch(
        `https://api.saspay.me/api/v1/checkout-sessions/${pendingBilling.provider_checkout_id}/status/`,
        { headers: { Authorization: `****** } },
      );
    } catch {
      return jsonResponse({ error: "Impossible de vérifier la session de paiement auprès de SasPay. Réessayez." }, 502);
    }

    const statusPayload = await statusResponse.json().catch(() => null);
    if (!statusResponse.ok || statusPayload?.success !== true) {
      return jsonResponse({ error: "SasPay n’a pas pu vérifier la session de paiement en cours." }, 502);
    }

    const pendingStatus = String(statusPayload?.data?.transaction_status ?? statusPayload?.data?.status ?? "").toUpperCase();
    if (pendingStatus === "SUCCESS" || pendingStatus === "PAID") {
      const { data: activationResult, error: activationError } = await admin.rpc("activate_saspay_subscription", {
        p_billing_session_id: pendingBilling.id,
      });
      if (activationError) {
        return jsonResponse({ error: "Paiement confirmé, mais l’activation a échoué. Contactez l’assistance sans repayer." }, 500);
      }
      return jsonResponse({ status: activationResult });
    }

    if (pendingStatus === "FAILED" || pendingStatus === "CANCELLED" || pendingStatus === "CANCELED") {
      const { error: updateError } = await admin
        .from("billing_sessions")
        .update({ status: "failed" })
        .eq("id", pendingBilling.id)
        .eq("status", "pending");
      if (updateError) {
        return jsonResponse({ error: "La session annulée n’a pas pu être clôturée. Réessayez dans quelques instants." }, 500);
      }
    } else if (pendingBilling.plan === plan && pendingBilling.checkout_url) {
      return jsonResponse({ checkout_url: pendingBilling.checkout_url });
    } else {
      return jsonResponse({ error: "Un paiement est déjà en cours. Terminez ou annulez cette session avant de choisir une autre formule." }, 409);
    }
  }

  const { data: profile } = await admin.from("profiles").select("full_name").eq("id", user.id).maybeSingle();
  const { data: billing, error: billingError } = await admin.from("billing_sessions").insert({
    workshop_id: workshop.id,
    plan,
    amount: prices[plan],
  }).select("id").single();
  if (billingError?.code === "23505") {
    return jsonResponse({ error: "Un paiement vient d’être démarré. Réessayez dans quelques instants." }, 409);
  }
  if (billingError || !billing) return jsonResponse({ error: "Impossible de préparer le paiement." }, 500);

  let providerResponse: Response;
  try {
    providerResponse = await fetch("https://api.saspay.me/api/v1/checkout-sessions/", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: prices[plan].toFixed(2),
        currency: "XOF",
        description: `Abonnement TailorPro ${plan === "pro" ? "Pro" : "Premium"} - 1 mois`,
        customer_email: user.email,
        customer_name: profile?.full_name || user.email,
        return_url: `${appBaseUrl}/app/subscription?billing_session=${billing.id}`,
        metadata: { billing_session_id: billing.id, plan },
      }),
    });
  } catch {
    await admin.from("billing_sessions").delete().eq("id", billing.id);
    return jsonResponse({ error: "SasPay est momentanément inaccessible. Réessayez." }, 502);
  }

  const payload = await providerResponse.json().catch(() => null);
  const checkout = payload?.data;
  if (!providerResponse.ok || payload?.success !== true || !checkout?.id || !checkout?.checkout_url) {
    await admin.from("billing_sessions").delete().eq("id", billing.id);
    return jsonResponse({ error: "SasPay n’a pas pu créer la page de paiement. Vérifiez la clé et le compte marchand." }, 502);
  }

  const { error: updateError } = await admin.from("billing_sessions").update({
    provider_checkout_id: checkout.id,
    checkout_url: checkout.checkout_url,
  }).eq("id", billing.id);
  if (updateError) {
    await admin.from("billing_sessions").delete().eq("id", billing.id);
    return jsonResponse({ error: "La page de paiement a été créée mais n’a pas pu être enregistrée. Réessayez avant d’effectuer un paiement." }, 500);
  }

  return jsonResponse({ checkout_url: checkout.checkout_url });
});
