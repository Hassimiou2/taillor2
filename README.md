# TailorPro (taillor2)

## Connexion Google

La connexion et l’inscription par Google utilisent Supabase Auth. Dans Supabase, activez Google dans **Authentication > Sign In / Providers**, puis ajoutez `https://taillor2.vercel.app/app` aux URL de redirection autorisées dans **Authentication > URL Configuration**. Pour le développement local, ajoutez aussi `http://localhost:5173/app`.

Dans la console Google Cloud, l’URI de redirection autorisée doit être l’URL de callback Supabase : `https://stfqugqurqiigiviuwbq.supabase.co/auth/v1/callback`. Le nom et l’adresse e-mail du compte Google sont utilisés pour initialiser le profil ; l’atelier est créé sous le nom « Mon atelier » et pourra être renommé dans les paramètres.

## Paiements SasPay (mode test)

Le paiement utilise des fonctions Supabase Edge : `saspay-checkout` crée une session de paiement hébergée, `saspay-confirm` vérifie le statut après le retour du client, et `saspay-webhook` traite les notifications signées SasPay.

Avant le déploiement :

1. Appliquer la migration `supabase/migrations/202610220001_saspay_billing.sql` au projet Supabase.
2. Dans les secrets des Edge Functions Supabase, définir `SASPAY_API_KEY` avec la clé SasPay de test (ne pas utiliser une variable `VITE_`) et `APP_BASE_URL` avec `https://taillor2.vercel.app`.
3. Déployer les fonctions `saspay-checkout`, `saspay-confirm` et `saspay-webhook` sur le même projet Supabase que l’application. La vérification JWT est activée pour le checkout et la confirmation ; le webhook public vérifie la signature HMAC SasPay et l’horodatage.
4. Dans le tableau de bord SasPay, créer un webhook de test vers `https://stfqugqurqiigiviuwbq.supabase.co/functions/v1/saspay-webhook` et l’abonner aux événements `transaction.success`, `transaction.failed` et `transaction.cancelled`.
5. Copier le secret de signature affiché lors de la création du webhook dans Supabase Edge Function Secrets sous `SASPAY_WEBHOOK_SECRET`. Le secret n’est affiché qu’une seule fois par SasPay.
6. Tester un paiement de chaque formule avec un moyen de paiement de test SasPay. La formule reste inchangée tant que SasPay ne confirme pas le paiement.

Les offres Pro et Premium sont facturées manuellement chaque mois. Aucun renouvellement automatique n’est configuré. Une formule payante expire après un mois et revient à Gratuit au prochain chargement de l’espace.

La clé de production ne doit être ajoutée qu’après validation des tests, du compte marchand et des paramètres de production SasPay.
