# Press Start

Plateforme de gestion de ma collection de jeux vidéo (jeux physiques, dématérialisés, consoles, licences, actus…).

- **Page** : hébergée par GitHub Pages (`index.html`).
- **Données, images, connexion** : Supabase (`supabase/schema.sql`).
- **Fonctions Claude** (reformulation de l'avis, récit du jeu…) : fonction Supabase `supabase/functions/claude`.

Aucune clé secrète n'est stockée dans ce dépôt : seule la clé *publishable* de Supabase (prévue pour être publique) est dans `index.html`.

## Installation

1. **Base de données** — Supabase → *SQL Editor* → *New query* → coller `supabase/schema.sql` → *Run*.
2. **Compte** — Supabase → *Authentication* → *Users* → *Add user* → *Create new user* (e-mail + mot de passe, « Auto Confirm User » coché).
   Puis *Authentication* → *Sign In / Providers* → désactiver *Allow new users to sign up*.
3. **Fonction Claude** — Supabase → *Edge Functions* → *Deploy a new function* → *Via Editor* → nom `claude` → coller `supabase/functions/claude/index.ts` → *Deploy*.
   Puis *Edge Functions* → *Secrets* → ajouter `ANTHROPIC_API_KEY` (clé créée sur console.anthropic.com).
4. **GitHub Pages** — dépôt → *Settings* → *Pages* → *Source : Deploy from a branch* → *main* / *(root)* → *Save*.
5. **Adresse du site dans Supabase** — *Authentication* → *URL Configuration* → *Site URL* : `https://gingersam33.github.io/Press-Start/`.
6. **Données** — sur claude.ai : *Base de données* → *Exporter toutes mes données* ; puis sur le site hébergé : *Base de données* → *Importer une archive Press Start*.
