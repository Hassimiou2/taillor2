import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { createClient } from "@supabase/supabase-js";
import "./app.css";

const root = document.createElement("div");
root.id = "app-root";
document.body.append(root);

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

const statusLabels = {
  new: "Nouvelle",
  in_progress: "En confection",
  fitting: "En essayage",
  completed: "Terminée",
  delivered: "Livrée",
  cancelled: "Annulée",
};
const planLabels = { free: "Gratuit", pro: "Pro", premium: "Premium" };
const paymentLabels = { cash: "Espèces", mobile_money: "Mobile Money", bank_transfer: "Virement", other: "Autre" };
const navItems = [
  ["dashboard", "Vue d'ensemble", "⌂"],
  ["clients", "Clients", "♧"],
  ["measurements", "Mesures", "▱"],
  ["orders", "Commandes", "✂"],
  ["models", "Modèles", "◇"],
  ["calendar", "Calendrier", "▦"],
  ["payments", "Paiements", "₣"],
  ["reports", "Rapports", "▥"],
  ["subscription", "Abonnement", "☆"],
  ["settings", "Paramètres", "⚙"],
];
const numberFormat = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
const money = (value) => `${numberFormat.format(Number(value || 0))} FCFA`;
const dateFormat = (value, options = { day: "numeric", month: "short", year: "numeric" }) =>
  value ? new Intl.DateTimeFormat("fr-FR", options).format(new Date(`${value.slice(0, 10)}T12:00:00`)) : "Non définie";
const monthKey = new Date().toISOString().slice(0, 7);
const getRoute = () => window.location.pathname.replace(/\/+$/, "") || "/";

function navigate(path) {
  window.history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
  window.scrollTo(0, 0);
}

function CustomMeasurements() {
  const [rows, setRows] = useState([0]);
  return <div className="custom-measurements">
    <div className="form-section-title"><strong>Mesures personnalisées</strong><button type="button" className="text-button" onClick={() => setRows((current) => [...current, current.length])}>+ Ajouter</button></div>
    {rows.map((row) => <div className="custom-measure-row" key={row}><Field label="Nom" name="custom_measurement_name" placeholder="Ex. Poignet" /><Field label="Valeur (cm)" name="custom_measurement_value" type="number" min="0.1" step="0.1" /></div>)}
  </div>;
}

function AppLink({ to, children, className = "", ...props }) {
  return <a href={to} className={className} onClick={(event) => {
    if (to !== "/" && !event.metaKey && !event.ctrlKey && !event.shiftKey && event.button === 0) {
      event.preventDefault();
      navigate(to);
    }
  }} {...props}>{children}</a>;
}

function App() {
  const [route, setRoute] = useState(getRoute);
  const [session, setSession] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [workspaceData, setWorkspaceData] = useState(null);
  const [loadingData, setLoadingData] = useState(false);
  const [dataError, setDataError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const updateRoute = () => setRoute(getRoute());
    window.addEventListener("popstate", updateRoute);
    return () => window.removeEventListener("popstate", updateRoute);
  }, []);

  useEffect(() => {
    if (!supabase) {
      setAuthReady(true);
      return undefined;
    }
    let active = true;
    supabase.auth.getSession().then(({ data, error }) => {
      if (!active) return;
      if (error) setDataError(error.message);
      setSession(data.session);
      setAuthReady(true);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setWorkspaceData(null);
      setDataError("");
    });
    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!authReady) return;
    const isPrivate = route.startsWith("/app");
    const isAuth = ["/login", "/register", "/reset-password"].includes(route);
    if (isPrivate && !session) navigate("/login");
    if (isAuth && route !== "/reset-password" && route !== "/register" && session) navigate("/app");
  }, [route, session, authReady]);

  useEffect(() => {
    if (!session || !supabase) {
      setWorkspaceData(null);
      return;
    }
    let active = true;
    async function load() {
      setLoadingData(true);
      setDataError("");
      try {
        const [workshopResult, profileResult] = await Promise.all([
          supabase.from("workshops").select("*").single(),
          supabase.from("profiles").select("*").single(),
        ]);
        if (workshopResult.error) throw workshopResult.error;
        if (profileResult.error) throw profileResult.error;
        const workshop = workshopResult.data;
        const queries = await Promise.all([
          supabase.from("clients").select("*").eq("workshop_id", workshop.id).order("full_name").limit(1000),
          supabase.from("measurements").select("*").eq("workshop_id", workshop.id).order("measured_on", { ascending: false }).limit(1000),
          supabase.from("garment_models").select("*").eq("workshop_id", workshop.id).order("name").limit(1000),
          supabase.from("orders").select("*, clients(full_name, phone), order_items(*)").eq("workshop_id", workshop.id).order("created_at", { ascending: false }).limit(1000),
          supabase.from("payments").select("*, orders(reference, client_id, clients(full_name))").eq("workshop_id", workshop.id).order("paid_at", { ascending: false }).limit(1000),
          supabase.from("subscriptions").select("*").eq("workshop_id", workshop.id).maybeSingle(),
        ]);
        const result = queries.find((query) => query.error);
        if (result?.error) throw result.error;
        if (active) setWorkspaceData({
          workshop,
          profile: profileResult.data,
          clients: queries[0].data,
          measurements: queries[1].data,
          models: queries[2].data,
          orders: queries[3].data,
          payments: queries[4].data,
          subscription: queries[5].data,
        });
      } catch (error) {
        if (active) setDataError(error.message || "Impossible de charger les données de votre atelier.");
      } finally {
        if (active) setLoadingData(false);
      }
    }
    load();
    return () => { active = false; };
  }, [session, refreshKey]);

  const refresh = () => setRefreshKey((value) => value + 1);

  if (!supabase) return <SetupPage />;
  if (!authReady) return <FullScreenMessage title="Chargement de TailorPro…" />;
  if (["/login", "/register", "/reset-password"].includes(route)) return <AuthPage route={route} session={session} />;
  if (!route.startsWith("/app")) return <NotFoundPage />;
  if (!session) return <FullScreenMessage title="Redirection vers la connexion…" />;

  const activePage = route.split("/")[2] || "dashboard";
  return (
    <AppShell route={activePage} session={session} workshop={workspaceData?.workshop} profile={workspaceData?.profile}>
      {loadingData && !workspaceData ? <FullScreenMessage title="Chargement de votre atelier…" /> :
        dataError ? <ErrorPanel message={dataError} onRetry={refresh} /> :
          !workspaceData ? <FullScreenMessage title="Préparation de votre espace…" /> :
            <WorkspacePage page={activePage} data={workspaceData} refresh={refresh} user={session.user} />}
    </AppShell>
  );
}

function Brand({ light = false }) {
  return <span className={`tp-brand ${light ? "light" : ""}`}><span className="tp-brand-mark">✂</span>TAILOR<span>PRO</span></span>;
}

function SetupPage() {
  return <main className="setup-screen">
    <section className="setup-card">
      <Brand />
      <span className="app-eyebrow">CONFIGURATION REQUISE</span>
      <h1>Connectez votre projet Supabase</h1>
      <p>L’authentification et les données ne sont pas activées tant que les variables de configuration et la migration SQL ne sont pas installées.</p>
      <ol>
        <li>Créez un projet Supabase.</li>
        <li>Copiez <code>.env.example</code> vers <code>.env</code> et renseignez l’URL du projet et sa clé publique anon.</li>
        <li>Appliquez <code>supabase/migrations/202610150001_initial_schema.sql</code> au projet.</li>
        <li>Configurez les URL de redirection Auth pour <code>/app</code>.</li>
      </ol>
      <AppLink className="tp-button primary" to="/">Retour à la page d’accueil</AppLink>
      <p className="setup-warning">N’ajoutez jamais une clé service_role à l’application web.</p>
    </section>
  </main>;
}

function FullScreenMessage({ title }) {
  return <div className="tp-loading"><span className="tp-spinner" />{title}</div>;
}

function AuthPage({ route, session }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [recoverySession, setRecoverySession] = useState(false);
  const isRegister = route === "/register";
  const isReset = route === "/reset-password";
  const hasExistingSession = isRegister && Boolean(session);
  const plan = new URLSearchParams(window.location.search).get("plan");

  useEffect(() => {
    if (isReset) {
      supabase.auth.getSession().then(({ data }) => setRecoverySession(Boolean(data.session)));
      const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
        if (event === "PASSWORD_RECOVERY" || session) setRecoverySession(true);
      });
      return () => listener.subscription.unsubscribe();
    }
    return undefined;
  }, [isReset]);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    const values = new FormData(event.currentTarget);
    const email = String(values.get("email") || "").trim();
    const password = String(values.get("password") || "");
    try {
      if (isReset) {
        if (recoverySession) {
          const { error: authError } = await supabase.auth.updateUser({ password });
          if (authError) throw authError;
          setMessage("Votre mot de passe a été mis à jour. Vous pouvez vous connecter.");
          navigate("/login");
          return;
        }
        const { error: authError } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/reset-password` });
        if (authError) throw authError;
        setMessage("Si cette adresse correspond à un compte, un lien de réinitialisation va être envoyé.");
      } else if (isRegister) {
        const { data, error: authError } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { full_name: String(values.get("full_name") || "").trim(), workshop_name: String(values.get("workshop_name") || "").trim() },
            emailRedirectTo: `${window.location.origin}/app`,
          },
        });
        if (authError) throw authError;
        setMessage(data.session ? "Votre espace a été créé. Vous pouvez commencer." : "Compte créé. Consultez votre boîte e-mail pour confirmer l’adresse avant de vous connecter.");
        if (data.session) navigate("/app");
      } else {
        const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
        if (authError) throw authError;
        navigate("/app");
      }
    } catch (authError) {
      setError(authError.message || "L’opération n’a pas abouti. Vérifiez les informations et réessayez.");
    } finally {
      setBusy(false);
    }
  }

  async function signOutToRegister() {
    setBusy(true);
    setError("");
    try {
      const { error: authError } = await supabase.auth.signOut();
      if (authError) throw authError;
    } catch (authError) {
      setError(authError.message || "La déconnexion a échoué. Réessayez.");
    } finally {
      setBusy(false);
    }
  }

  return <main className="auth-screen">
    <AppLink className="auth-back" to="/">← Retour à TailorPro</AppLink>
    <section className="auth-card">
      <Brand />
      <span className="app-eyebrow">{isRegister ? "VOTRE ATELIER, BIEN ORGANISÉ" : isReset ? "RÉCUPÉRATION DU COMPTE" : "RAVI DE VOUS REVOIR"}</span>
      <h1>{isRegister ? "Créez votre espace" : isReset ? recoverySession ? "Choisissez un nouveau mot de passe" : "Réinitialisez votre mot de passe" : "Connectez-vous"}</h1>
      <p>{hasExistingSession ? "Vous êtes déjà connecté. Déconnectez-vous pour créer un autre compte." : isRegister ? "Quelques informations pour préparer votre atelier TailorPro." : isReset ? recoverySession ? "Choisissez un mot de passe d’au moins 8 caractères." : "Nous vous enverrons un lien de réinitialisation si le compte existe." : "Retrouvez les commandes et les clients de votre atelier."}</p>
      {plan && isRegister && !hasExistingSession && <p className="auth-plan">Formule sélectionnée : {planLabels[plan] || plan}. Le choix n’active aucun paiement.</p>}
      {hasExistingSession ?
        <div className="tp-form">
          <button className="tp-button primary full" type="button" onClick={signOutToRegister} disabled={busy}>{busy ? "Déconnexion…" : "Se déconnecter et continuer"}</button>
          <AppLink className="tp-button secondary full" to="/app">Retourner à mon atelier</AppLink>
        </div> :
        <form onSubmit={submit} className="tp-form">
          {isRegister && <><Field label="Votre nom" name="full_name" required autoComplete="name" /><Field label="Nom de l’atelier" name="workshop_name" required autoComplete="organization" /></>}
          {!recoverySession && <Field label="Adresse e-mail" name="email" type="email" required autoComplete="email" />}
          {(!isReset || recoverySession) && <Field label={recoverySession ? "Nouveau mot de passe" : "Mot de passe"} name="password" type="password" required minLength={8} autoComplete={isRegister || recoverySession ? "new-password" : "current-password"} />}
          <button className="tp-button primary full" disabled={busy}>{busy ? "Veuillez patienter…" : isRegister ? "Créer mon compte" : isReset ? recoverySession ? "Mettre à jour le mot de passe" : "Envoyer le lien" : "Se connecter"}</button>
        </form>}
      {error && <p className="tp-message error" role="alert">{error}</p>}
      {message && <p className="tp-message success" role="status">{message}</p>}
      <div className="auth-switch">
        {!isRegister && !isReset && <AppLink to="/reset-password">Mot de passe oublié ?</AppLink>}
        {!isReset && <span>{isRegister ? "Vous avez déjà un compte ?" : "Pas encore de compte ?"} <AppLink to={isRegister ? "/login" : "/register"}>{isRegister ? "Se connecter" : "Créer un compte"}</AppLink></span>}
        {isReset && <AppLink to="/login">Retour à la connexion</AppLink>}
      </div>
      <p className="auth-legal">Connexion sécurisée par Supabase Auth. Vos données métier restent dans votre espace atelier.</p>
    </section>
  </main>;
}

function AppShell({ route, session, workshop, profile, children }) {
  const [mobileNav, setMobileNav] = useState(false);
  const currentItem = navItems.find(([key]) => key === route) || navItems[0];
  async function signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) window.alert(`La déconnexion a échoué : ${error.message}`);
    else navigate("/login");
  }
  return <div className="app-shell">
    {mobileNav && <button className="mobile-scrim" aria-label="Fermer le menu" onClick={() => setMobileNav(false)} />}
    <aside className={`app-sidebar ${mobileNav ? "open" : ""}`}>
      <div className="app-sidebar-top"><AppLink to="/app" aria-label="Accueil TailorPro"><Brand /></AppLink><button className="sidebar-close" onClick={() => setMobileNav(false)} aria-label="Fermer le menu">×</button></div>
      <div className="workspace-badge"><span className="workspace-avatar">{(workshop?.name || "A").slice(0, 1).toUpperCase()}</span><span><strong>{workshop?.name || "Mon atelier"}</strong><small>Formule {planLabels[workshop?.plan] || "Gratuit"}</small></span></div>
      <p className="sidebar-label">ESPACE DE TRAVAIL</p>
      <nav className="app-nav" aria-label="Navigation de l’application">
        {navItems.map(([key, label, icon]) => <AppLink key={key} to={key === "dashboard" ? "/app" : `/app/${key}`} className={route === key ? "active" : ""} onClick={() => setMobileNav(false)}><span className="nav-icon" aria-hidden="true">{icon}</span>{label}</AppLink>)}
      </nav>
      <div className="sidebar-profile"><span className="profile-initials">{(profile?.full_name || session.user.email || "TP").slice(0, 2).toUpperCase()}</span><span><strong>{profile?.full_name || session.user.email}</strong><small>{session.user.email}</small></span><button title="Se déconnecter" onClick={signOut}>↪</button></div>
    </aside>
    <section className="app-main">
      <header className="app-topbar">
        <button className="mobile-menu" onClick={() => setMobileNav(true)} aria-label="Ouvrir la navigation">☰</button>
        <div className="topbar-title"><span>{workshop?.name || "Mon atelier"}</span><small>{currentItem[1]}</small></div>
        <div className="topbar-right"><span className="topbar-plan">{planLabels[workshop?.plan] || "Gratuit"}</span><button className="topbar-logout" onClick={signOut}>Déconnexion</button></div>
      </header>
      <main className="app-content">{children}</main>
    </section>
  </div>;
}

function Field({ label, name, type = "text", required = false, ...props }) {
  return <label className="tp-field">{label}{type === "textarea" ?
    <textarea name={name} required={required} {...props} /> :
    <input name={name} type={type} required={required} {...props} />}</label>;
}

function ErrorPanel({ message, onRetry }) {
  return <div className="tp-error"><strong>Une erreur est survenue</strong><p>{message}</p><button className="tp-button secondary" onClick={onRetry}>Réessayer</button></div>;
}

function PageHeading({ eyebrow, title, description, action }) {
  return <div className="page-heading"><div><span className="app-eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>{action}</div>;
}

function Modal({ title, onClose, children }) {
  useEffect(() => {
    const onKey = (event) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section role="dialog" aria-modal="true" aria-labelledby="modal-title" className="modal-card">
      <header><h2 id="modal-title">{title}</h2><button onClick={onClose} aria-label="Fermer">×</button></header>
      {children}
    </section>
  </div>;
}

function WorkspacePage({ page, data, refresh, user }) {
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const plan = data.workshop.plan;

  async function runAction(action, successText) {
    setBusy(true);
    setNotice("");
    try {
      await action();
      setNotice(successText);
      setModal(null);
      refresh();
    } catch (error) {
      setNotice(error.message || "L’enregistrement a échoué. Aucune réussite n’a été confirmée.");
    } finally {
      setBusy(false);
    }
  }

  const visibleClients = useMemo(() => data.clients.filter((client) => !client.archived_at &&
    `${client.full_name} ${client.phone}`.toLocaleLowerCase("fr").includes(query.toLocaleLowerCase("fr"))), [data.clients, query]);
  const visibleMeasurementClients = useMemo(() => data.clients.filter((client) => !client.archived_at &&
    `${client.full_name} ${client.phone}`.toLocaleLowerCase("fr").includes(query.toLocaleLowerCase("fr"))), [data.clients, query]);
  const visibleOrders = useMemo(() => data.orders.filter((order) => !order.archived_at &&
    (filter === "all" || order.status === filter) &&
    `${order.reference} ${order.clients?.full_name || ""} ${order.order_items?.map((item) => item.garment_name).join(" ") || ""}`.toLocaleLowerCase("fr").includes(query.toLocaleLowerCase("fr"))), [data.orders, filter, query]);
  const activeModels = data.models.filter((model) => !model.archived_at);

  const renderContent = () => {
    switch (page) {
      case "clients": return <ClientsPage data={data} clients={visibleClients} query={query} setQuery={setQuery} onCreate={() => setModal({ type: "client" })} onEdit={(item) => setModal({ type: "client", item })} onArchive={(item) => window.confirm(`Archiver la fiche de ${item.full_name} ? Ses commandes et son historique seront conservés.`) && runAction(() => supabase.from("clients").update({ archived_at: new Date().toISOString() }).eq("id", item.id).eq("workshop_id", data.workshop.id).throwOnError(), "Fiche client archivée.")} />;
      case "measurements": return <MeasurementsPage data={data} clients={visibleMeasurementClients} query={query} setQuery={setQuery} onOpen={(item) => setModal({ type: "measurements", item })} onAddClient={() => navigate("/app/clients")} />;
      case "orders": return <OrdersPage data={data} orders={visibleOrders} query={query} setQuery={setQuery} filter={filter} setFilter={setFilter} onCreate={() => setModal({ type: "order" })} onEdit={(item) => setModal({ type: "order-edit", item })} onPayment={(item) => setModal({ type: "payment", item })} onStatus={(order, status) => runAction(() => supabase.from("orders").update({ status }).eq("id", order.id).eq("workshop_id", data.workshop.id).throwOnError(), "Statut de la commande mis à jour.")} onArchive={(item) => window.confirm(`Archiver la commande #${item.reference} ? L’historique financier sera conservé.`) && runAction(() => supabase.from("orders").update({ archived_at: new Date().toISOString() }).eq("id", item.id).eq("workshop_id", data.workshop.id).throwOnError(), "Commande archivée.")} />;
      case "models": return <ModelsPage models={activeModels} onCreate={() => setModal({ type: "model" })} onEdit={(item) => setModal({ type: "model", item })} onArchive={(item) => window.confirm(`Archiver le modèle « ${item.name} » ?`) && runAction(() => supabase.from("garment_models").update({ archived_at: new Date().toISOString() }).eq("id", item.id).eq("workshop_id", data.workshop.id).throwOnError(), "Modèle archivé.")} />;
      case "calendar": return <CalendarPage orders={data.orders.filter((order) => !order.archived_at)} />;
      case "payments": return <PaymentsPage payments={data.payments} orders={data.orders} onCreate={(item) => setModal({ type: "payment", item })} />;
      case "reports": return <ReportsPage data={data} />;
      case "subscription": return <SubscriptionPage data={data} onChoose={() => setNotice("Le paiement et le changement réel d’offre seront activés après l’intégration d’un prestataire.")} />;
      case "settings": return <SettingsPage data={data} user={user} onSave={(values) => runAction(async () => {
        const { error } = await supabase.rpc("update_my_workshop_settings", values);
        if (error) throw error;
      }, "Paramètres enregistrés.")} />;
      default: return <DashboardPage data={data} onCreateOrder={() => setModal({ type: "order" })} onCreateClient={() => setModal({ type: "client" })} />;
    }
  };

  async function saveForm(event) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const formValue = (name) => String(values.get(name) || "").trim();
    const workshopId = data.workshop.id;
    if (modal.type === "client") {
      const payload = { full_name: formValue("full_name"), phone: formValue("phone"), address: formValue("address") || null, notes: formValue("notes") || null };
      if (!payload.full_name || !payload.phone) return setNotice("Le nom et le téléphone du client sont obligatoires.");
      return runAction(async () => {
        if (modal.item) await supabase.from("clients").update(payload).eq("id", modal.item.id).eq("workshop_id", workshopId).throwOnError();
        else await supabase.from("clients").insert({ ...payload, workshop_id: workshopId }).throwOnError();
      }, modal.item ? "Fiche client modifiée." : "Client enregistré.");
    }
    if (modal.type === "measurements") {
      const numericFields = ["bust", "waist", "hips", "shoulders", "sleeve_length", "garment_length", "neck", "arm", "trouser_length", "thigh", "inseam"];
      const payload = { workshop_id: workshopId, client_id: modal.item.id, measured_on: formValue("measured_on") || new Date().toISOString().slice(0, 10), notes: formValue("notes") || null };
      for (const field of numericFields) {
        const raw = formValue(field);
        if (raw && (!Number.isFinite(Number(raw)) || Number(raw) <= 0)) return setNotice("Les mesures renseignées doivent être des nombres supérieurs à zéro.");
        payload[field] = raw ? Number(raw) : null;
      }
      const customNames = values.getAll("custom_measurement_name").map((value) => String(value).trim());
      const customValues = values.getAll("custom_measurement_value").map((value) => String(value).trim());
      const customMeasurements = {};
      for (let index = 0; index < customNames.length; index += 1) {
        if (!customNames[index] && !customValues[index]) continue;
        if (!customNames[index] || !customValues[index] || !Number.isFinite(Number(customValues[index])) || Number(customValues[index]) <= 0) {
          return setNotice("Chaque mesure personnalisée doit avoir un nom et une valeur positive.");
        }
        customMeasurements[customNames[index]] = Number(customValues[index]);
      }
      payload.custom_measurements = customMeasurements;
      return runAction(() => supabase.from("measurements").insert(payload).throwOnError(), "Nouvelle fiche de mesures enregistrée.");
    }
    if (modal.type === "model") {
      const rawPrice = formValue("indicative_price");
      const payload = { workshop_id: workshopId, name: formValue("name"), category: formValue("category"), description: formValue("description") || null, indicative_price: rawPrice ? Number(rawPrice) : null, notes: formValue("notes") || null };
      if (!payload.name || (rawPrice && (!Number.isFinite(payload.indicative_price) || payload.indicative_price < 0))) return setNotice("Indiquez un nom et un prix indicatif valide.");
      return runAction(async () => {
        if (modal.item) await supabase.from("garment_models").update(payload).eq("id", modal.item.id).eq("workshop_id", workshopId).throwOnError();
        else await supabase.from("garment_models").insert(payload).throwOnError();
      }, modal.item ? "Modèle modifié." : "Modèle enregistré.");
    }
    if (modal.type === "order") {
      const quantities = values.getAll("quantity");
      const names = values.getAll("garment_name");
      const prices = values.getAll("unit_price");
      const modelIds = values.getAll("model_id");
      const items = names.map((name, index) => ({
        garment_name: String(name).trim(),
        quantity: Number(quantities[index]),
        unit_price: Number(prices[index]),
        model_id: String(modelIds[index] || "") || null,
      }));
      if (!formValue("client_id")) return setNotice("Sélectionnez un client pour la commande.");
      if (items.some((item) => !item.garment_name || !Number.isInteger(item.quantity) || item.quantity < 1 || !Number.isFinite(item.unit_price) || item.unit_price < 0)) return setNotice("Vérifiez le nom, la quantité et le prix de chaque article.");
      return runAction(async () => {
        const { error } = await supabase.rpc("create_order_with_items", {
          p_client_id: formValue("client_id"),
          p_order_date: formValue("order_date"),
          p_due_date: formValue("due_date") || null,
          p_fitting_date: formValue("fitting_date") || null,
          p_description: formValue("description") || null,
          p_items: items,
        });
        if (error) throw error;
      }, "Commande enregistrée.");
    }
    if (modal.type === "order-edit") {
      const orderDate = formValue("order_date");
      const dueDate = formValue("due_date") || null;
      const fittingDate = formValue("fitting_date") || null;
      if (dueDate && dueDate < orderDate) return setNotice("La date de livraison ne peut pas précéder la date de commande.");
      if (fittingDate && fittingDate < orderDate) return setNotice("La date d’essayage ne peut pas précéder la date de commande.");
      return runAction(() => supabase.from("orders").update({
        order_date: orderDate,
        due_date: dueDate,
        fitting_date: fittingDate,
        status: formValue("status"),
        description: formValue("description") || null,
      }).eq("id", modal.item.id).eq("workshop_id", workshopId).throwOnError(), "Commande modifiée.");
    }
    if (modal.type === "payment") {
      const amount = Number(formValue("amount"));
      const order = modal.item;
      const paid = data.payments.filter((payment) => payment.order_id === order.id).reduce((sum, payment) => sum + Number(payment.amount), 0);
      const balance = Math.max(0, Number(order.total_amount) - paid);
      if (!Number.isFinite(amount) || amount <= 0) return setNotice("Le montant du paiement doit être supérieur à zéro.");
      if (amount > balance) return setNotice(`Le paiement dépasse le solde restant de ${money(balance)}.`);
      return runAction(() => supabase.from("payments").insert({
        workshop_id: workshopId,
        order_id: order.id,
        amount,
        method: formValue("method"),
        reference: formValue("reference") || null,
        notes: formValue("notes") || null,
        paid_at: `${formValue("paid_at")}T12:00:00.000Z`,
        created_by: user.id,
      }).throwOnError(), "Paiement ajouté à l’historique.");
    }
    return undefined;
  }

  const modalTitle = modal?.type === "client" ? (modal.item ? "Modifier le client" : "Ajouter un client") :
    modal?.type === "measurements" ? `Mensurations · ${modal.item.full_name}` :
      modal?.type === "model" ? (modal.item ? "Modifier le modèle" : "Ajouter un modèle") :
    modal?.type === "order" ? "Nouvelle commande" :
      modal?.type === "order-edit" ? `Modifier la commande #${modal.item.reference}` : "Enregistrer un paiement";

  return <>
    {renderContent()}
    {notice && <div className={`tp-toast ${notice.includes("échoué") || notice.includes("dépasse") || notice.includes("obligatoires") || notice.includes("valid") ? "warning" : ""}`} role="status"><span>{notice}</span><button onClick={() => setNotice("")} aria-label="Fermer le message">×</button></div>}
    {modal && <Modal title={modalTitle} onClose={() => setModal(null)}>
      {modal.type === "measurements" && <MeasurementHistory measurements={data.measurements.filter((measurement) => measurement.client_id === modal.item.id)} />}
      <form className="tp-form modal-form" onSubmit={saveForm}>
        {modal.type === "client" && <>
          <Field label="Nom complet" name="full_name" required defaultValue={modal.item?.full_name || ""} />
          <Field label="Téléphone" name="phone" type="tel" required defaultValue={modal.item?.phone || ""} />
          <Field label="Adresse (facultative)" name="address" defaultValue={modal.item?.address || ""} />
          <Field label="Notes" name="notes" type="textarea" defaultValue={modal.item?.notes || ""} rows="3" />
        </>}
        {modal.type === "measurements" && <>
          <Field label="Date des mesures" name="measured_on" type="date" defaultValue={new Date().toISOString().slice(0, 10)} required />
          <div className="measurement-fields">{[["bust","Tour de poitrine"],["waist","Tour de taille"],["hips","Tour de hanches"],["shoulders","Largeur des épaules"],["sleeve_length","Longueur des manches"],["garment_length","Longueur du vêtement"],["neck","Tour de cou"],["arm","Tour de bras"],["trouser_length","Longueur du pantalon"],["thigh","Tour de cuisse"],["inseam","Entrejambe"]].map(([name,label]) => <Field key={name} label={`${label} (cm)`} name={name} type="number" min="0.1" step="0.1" />)}</div>
          <CustomMeasurements />
          <Field label="Notes complémentaires" name="notes" type="textarea" rows="2" />
          <p className="form-hint">Les nouvelles mesures sont ajoutées à l’historique ; les fiches précédentes restent consultables.</p>
        </>}
        {modal.type === "model" && <>
          <Field label="Nom du modèle" name="name" required defaultValue={modal.item?.name || ""} />
          <label className="tp-field">Catégorie<select name="category" defaultValue={modal.item?.category || "Autre"}>{["Boubou","Bazin","Ensemble traditionnel","Robe","Chemise","Pantalon","Costume","Autre"].map((option) => <option key={option}>{option}</option>)}</select></label>
          <Field label="Prix indicatif (FCFA, facultatif)" name="indicative_price" type="number" min="0" step="1" defaultValue={modal.item?.indicative_price || ""} />
          <Field label="Description" name="description" type="textarea" rows="2" defaultValue={modal.item?.description || ""} />
          <Field label="Notes" name="notes" type="textarea" rows="2" defaultValue={modal.item?.notes || ""} />
        </>}
        {modal.type === "order" && <OrderForm clients={data.clients.filter((client) => !client.archived_at)} models={activeModels} />}
        {modal.type === "order-edit" && <OrderEditForm order={modal.item} />}
        {modal.type === "payment" && <PaymentForm order={modal.item} payments={data.payments} />}
        <div className="modal-actions"><button type="button" className="tp-button secondary" onClick={() => setModal(null)}>Annuler</button><button className="tp-button primary" disabled={busy}>{busy ? "Enregistrement…" : modal.type === "measurements" ? "Ajouter les mesures" : modal.type === "payment" ? "Enregistrer le paiement" : "Enregistrer"}</button></div>
      </form>
    </Modal>}
  </>;
}

function OrderForm({ clients, models }) {
  const [items, setItems] = useState([0]);
  const today = new Date().toISOString().slice(0, 10);
  return <>
    <label className="tp-field">Client<select name="client_id" required defaultValue=""><option value="" disabled>Choisir un client</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.full_name} · {client.phone}</option>)}</select></label>
    <div className="form-grid"><Field label="Date de commande" name="order_date" type="date" defaultValue={today} required /><Field label="Livraison prévue" name="due_date" type="date" min={today} /><Field label="Essayage prévu" name="fitting_date" type="date" min={today} /></div>
    <div className="form-section-title"><strong>Articles</strong><button type="button" className="text-button" onClick={() => setItems((list) => [...list, list.length])}>+ Ajouter un article</button></div>
    {items.map((index) => <div className="order-line" key={index}>
      <Field label="Vêtement / modèle" name="garment_name" required placeholder="Ex. Boubou brodé" />
      <label className="tp-field">Modèle enregistré<select name="model_id" defaultValue=""><option value="">Aucun modèle</option>{models.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}</select></label>
      <Field label="Quantité" name="quantity" type="number" min="1" step="1" defaultValue="1" required />
      <Field label="Prix unitaire (FCFA)" name="unit_price" type="number" min="0" step="1" required />
    </div>)}
    <Field label="Notes de commande" name="description" type="textarea" rows="2" />
  </>;
}

function OrderEditForm({ order }) {
  return <>
    <div className="payment-balance"><span>Client : {order.clients?.full_name}</span><strong>Articles et paiements conservés · Total : {money(order.total_amount)}</strong></div>
    <div className="form-grid">
      <Field label="Date de commande" name="order_date" type="date" required defaultValue={order.order_date} />
      <Field label="Livraison prévue" name="due_date" type="date" defaultValue={order.due_date || ""} />
      <Field label="Essayage prévu" name="fitting_date" type="date" defaultValue={order.fitting_date || ""} />
      <label className="tp-field">Statut<select name="status" defaultValue={order.status}>{Object.entries(statusLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
    </div>
    <Field label="Notes de commande" name="description" type="textarea" rows="3" defaultValue={order.description || ""} />
    <p className="form-hint">Les articles et paiements enregistrés ne sont pas réécrits dans l’historique financier.</p>
  </>;
}

function PaymentForm({ order, payments }) {
  const paid = payments.filter((payment) => payment.order_id === order.id).reduce((sum, payment) => sum + Number(payment.amount), 0);
  const balance = Math.max(0, Number(order.total_amount) - paid);
  return <>
    <div className="payment-balance"><span>Commande #{order.reference} · {order.clients?.full_name}</span><strong>Solde restant : {money(balance)}</strong></div>
    <Field label="Montant reçu (FCFA)" name="amount" type="number" min="1" max={balance} step="1" required />
    <div className="form-grid"><label className="tp-field">Mode de paiement<select name="method" defaultValue="cash">{Object.entries(paymentLabels).map(([value,label]) => <option value={value} key={value}>{label}</option>)}</select></label><Field label="Date de réception" name="paid_at" type="date" defaultValue={new Date().toISOString().slice(0, 10)} required /></div>
    <Field label="Référence (facultative)" name="reference" />
    <Field label="Notes" name="notes" type="textarea" rows="2" />
    <p className="form-hint">Enregistrement comptable uniquement. Aucun encaissement Mobile Money n’est effectué par l’application.</p>
  </>;
}

function ClientsPage({ data, clients, query, setQuery, onCreate, onEdit, onArchive }) {
  return <>
    <PageHeading eyebrow="VOTRE CARNET D’ADRESSES" title="Clients" description="Retrouvez les coordonnées et l’historique de votre clientèle." action={<button className="tp-button primary" onClick={onCreate}>+ Ajouter un client</button>} />
    <div className="toolbar"><label className="search-field"><span>⌕</span><input aria-label="Rechercher un client" placeholder="Rechercher un nom ou un téléphone" value={query} onChange={(event) => setQuery(event.target.value)} /></label><span className="result-count">{clients.length} client{clients.length !== 1 ? "s" : ""}</span></div>
    {clients.length ? <div className="data-table-wrap"><table className="data-table"><thead><tr><th>CLIENT</th><th>TÉLÉPHONE</th><th>COMMANDES</th><th>FICHE CRÉÉE</th><th>ACTIONS</th></tr></thead><tbody>{clients.map((client) => {
      const orders = data.orders.filter((order) => order.client_id === client.id);
      return <tr key={client.id}><td><strong>{client.full_name}</strong>{client.address && <small className="table-sub">{client.address}</small>}</td><td>{client.phone}</td><td>{orders.length}</td><td>{dateFormat(client.created_at)}</td><td><div className="row-actions"><button onClick={() => onEdit(client)}>Modifier</button><button className="danger-text" onClick={() => onArchive(client)}>Archiver</button></div></td></tr>;
    })}</tbody></table></div> : <EmptyState title="Aucun client pour le moment" text={query ? "Aucun résultat ne correspond à votre recherche." : "Ajoutez votre premier client pour conserver ses coordonnées et son historique."} />}
  </>;
}

function MeasurementsPage({ data, clients, query, setQuery, onOpen, onAddClient }) {
  return <>
    <PageHeading eyebrow="CARNET DE MENSURATIONS" title="Mesures" description="Consultez et mettez à jour les fiches de mesures, séparément du carnet de clients." action={<button className="tp-button secondary" onClick={onAddClient}>Voir les clients</button>} />
    <div className="toolbar"><label className="search-field"><span>⌕</span><input aria-label="Rechercher des mesures par client" placeholder="Rechercher un nom ou un téléphone" value={query} onChange={(event) => setQuery(event.target.value)} /></label><span className="result-count">{clients.length} client{clients.length !== 1 ? "s" : ""}</span></div>
    {clients.length ? <div className="data-table-wrap"><table className="data-table"><thead><tr><th>CLIENT</th><th>TÉLÉPHONE</th><th>FICHES DE MESURES</th><th>DERNIÈRE MISE À JOUR</th><th>ACTIONS</th></tr></thead><tbody>{clients.map((client) => {
      const measurements = data.measurements.filter((measurement) => measurement.client_id === client.id);
      return <tr key={client.id}><td><strong>{client.full_name}</strong></td><td>{client.phone}</td><td>{measurements.length}</td><td>{measurements[0] ? dateFormat(measurements[0].measured_on) : "Aucune fiche"}</td><td><div className="row-actions"><button onClick={() => onOpen(client)}>Gérer les mesures</button></div></td></tr>;
    })}</tbody></table></div> : <EmptyState title={query ? "Aucun client trouvé" : "Aucun client à mesurer"} text={query ? "Aucun résultat ne correspond à votre recherche." : "Ajoutez d’abord un client, puis créez sa première fiche de mesures."} action={!query && <button className="tp-button primary" onClick={onAddClient}>Ajouter un client</button>} />}
  </>;
}

function MeasurementHistory({ measurements }) {
  return <div className="measurement-history"><h3>Historique des mesures</h3>{measurements.length ? measurements.map((measurement) => {
    const labels = [["bust","Poitrine"],["waist","Taille"],["hips","Hanches"],["shoulders","Épaules"],["sleeve_length","Manches"],["garment_length","Vêtement"],["neck","Cou"],["arm","Bras"],["trouser_length","Pantalon"],["thigh","Cuisse"],["inseam","Entrejambe"]];
    return <details className="measure-history-item" key={measurement.id}><summary>{dateFormat(measurement.measured_on)} · en cm</summary><div className="measurement-values">{labels.filter(([key]) => measurement[key]).map(([key,label]) => <span key={key}>{label} <b>{measurement[key]} cm</b></span>)}</div>{measurement.notes && <p>{measurement.notes}</p>}</details>;
  }) : <p className="empty-inline">Aucune fiche de mesures enregistrée.</p>}</div>;
}

function OrdersPage({ data, orders, query, setQuery, filter, setFilter, onCreate, onEdit, onPayment, onStatus, onArchive }) {
  const statuses = ["all", ...Object.keys(statusLabels)];
  return <>
    <PageHeading eyebrow="SUIVI DE FABRICATION" title="Commandes" description="Suivez chaque confection, de la prise de commande à la livraison." action={<button className="tp-button primary" onClick={onCreate}>+ Nouvelle commande</button>} />
    <div className="toolbar"><label className="search-field"><span>⌕</span><input aria-label="Rechercher une commande" placeholder="Client, vêtement, numéro…" value={query} onChange={(event) => setQuery(event.target.value)} /></label><label className="filter-select"><span>Statut</span><select value={filter} onChange={(event) => setFilter(event.target.value)}>{statuses.map((status) => <option value={status} key={status}>{status === "all" ? "Tous" : statusLabels[status]}</option>)}</select></label><span className="result-count">{orders.length} commande{orders.length !== 1 ? "s" : ""}</span></div>
    {orders.length ? <div className="data-table-wrap"><table className="data-table"><thead><tr><th>COMMANDE</th><th>CLIENT</th><th>VÊTEMENTS</th><th>LIVRAISON</th><th>TOTAL / SOLDE</th><th>AVANCEMENT</th><th>ACTIONS</th></tr></thead><tbody>{orders.map((order) => {
      const paid = data.payments.filter((payment) => payment.order_id === order.id).reduce((sum, payment) => sum + Number(payment.amount), 0);
      return <tr key={order.id}><td><strong>#{order.reference}</strong><small className="table-sub">{dateFormat(order.order_date)}</small></td><td>{order.clients?.full_name || "Client"}</td><td>{order.order_items?.map((item) => `${item.garment_name} × ${item.quantity}`).join(", ") || "—"}</td><td>{dateFormat(order.due_date)}</td><td><strong>{money(order.total_amount)}</strong><small className="table-sub">Reste {money(Math.max(0, Number(order.total_amount) - paid))}</small></td><td><select className={`status-select status-${order.status}`} aria-label={`Statut commande ${order.reference}`} value={order.status} onChange={(event) => onStatus(order, event.target.value)}>{Object.entries(statusLabels).map(([value,label]) => <option value={value} key={value}>{label}</option>)}</select></td><td><div className="row-actions"><button onClick={() => onEdit(order)}>Modifier</button><button onClick={() => onPayment(order)} disabled={Number(order.total_amount) <= paid}>Paiement</button><button className="danger-text" onClick={() => onArchive(order)}>Archiver</button></div></td></tr>;
    })}</tbody></table></div> : <EmptyState title="Aucune commande à afficher" text={query || filter !== "all" ? "Modifiez votre recherche ou le filtre de statut." : "Créez une commande en sélectionnant un client et ses articles."} />}
    <p className="quota-note">Les limites mensuelles portent sur les commandes nouvellement créées. Le quota est contrôlé par la base de données au moment de la création.</p>
  </>;
}

function ModelsPage({ models, onCreate, onEdit, onArchive }) {
  return <>
    <PageHeading eyebrow="VOTRE CATALOGUE" title="Modèles" description="Gardez vos modèles préférés à portée de main pour préparer les commandes." action={<button className="tp-button primary" onClick={onCreate}>+ Ajouter un modèle</button>} />
    {models.length ? <div className="model-grid">{models.map((model) => <article className="model-card" key={model.id}><div className="model-card-icon">✂</div><span className="app-eyebrow">{model.category}</span><h2>{model.name}</h2><p>{model.description || "Aucune description renseignée."}</p>{model.indicative_price !== null && <strong className="model-price">{money(model.indicative_price)} <small>prix indicatif</small></strong>}<div className="model-actions"><button onClick={() => onEdit(model)}>Modifier</button><button className="danger-text" onClick={() => onArchive(model)}>Archiver</button></div></article>)}</div> : <EmptyState title="Votre catalogue est vide" text="Ajoutez vos modèles pour les retrouver lors de la création d’une commande." action={<button className="tp-button primary" onClick={onCreate}>Ajouter un modèle</button>} />}
  </>;
}

function CalendarPage({ orders }) {
  const today = new Date().toISOString().slice(0, 10);
  const events = orders.filter((order) => order.status !== "cancelled" && order.due_date).sort((a, b) => a.due_date.localeCompare(b.due_date));
  const overdue = events.filter((order) => order.due_date < today && order.status !== "delivered");
  const upcoming = events.filter((order) => order.due_date >= today);
  return <>
    <PageHeading eyebrow="ÉCHÉANCES DE L’ATELIER" title="Calendrier" description="Les essayages et livraisons à venir, avec une liste adaptée au téléphone." />
    <div className="metric-row"><MetricCard label="À livrer aujourd’hui" value={events.filter((order) => order.due_date === today).length} /><MetricCard label="À venir" value={upcoming.length} /><MetricCard label="En retard" value={overdue.length} tone={overdue.length ? "warning" : ""} /></div>
    <div className="section-title"><h2>Prochaines échéances</h2><span>Livraisons et essayages</span></div>
    {[...overdue.map((order) => ({ ...order, isOverdue: true })), ...upcoming].length ? <div className="timeline">{[...overdue.map((order) => ({ ...order, isOverdue: true })), ...upcoming].map((order) => <article key={order.id} className={`timeline-card ${order.isOverdue ? "overdue" : ""}`}><div className="timeline-date"><strong>{dateFormat(order.due_date, { day: "numeric" })}</strong><span>{dateFormat(order.due_date, { month: "short" })}</span></div><div className="timeline-info"><h3>Commande #{order.reference} · {order.clients?.full_name}</h3><p>{order.order_items?.map((item) => item.garment_name).join(", ") || "Confection"} · {statusLabels[order.status]}</p>{order.fitting_date && <small>Essayage : {dateFormat(order.fitting_date)}</small>}</div>{order.isOverdue && <span className="overdue-badge">En retard</span>}</article>)}</div> : <EmptyState title="Aucune livraison planifiée" text="Les commandes avec une date prévue apparaîtront ici." />}
    {!orders.some((order) => order.due_date) && <p className="form-hint">Les commandes sans date de livraison sont conservées et ne sont pas présentées comme des échéances.</p>}
  </>;
}

function PaymentsPage({ payments, orders, onCreate }) {
  const currentMonthPayments = payments.filter((payment) => payment.paid_at.slice(0, 7) === monthKey).reduce((sum, payment) => sum + Number(payment.amount), 0);
  const balances = orders.filter((order) => !order.archived_at && order.status !== "cancelled").reduce((sum, order) => {
    const paid = payments.filter((payment) => payment.order_id === order.id).reduce((total, payment) => total + Number(payment.amount), 0);
    return sum + Math.max(0, Number(order.total_amount) - paid);
  }, 0);
  return <>
    <PageHeading eyebrow="SUIVI DES ENCAISSEMENTS" title="Paiements" description="Consultez les paiements enregistrés et les soldes restant à recevoir." />
    <div className="metric-row"><MetricCard label="Encaissé ce mois" value={money(currentMonthPayments)} /><MetricCard label="À recevoir" value={money(balances)} /><MetricCard label="Paiements enregistrés" value={payments.length} /></div>
    <div className="info-banner">Les modes Mobile Money et virement servent uniquement à qualifier un encaissement déjà reçu. Aucun paiement n’est encaissé par TailorPro.</div>
    {payments.length ? <div className="data-table-wrap"><table className="data-table"><thead><tr><th>DATE</th><th>CLIENT / COMMANDE</th><th>MONTANT</th><th>MODE</th><th>RÉFÉRENCE</th></tr></thead><tbody>{payments.map((payment) => <tr key={payment.id}><td>{dateFormat(payment.paid_at)}</td><td>{payment.orders?.clients?.full_name || "Client"}<small className="table-sub">Commande #{payment.orders?.reference}</small></td><td><strong>{money(payment.amount)}</strong></td><td>{paymentLabels[payment.method] || "Autre"}</td><td>{payment.reference || "—"}</td></tr>)}</tbody></table></div> : <EmptyState title="Aucun paiement enregistré" text="Les paiements ajoutés aux commandes figureront ici." />}
    <div className="section-title"><h2>Commandes avec un solde</h2><span>Un paiement ne peut pas dépasser le solde restant</span></div>
    <div className="balance-list">{orders.filter((order) => !order.archived_at && Number(order.total_amount) > 0).map((order) => {
      const paid = payments.filter((payment) => payment.order_id === order.id).reduce((sum, payment) => sum + Number(payment.amount), 0);
      const balance = Math.max(0, Number(order.total_amount) - paid);
      return balance > 0 ? <div className="balance-row" key={order.id}><span><strong>{order.clients?.full_name} · #{order.reference}</strong><small>{money(order.total_amount)} facturés</small></span><strong>{money(balance)}</strong><button className="tp-button secondary compact" onClick={() => onCreate(order)}>Ajouter un paiement</button></div> : null;
    })}</div>
  </>;
}

function DashboardPage({ data, onCreateOrder, onCreateClient }) {
  const monthOrders = data.orders.filter((order) => order.created_at.slice(0, 7) === monthKey);
  const inProgress = data.orders.filter((order) => ["new", "in_progress", "fitting"].includes(order.status));
  const completed = data.orders.filter((order) => ["completed", "delivered"].includes(order.status));
  const overdue = data.orders.filter((order) => order.due_date && order.due_date < new Date().toISOString().slice(0, 10) && !["delivered", "cancelled"].includes(order.status));
  const revenue = data.payments.filter((payment) => payment.paid_at.slice(0, 7) === monthKey).reduce((sum, payment) => sum + Number(payment.amount), 0);
  const upcoming = data.orders.filter((order) => order.due_date && order.due_date >= new Date().toISOString().slice(0, 10) && !["delivered", "cancelled"].includes(order.status)).sort((a, b) => a.due_date.localeCompare(b.due_date)).slice(0, 5);
  const remaining = data.orders.filter((order) => order.status !== "cancelled").reduce((sum, order) => sum + Math.max(0, Number(order.total_amount) - data.payments.filter((payment) => payment.order_id === order.id).reduce((paid, payment) => paid + Number(payment.amount), 0)), 0);
  return <>
    <PageHeading eyebrow={dateFormat(new Date().toISOString(), { weekday: "long", day: "numeric", month: "long" }).toLocaleUpperCase("fr")} title={`Bonjour${data.profile.full_name ? `, ${data.profile.full_name.split(" ")[0]}` : ""} !`} description="Voici un aperçu de l’activité réelle de votre atelier." action={<div className="heading-actions"><button className="tp-button secondary" onClick={onCreateClient}>+ Client</button><button className="tp-button primary" onClick={onCreateOrder}>+ Commande</button></div>} />
    <div className="dashboard-stats"><MetricCard label="Clients actifs" value={data.clients.filter((client) => !client.archived_at).length} /><MetricCard label="Commandes ce mois" value={monthOrders.length} note={`Formule ${planLabels[data.workshop.plan]}`} /><MetricCard label="En cours" value={inProgress.length} /><MetricCard label="Terminées / livrées" value={completed.length} /><MetricCard label="En retard" value={overdue.length} tone={overdue.length ? "warning" : ""} /><MetricCard label="Recettes encaissées ce mois" value={money(revenue)} tone="green" /><MetricCard label="Soldes à recevoir" value={money(remaining)} /><MetricCard label="Échéances à venir" value={upcoming.length} /></div>
    <div className="dashboard-columns">
      <section className="panel"><div className="section-title"><div><h2>Commandes récentes</h2><p>Les dernières commandes créées</p></div><AppLink to="/app/orders">Toutes les commandes →</AppLink></div>
        {data.orders.filter((order) => !order.archived_at).slice(0, 6).length ? <div className="compact-list">{data.orders.filter((order) => !order.archived_at).slice(0, 6).map((order) => <div className="compact-row" key={order.id}><span className="compact-icon">✂</span><span><strong>#{order.reference} · {order.clients?.full_name}</strong><small>{order.order_items?.map((item) => item.garment_name).join(", ") || "Commande"}</small></span><StatusBadge status={order.status} /><b>{money(order.total_amount)}</b></div>)}</div> : <EmptyState title="Votre atelier est prêt" text="Ajoutez un client, puis enregistrez votre première commande." action={<button className="tp-button primary" onClick={onCreateOrder}>Créer une commande</button>} />}
      </section>
      <section className="panel"><div className="section-title"><div><h2>Prochaines livraisons</h2><p>Les échéances à garder en vue</p></div><AppLink to="/app/calendar">Calendrier →</AppLink></div>
        {upcoming.length ? <div className="upcoming-list">{upcoming.map((order) => <div className="upcoming-row" key={order.id}><span className="upcoming-date"><b>{dateFormat(order.due_date, { day: "numeric" })}</b><small>{dateFormat(order.due_date, { month: "short" })}</small></span><span><strong>{order.clients?.full_name}</strong><small>Commande #{order.reference}</small></span><StatusBadge status={order.status} /></div>)}</div> : <p className="empty-inline">Aucune livraison à venir. Les commandes datées apparaîtront ici.</p>}
      </section>
    </div>
  </>;
}

function MetricCard({ label, value, note, tone = "" }) {
  return <article className={`metric-card ${tone}`}><span>{label}</span><strong>{value}</strong>{note && <small>{note}</small>}</article>;
}

function StatusBadge({ status }) { return <span className={`status-badge status-${status}`}>{statusLabels[status] || status}</span>; }

function EmptyState({ title, text, action }) {
  return <div className="empty-state"><span className="empty-mark">✂</span><h2>{title}</h2><p>{text}</p>{action}</div>;
}

function ReportsPage({ data }) {
  const [months, setMonths] = useState(6);
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months + 1, 1));
  const filteredPayments = data.payments.filter((payment) => new Date(payment.paid_at) >= start);
  const filteredOrders = data.orders.filter((order) => new Date(order.created_at) >= start && !order.archived_at);
  const totalBilled = filteredOrders.filter((order) => order.status !== "cancelled").reduce((sum, order) => sum + Number(order.total_amount), 0);
  const outstanding = filteredOrders.filter((order) => order.status !== "cancelled").reduce((sum, order) => {
    return sum + Math.max(0, Number(order.total_amount) - data.payments.filter((payment) => payment.order_id === order.id).reduce((paid, payment) => paid + Number(payment.amount), 0));
  }, 0);
  const monthsData = Array.from({ length: months }, (_, index) => {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months + 1 + index, 1));
    const key = date.toISOString().slice(0, 7);
    return { key, label: new Intl.DateTimeFormat("fr-FR", { month: "short" }).format(date), amount: filteredPayments.filter((payment) => payment.paid_at.slice(0, 7) === key).reduce((sum, payment) => sum + Number(payment.amount), 0) };
  });
  const max = Math.max(1, ...monthsData.map((month) => month.amount));
  const revenue = filteredPayments.reduce((sum, payment) => sum + Number(payment.amount), 0);
  return <>
    <PageHeading eyebrow="PILOTER VOTRE ACTIVITÉ" title="Rapports" description="Distinguez les montants facturés, les encaissements et les soldes à recevoir." action={<label className="filter-select">Période<select value={months} onChange={(event) => setMonths(Number(event.target.value))}><option value="3">3 derniers mois</option><option value="6">6 derniers mois</option><option value="12">12 derniers mois</option></select></label>} />
    <div className="metric-row"><MetricCard label="Encaissé sur la période" value={money(revenue)} tone="green" /><MetricCard label="Montant des commandes" value={money(totalBilled)} /><MetricCard label="Reste à recevoir" value={money(outstanding)} /><MetricCard label="Commandes créées" value={filteredOrders.length} /></div>
    <div className="dashboard-columns">
      <section className="panel"><div className="section-title"><div><h2>Évolution des recettes</h2><p>Sommes réellement enregistrées comme reçues</p></div></div>
        {revenue > 0 ? <div className="chart" role="img" aria-label="Histogramme des encaissements mensuels">{monthsData.map((month) => <div className="chart-column" key={month.key}><span>{month.amount ? money(month.amount) : ""}</span><div style={{ height: `${Math.max(5, month.amount / max * 100)}%` }} /><small>{month.label}</small></div>)}</div> : <EmptyState title="Pas encore d’encaissement sur la période" text="Les recettes apparaîtront une fois des paiements réels enregistrés." />}
      </section>
      <section className="panel"><div className="section-title"><div><h2>Commandes par statut</h2><p>Sur la période sélectionnée</p></div></div>
        {filteredOrders.length ? <div className="report-status-list">{Object.entries(statusLabels).map(([status,label]) => <div key={status}><span><StatusBadge status={status} />{label}</span><strong>{filteredOrders.filter((order) => order.status === status).length}</strong></div>)}</div> : <p className="empty-inline">Aucune commande sur cette période.</p>}
      </section>
    </div>
    <p className="form-hint">Les recettes représentent les paiements enregistrés. Le montant des commandes n’est pas un bénéfice net : les dépenses et coûts de production ne sont pas suivis.</p>
  </>;
}

function SubscriptionPage({ data, onChoose }) {
  const monthOrders = data.orders.filter((order) => order.created_at.slice(0, 7) === monthKey).length;
  const plans = [
    { key: "free", name: "Gratuit", price: "0", limit: "10 nouvelles commandes / mois", features: ["Gestion des clients", "Carnet de mesures", "Commandes et paiements", "Tableau de bord essentiel"] },
    { key: "pro", name: "Pro", price: "3 000", limit: "Jusqu’à 50 nouvelles commandes / mois", features: ["Tout l’offre Gratuit", "Calendrier et statuts détaillés", "Modèles et rapports mensuels"] },
    { key: "premium", name: "Premium", price: "6 000", limit: "Commandes mensuelles illimitées*", features: ["Tout l’offre Pro", "Rapports avancés", "Assistance prioritaire prévue"] },
  ];
  return <>
    <PageHeading eyebrow="VOTRE FORMULE" title="Abonnement" description="Consultez votre offre et les limites prévues, sans paiement activé." />
    <div className="current-plan"><div><span className="app-eyebrow">FORMULE ACTUELLE</span><h2>{planLabels[data.workshop.plan] || "Gratuit"}</h2><p>{monthOrders} nouvelles commande{monthOrders !== 1 ? "s" : ""} créée{monthOrders !== 1 ? "s" : ""} ce mois-ci.</p></div><span className="plan-current-badge">En cours</span></div>
    <div className="subscription-grid">{plans.map((plan) => <article className={`subscription-card ${data.workshop.plan === plan.key ? "selected" : ""}`} key={plan.key}><span className="app-eyebrow">{data.workshop.plan === plan.key ? "VOTRE OFFRE" : "FORMULE"}</span><h2>{plan.name}</h2><p className="subscription-price">{plan.price}<small> FCFA / mois</small></p><strong className="subscription-limit">{plan.limit}</strong><ul>{plan.features.map((feature) => <li key={feature}>{feature}</li>)}</ul><button className={`tp-button ${data.workshop.plan === plan.key ? "secondary" : "primary"} full`} onClick={onChoose}>{data.workshop.plan === plan.key ? "Offre actuelle" : "Bientôt disponible"}</button></article>)}</div>
    <p className="form-hint">* Dans le respect des conditions d’utilisation. Aucun changement d’offre ni paiement n’est encore activé. Les quotas sont vérifiés par la base lors de la création et les commandes historiques ne sont pas supprimées.</p>
  </>;
}

function SettingsPage({ data, user, onSave }) {
  async function submit(event) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const formValue = (name) => String(values.get(name) || "").trim();
    await onSave({
      p_full_name: formValue("full_name"),
      p_workshop_name: formValue("workshop_name"),
      p_phone: formValue("phone") || null,
      p_address: formValue("address") || null,
    });
  }
  return <>
    <PageHeading eyebrow="VOTRE ESPACE DE TRAVAIL" title="Paramètres" description="Gérez les informations de votre profil et de votre atelier." />
    <div className="settings-layout"><form className="panel settings-form" onSubmit={submit}><div className="section-title"><div><h2>Profil et atelier</h2><p>Les modifications seront enregistrées dans votre espace.</p></div></div><Field label="Nom complet" name="full_name" required defaultValue={data.profile.full_name} /><Field label="Adresse e-mail" name="email" type="email" defaultValue={user.email} disabled /><div className="settings-divider" /><Field label="Nom de l’atelier" name="workshop_name" required defaultValue={data.workshop.name} /><Field label="Téléphone" name="phone" type="tel" defaultValue={data.workshop.phone || ""} /><Field label="Adresse (facultative)" name="address" defaultValue={data.workshop.address || ""} /><label className="tp-field">Devise<select disabled value="XOF" onChange={() => {}}><option value="XOF">FCFA (XOF)</option></select></label><button className="tp-button primary" type="submit">Enregistrer les paramètres</button></form>
      <section className="panel settings-account"><div className="section-title"><div><h2>Sécurité du compte</h2><p>Les accès sont gérés par Supabase Auth.</p></div></div><AppLink className="tp-button secondary full" to="/reset-password">Réinitialiser le mot de passe</AppLink><button className="tp-button danger full" onClick={() => window.alert("La suppression du compte nécessite une procédure sécurisée côté serveur. Contactez l’administrateur de votre projet Supabase.")}>Demander la suppression du compte</button><div className="info-banner">Les données de gestion sont isolées par atelier via les règles Row Level Security de la migration.</div></section></div>
  </>;
}

function NotFoundPage() {
  return <main className="auth-screen"><section className="auth-card"><Brand /><h1>Page introuvable</h1><p>Cette page n’existe pas.</p><AppLink to="/" className="tp-button primary">Retour à l’accueil</AppLink></section></main>;
}

if (getRoute() !== "/" && getRoute() !== "/index.html") {
  document.body.classList.add("app-active");
  createRoot(root).render(<App />);
}
