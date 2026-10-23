import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const productionAppUrl = "https://taillor2.vercel.app";

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

  let billingSessionId: string;
  try {
    billingSessionId = (await request.json())?.billing_session_id;
  } catch {
    return jsonResponse({ error: "Requête invalide." }, 400);
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(billingSessionId)) {
    return jsonResponse({ error: "Session de paiement invalide." }, 400);
  }

  const { data: workshop } = await admin.from("workshops").select("id").eq("owner_id", user.id).maybeSingle();
  if (!workshop) return jsonResponse({ error: "Atelier introuvable." }, 404);
  const { data: billing, error: billingError } = await admin
    .from("billing_sessions")
    .select("id, status, provider_checkout_id")
    .eq("id", billingSessionId)
    .eq("workshop_id", workshop.id)
    .maybeSingle();
  if (billingError || !billing) return jsonResponse({ error: "Session de paiement introuvable." }, 404);
  if (billing.status === "paid") return jsonResponse({ status: "paid" });
  if (billing.status === "failed") return jsonResponse({ status: "failed" });
  if (!billing.provider_checkout_id) return jsonResponse({ error: "La session SasPay n’est pas prête." }, 409);

  let statusResponse: Response;
  try {
    statusResponse = await fetch(
      `https://api.saspay.me/api/v1/checkout-sessions/${billing.provider_checkout_id}/status/`,
      { headers: { Authorization: `Bearer ${apiKey}` } },
    );
  } catch {
    return jsonResponse({ error: "Impossible de vérifier le paiement auprès de SasPay." }, 502);
  }

  const payload = await statusResponse.json().catch(() => null);
  if (!statusResponse.ok || payload?.success !== true) {
    return jsonResponse({ error: "SasPay n’a pas pu vérifier le statut du paiement." }, 502);
  }
  const status = payload?.data?.transaction_status ?? payload?.data?.status;
  if (status === "FAILED" || status === "CANCELLED") {
    const { error: updateError } = await admin.from("billing_sessions")
      .update({ status: "failed" }).eq("id", billing.id).eq("status", "pending");
    if (updateError) return jsonResponse({ error: "Le paiement a échoué mais le statut n’a pas pu être enregistré." }, 500);
    return jsonResponse({ status: "failed" });
  }
  if (status !== "SUCCESS" && status !== "PAID") return jsonResponse({ status: "pending" });

  const { data: result, error: activateError } = await admin.rpc("activate_saspay_subscription", {
    p_billing_session_id: billing.id,
  });
  if (activateError) return jsonResponse({ error: "Paiement confirmé, mais l’activation a échoué. Contactez l’assistance sans repayer." }, 500);
  return jsonResponse({ status: result });
});
