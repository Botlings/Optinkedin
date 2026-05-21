# Architecture Technique — OptinkedIn

> **Document de référence CTO**
> Branche : `docs/architecture-technique`
> Dernière mise à jour : 2026-05-18
> Statut : ✅ Validé — référence pour tous les sprints

---

## Table des matières

1. [Vue d'ensemble](#1-vue-densemble)
2. [Décisions d'architecture (ADR)](#2-décisions-darchitecture-adr)
3. [Stack technique complète](#3-stack-technique-complète)
4. [Composants et responsabilités](#4-composants-et-responsabilités)
5. [Flux de données](#5-flux-de-données)
6. [Intégration OpenAI](#6-intégration-openai)
7. [Intégration Stripe](#7-intégration-stripe)
8. [Hébergement et déploiement](#8-hébergement-et-déploiement)
9. [Sécurité et RGPD](#9-sécurité-et-rgpd)
10. [Variables d'environnement](#10-variables-denvironnement)
11. [Structure du repo](#11-structure-du-repo)
12. [Roadmap technique par sprint](#12-roadmap-technique-par-sprint)

---

## 1. Vue d'ensemble

```
┌─────────────────────────────────────────────────────────────────┐
│                         UTILISATEUR                             │
│                    (navigateur, mobile)                         │
└──────────────────────────┬──────────────────────────────────────┘
                           │ HTTPS
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│              FRONTEND — GitHub Pages                            │
│         HTML/CSS/JS statique  ·  index.html à la racine        │
│         URL : https://botlings.github.io/Optinkedin/           │
│                                                                  │
│  [Formulaire URL LinkedIn]  →  fetch() vers Backend API        │
│  [Affichage score gratuit]                                       │
│  [Paywall flou]  →  Lien Stripe direct                         │
│  [Affichage recommandations IA]  ←  Backend API                │
└──────────────────────────┬──────────────────────────────────────┘
                           │ REST / JSON (HTTPS)
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│              BACKEND API — Railway                              │
│              Node.js 20 LTS  ·  Express 4                      │
│                                                                  │
│  POST /api/analyze      →  Score gratuit (5-7 critères)        │
│  POST /api/recommendations →  Recommandations IA complètes     │
│  POST /api/verify-payment   →  Vérification achat Stripe       │
└──────────┬─────────────────────────────┬────────────────────────┘
           │ HTTPS                        │ HTTPS
           ▼                             ▼
┌──────────────────────┐    ┌────────────────────────────────────┐
│  OPENAI API          │    │  STRIPE API                        │
│  GPT-4o              │    │  Webhook : paiement confirmé       │
│  Recommandations IA  │    │  Lien hébergé : buy.stripe.com/…   │
└──────────────────────┘    └────────────────────────────────────┘
```

**Principe directeur :** conserver le site statique existant (GitHub Pages, `index.html`) comme unique surface publique. Le backend Railway est une API privée appelée par `fetch()` — jamais exposée directement à l'utilisateur.

---

## 2. Décisions d'architecture (ADR)

### ADR-001 — Frontend : HTML statique plutôt que Next.js / Astro

| Critère | HTML statique | Next.js / Astro |
|---|---|---|
| Déploiement actuel | ✅ Déjà en ligne sur GitHub Pages | ❌ Nécessite Vercel ou migration |
| Temps pour être live | ✅ Immédiat (merge = deploy) | ❌ 1–2 jours de setup |
| Complexité build | ✅ Aucune | ❌ Node, bundler, CI pipeline |
| Coût hébergement | ✅ Gratuit (GitHub Pages) | ⚠️ Vercel free tier avec limites |
| SEO | ✅ Suffisant pour landing page | ✅ Meilleur pour blog/contenu |
| Maintenabilité future | ⚠️ Limite à ~5 pages | ✅ Scalable |

**Décision :** Conserver HTML/CSS/JS statique pour le Sprint 1–2. Migration vers Astro envisageable en Sprint 3 si le contenu SEO (blog, guides) le justifie. **Le `index.html` existant ne sera pas migré sans décision explicite du CPO.**

**Rationale :** Le produit est une landing page + formulaire + résultats. Pas besoin de SSR, routing complexe ou composants réactifs massifs. La valeur est dans le backend IA, pas dans le framework frontend.

---

### ADR-002 — Backend : Node.js plutôt que Python

| Critère | Node.js (Express) | Python (FastAPI) |
|---|---|---|
| Cohérence stack | ✅ JS côté front et back | ❌ Changement de contexte mental |
| SDK OpenAI | ✅ `openai` npm — feature parity | ✅ SDK Python mature |
| Cold start Railway | ✅ ~200ms | ⚠️ ~400ms selon runtime |
| Typage | ✅ TypeScript natif | ✅ Pydantic |
| Équipe (solo/early) | ✅ Un seul langage à maîtriser | ❌ Deux langages |

**Décision :** Node.js 20 LTS avec Express 4 et TypeScript strict.

---

### ADR-003 — Paiement : Lien Stripe hébergé (pas d'intégration SDK)

Le lien Stripe `https://buy.stripe.com/7sYfZh520gyXem39rh6sw00` est fourni et actif.

**Avantages :**
- Zéro code de paiement côté client (pas de PCI DSS à gérer)
- Stripe gère l'UI de paiement, les 3DS, les devises
- Le webhook Stripe → backend confirme le paiement et délivre lesrecommandations IA sans que l'utilisateur puisse bypasser le paywall.

**Flow paiement :**
```
Utilisateur clique "Obtenir mes recommandations IA"
        │
        ▼
Stripe Payment Page (hébergée par Stripe)
        │  paiement réussi
        ▼
Stripe envoie webhook POST /api/stripe/webhook → backend Railway
        │  backend enregistre session_id + email en mémoire courte (TTL 1h)
        ▼
Stripe redirige vers ?session_id=xxx&success=true
        │  frontend lit le query param
        ▼
Frontend appelle POST /api/recommendations?session_id=xxx
        │  backend vérifie session valide, appelle OpenAI
        ▼
Recommandations IA affichées à l'utilisateur
```

---

### ADR-004 — Pas de base de données en Sprint 1

Les recommandations IA sont générées à la demande et **non persistées**. La session de paiement est gardée en mémoire Node.js avec un TTL de 1 heure (Map avec expiration). Cela élimine :
- La complexité d'un ORM et d'un schéma DB
- Les obligations RGPD de durée de conservation sur données stockées
- Le coût d'un service base de données

**Limite acceptée :** si le serveur Railway redémarre dans le TTL d'1h, la session est perdue. L'utilisateur devra contacter le support. Acceptable en MVP.

**Migration Sprint 2 :** introduire PostgreSQL (Railway managed) pour persister les sessions de paiement avec `session_id`, `email`, `created_at`, `expires_at`. Aucune donnée LinkedIn ne sera stockée.

---

### ADR-005 — Hébergement : GitHub Pages (frontend) + Railway (backend)

| Composant | Service | Coût |
|---|---|---|
| Frontend statique | GitHub Pages | Gratuit |
| Backend API Node.js | Railway Starter | ~5 USD/mois |
| Domaine custom (futur) | Namecheap / Cloudflare | ~12 USD/an |

Vercel est écarté pour le frontend car GitHub Pages est déjà actif et le déploiement automatique sur `main` est fonctionnel. Vercel reste une option de migration si Astro est adopté (ADR-001).

---

## 3. Stack technique complète

### Frontend

| Couche | Technologie | Version | Rôle |
|---|---|---|---|
| Markup | HTML5 | — | Structure des pages |
| Style | CSS3 custom properties | — | Design system, responsive |
| Interactivité | Vanilla JS (ES2020+) | — | Formulaires, fetch, affichage dynamique |
| Fonts | Google Fonts (Plus Jakarta Sans) | — | Typographie |
| Hébergement | GitHub Pages | — | Serving statique |
| CI/CD | GitHub Actions (built-in Pages) | — | Deploy sur merge `main` |

> **Pas de framework JS côté client en Sprint 1.** L'ajout de modules ES natifs (`type="module"`) est prévu pour structurer le JS sans bundler.

---

### Backend

| Couche | Technologie | Version | Rôle |
|---|---|---|---|
| Runtime | Node.js | 20 LTS | Serveur applicatif |
| Framework | Express | 4.x | Routing HTTP, middleware |
| Langage | TypeScript | 5.x | Typage strict |
| IA | openai (npm) | 4.x | Appels GPT-4o |
| Validation | zod | 3.x | Validation entrées utilisateur |
| Sécurité HTTP | helmet | 7.x | Headers sécurité (CSP, HSTS…) |
| CORS | cors (npm) | 2.x | Autoriser GitHub Pages uniquement |
| Rate limiting | express-rate-limit | 7.x | Protection abus API |
| Webhooks Stripe | stripe (npm) | 14.x | Vérification signature webhook |
| Logging | pino | 9.x | Logs structurés JSON (Railway) |
| Build | tsx / tsup | latest | Compilation TS → JS |
| Hébergement | Railway | — | PaaS containerisé |

---

### Services tiers

| Service | Usage | Authentification |
|---|---|---|
| OpenAI API | Génération recommandations GPT-4o | `OPENAI_API_KEY` (env var) |
| Stripe | Lien paiement hébergé + webhooks | `STRIPE_WEBHOOK_SECRET` (env var) |
| GitHub Pages | Hosting frontend | Token GitHub Actions |

---

## 4. Composants et responsabilités

### 4.1 Frontend (`index.html` + modules JS)

```
index.html                     ← Page principale (déjà en ligne)
assets/
  js/
    analyzer.js                ← Gère formulaire + appel POST /api/analyze
    results.js                 ← Affiche score, critères, paywall
    premium.js                 ← Gère retour Stripe + appel /api/recommendations
  css/
    (styles inline dans index.html en Sprint 1)
```

**Responsabilités :**
- Capturer l'URL LinkedIn saisie par l'utilisateur
- Appeler le backend via `fetch()` (jamais directement OpenAI — la clé API ne touche jamais le client)
- Afficher le score gratuit (5–7 critères visibles, reste flouté)
- Rediriger vers le lien Stripe pour le paiement
- Lire le `?session_id=` au retour de Stripe et déclencher l'affichage premium

---

### 4.2 Backend API (`/api`)

```
src/
  server.ts                    ← Entry point Express
  routes/
    analyze.ts                 ← POST /api/analyze
    recommendations.ts         ← POST /api/recommendations
    webhook.ts                 ← POST /api/stripe/webhook
    health.ts                  ← GET /api/health
  services/
    linkedin-scraper.ts        ← Extraction données profil LinkedIn public
    scorer.ts                  ← Algorithme de scoring 5-7 critères gratuits
    openai.ts                  ← Wrapper appels GPT-4o
    session-store.ts           ← Map en mémoire TTL 1h (sessions paiement)
  validators/
    linkedin-url.ts            ← Validation + sanitisation URL LinkedIn
    session.ts                 ← Validation session_id format
  middleware/
    rate-limiter.ts            ← express-rate-limit config
    cors.ts                    ← Whitelist GitHub Pages origin
    error-handler.ts           ← Gestion centralisée des erreurs
  types/
    index.ts                   ← Types partagés (Score, Criterion, Session…)
```

---

### 4.3 Algorithme de scoring — critères

Le scoring évalue le profil LinkedIn sur **20 critères** au total, regroupés en catégories :

| # | Critère | Catégorie | Gratuit | Premium |
|---|---|---|---|---|
| 1 | Photo de profil présente | Visuel | ✅ | ✅ |
| 2 | Photo de couverture présente | Visuel | ✅ | ✅ |
| 3 | Titre optimisé (mots-clés, longueur) | Titre | ✅ | ✅ |
| 4 | Résumé / À propos présent | Résumé | ✅ | ✅ |
| 5 | Résumé longueur suffisante (>300 chars) | Résumé | ✅ | ✅ |
| 6 | URL personnalisée LinkedIn | URL | ✅ | ✅ |
| 7 | Secteur d'activité renseigné | Visibilité | ✅ | ✅ |
| 8 | Expériences professionnelles (≥2) | Expériences | ❌ | ✅ |
| 9 | Descriptions d'expériences (>100 chars) | Expériences | ❌ | ✅ |
| 10 | Formation renseignée | Formation | ❌ | ✅ |
| 11 | Compétences listées (≥5) | Compétences | ❌ | ✅ |
| 12 | Compétences validées par des pairs | Compétences | ❌ | ✅ |
| 13 | Recommandations reçues (≥1) | Social proof | ❌ | ✅ |
| 14 | Certifications présentes | Crédibilité | ❌ | ✅ |
| 15 | Projets ou publications | Contenu | ❌ | ✅ |
| 16 | Densité mots-clés sectoriels (titre+résumé) | SEO LinkedIn | ❌ | ✅ |
| 17 | Cohérence titre ↔ expériences | Cohérence | ❌ | ✅ |
| 18 | Activité récente (posts, commentaires) | Engagement | ❌ | ✅ |
| 19 | Connexions (>500 = All-Star signal) | Réseau | ❌ | ✅ |
| 20 | Profil en mode "Open to Work" ou "Hiring" | Signal | ❌ | ✅ |

**Score calcul :**
```
score_total = Σ (poids_critère_i × note_critère_i) / Σ poids_critère_i × 100

Pondérations (sur 100 points) :
  Photo profil         : 5 pts
  Photo couverture     : 2 pts
  Titre optimisé       : 12 pts
  Résumé présent       : 6 pts
  Résumé longueur      : 6 pts
  URL personnalisée    : 3 pts
  Secteur renseigné    : 2 pts
  Expériences (≥2)     : 8 pts
  Descriptions exp.    : 8 pts
  Formation            : 5 pts
  Compétences (≥5)     : 6 pts
  Compétences validées : 4 pts
  Recommandations      : 6 pts
  Certifications       : 3 pts
  Projets/publications : 4 pts
  Mots-clés sectoriels : 8 pts
  Cohérence titre/exp  : 6 pts
  Activité récente     : 5 pts
  Connexions >500      : 3 pts
  Open to Work/Hiring  : 2 pts
  ─────────────────────────────
  TOTAL                : 100 pts
```

---

## 5. Flux de données

### 5.1 Flux — Score gratuit

```
[Utilisateur]
     │  saisit https://linkedin.com/in/john-doe
     │
     ▼
[Frontend — index.html]
     │  validation URL pattern côté client (regex)
     │  POST /api/analyze
     │  body: { "url": "https://linkedin.com/in/john-doe" }
     │
     ▼
[Backend — POST /api/analyze]
     │  1. Validation + sanitisation URL (zod)
     │  2. Vérification rate-limit (10 req/IP/heure)
     │  3. Extraction données profil LinkedIn public (scraping HTML)
     │  4. Calcul score 7 critères gratuits
     │  5. Retour JSON score partiel
     │
     ▼
[Frontend]
     │  Affiche score global /100
     │  Affiche 7 critères avec statut (vert/orange/rouge)
     │  Critères 8–20 : affichés floutés avec cadenas 🔒
     │  CTA : "Débloquer les recommandations IA — 19 €"
     │         → href="https://buy.stripe.com/7sYfZh520gyXem39rh6sw00"
```

**Réponse JSON `/api/analyze` :**
```json
{
  "score": 74,
  "tier": "free",
  "criteria": [
    { "id": "photo_profile", "label": "Photo de profil", "score": 5, "max": 5, "status": "good", "visible": true },
    { "id": "cover_photo",   "label": "Photo de couverture", "score": 0, "max": 2, "status": "missing", "visible": true },
    { "id": "title",         "label": "Titre optimisé", "score": 8, "max": 12, "status": "improve", "visible": true },
    { "id": "summary_exists","label": "Résumé présent", "score": 6, "max": 6,  "status": "good", "visible": true },
    { "id": "summary_length","label": "Longueur du résumé", "score": 3, "max": 6, "status": "improve", "visible": true },
    { "id": "custom_url",    "label": "URL personnalisée", "score": 3, "max": 3, "status": "good", "visible": true },
    { "id": "industry",      "label": "Secteur renseigné", "score": 2, "max": 2, "status": "good", "visible": true }
  ],
  "locked_count": 13,
  "preview_message": "13 critères supplémentaires analysés — débloquez le rapport complet"
}
```

---

### 5.2 Flux — Achat et recommandations IA

```
[Utilisateur clique "Débloquer"]
     │
     ▼
[Stripe Payment Page — hébergée par Stripe]
     │  Utilisateur saisit email + carte
     │  Paiement 19 € validé
     │
     ├──[Webhook]──────────────────────────────────────────────────┐
     │                                                              │
     ▼                                                              ▼
[Stripe redirige vers]                               [Backend — POST /api/stripe/webhook]
[index.html?session_id=cs_xxx&success=true]            │  1. Vérifie signature Stripe
     │                                                 │     (STRIPE_WEBHOOK_SECRET)
     │                                                 │  2. Extrait session_id + email
     │                                                 │  3. Stocke en SessionStore
     │                                                 │     { session_id, email, url_linkedin,
     │                                                 │       paid_at, expires: now+1h }
     │                                                 └─────────────────────────────────────
     │
     ▼
[Frontend lit ?session_id=cs_xxx]
     │  POST /api/recommendations
     │  body: { "session_id": "cs_xxx", "url": "https://linkedin.com/in/john-doe" }
     │
     ▼
[Backend — POST /api/recommendations]
     │  1. Valide session_id dans SessionStore (non expiré)
     │  2. Marque session comme "utilisée" (prévient replay)
     │  3. Extrait données profil LinkedIn (re-fetch ou cache 5min)
     │  4. Appelle OpenAI GPT-4o avec prompt structuré
     │  5. Retourne recommandations JSON
     │
     ▼
[OpenAI GPT-4o]
     │  Génère recommandations personnalisées
     │  par section (titre, résumé, compétences…)
     │
     ▼
[Frontend]
     Affiche rapport complet :
     - 20 critères avec scores détaillés
     - Recommandations IA par section
     - Suggestions de mots-clés sectoriels
     - Exemples de phrases optimisées
```

**Réponse JSON `/api/recommendations` :**
```json
{
  "score": 74,
  "tier": "premium",
  "criteria": [
    { "id": "photo_profile",   "label": "Photo de profil",       "score": 5,  "max": 5,  "status": "good",    "visible": true },
    { "id": "cover_photo",     "label": "Photo de couverture",   "score": 0,  "max": 2,  "status": "missing", "visible": true },
    { "id": "title",           "label": "Titre optimisé",        "score": 8,  "max": 12, "status": "improve", "visible": true },
    { "id": "summary_exists",  "label": "Résumé présent",        "score": 6,  "max": 6,  "status": "good",    "visible": true },
    { "id": "summary_length",  "label": "Longueur du résumé",    "score": 3,  "max": 6,  "status": "improve", "visible": true },
    { "id": "custom_url",      "label": "URL personnalisée",     "score": 3,  "max": 3,  "status": "good",    "visible": true },
    { "id": "industry",        "label": "Secteur renseigné",     "score": 2,  "max": 2,  "status": "good",    "visible": true },
    { "id": "experiences",     "label": "Expériences (≥2)",      "score": 8,  "max": 8,  "status": "good",    "visible": true },
    { "id": "exp_descriptions","label": "Descriptions détaillées","score": 4, "max": 8,  "status": "improve", "visible": true },
    { "id": "education",       "label": "Formation renseignée",  "score": 5,  "max": 5,  "status": "good",    "visible": true },
    { "id": "skills",          "label": "Compétences (≥5)",      "score": 6,  "max": 6,  "status": "good",    "visible": true },
    { "id": "skills_endorsed", "label": "Compétences validées",  "score": 2,  "max": 4,  "status": "improve", "visible": true },
    { "id": "recommendations", "label": "Recommandations reçues","score": 0,  "max": 6,  "status": "missing", "visible": true },
    { "id": "certifications",  "label": "Certifications",        "score": 0,  "max": 3,  "status": "missing", "visible": true },
    { "id": "projects",        "label": "Projets / publications", "score": 4, "max": 4,  "status": "good",    "visible": true },
    { "id": "keywords",        "label": "Mots-clés sectoriels",  "score": 4,  "max": 8,  "status": "improve", "visible": true },
    { "id": "coherence",       "label": "Cohérence titre/exp",   "score": 5,  "max": 6,  "status": "good",    "visible": true },
    { "id": "activity",        "label": "Activité récente",      "score": 2,  "max": 5,  "status": "improve", "visible": true },
    { "id": "connections",     "label": "Connexions >500",       "score": 3,  "max": 3,  "status": "good",    "visible": true },
    { "id": "open_signal",     "label": "Open to Work / Hiring", "score": 0,  "max": 2,  "status": "missing", "visible": true }
  ],
  "recommendations": [
    {
      "section": "Titre",
      "priority": "high",
      "issue": "Votre titre manque de mots-clés recherchés par les recruteurs de votre secteur.",
      "suggestion": "Remplacez 'Développeur' par 'Développeur Full-Stack Node.js & React | Open to Work'. Intégrez votre spécialité et votre disponibilité.",
      "example": "Développeur Full-Stack Node.js & React · 5 ans d'expérience · Disponible immédiatement"
    },
    {
      "section": "Résumé",
      "priority": "high",
      "issue": "Votre résumé fait moins de 300 caractères. LinkedIn favorise les profils avec un résumé complet.",
      "suggestion": "Rédigez un résumé de 500–700 caractères structuré en 3 blocs : qui vous êtes, ce que vous faites, ce que vous cherchez. Terminez par un call-to-action.",
      "example": "Développeur Full-Stack passionné avec 5 ans d'expérience en Node.js et React. J'aide les startups à construire des produits scalables, de l'architecture à la mise en production. Actuellement en recherche d'opportunités B2B / SaaS. → me contacter : [email]"
    },
    {
      "section": "Recommandations",
      "priority": "medium",
      "issue": "Aucune recommandation reçue. C'est l'un des signaux de crédibilité les plus forts pour les recruteurs.",
      "suggestion": "Contactez 3 anciens collègues ou managers et demandez-leur une recommandation personnalisée. Proposez-leur un template pour faciliter leur rédaction.",
      "example": "Message type : 'Bonjour [Prénom], nous avons collaboré sur [projet] chez [entreprise]. Serais-tu à l'aise pour rédiger une courte recommandation sur mon profil LinkedIn ?'"
    }
  ],
  "keywords": {
    "missing": ["TypeScript", "CI/CD", "API REST", "Docker", "Agile"],
    "present": ["JavaScript", "Node.js", "React"],
    "suggestion": "Intégrez TypeScript, CI/CD et Docker dans votre titre ou résumé pour apparaître dans 40% de recherches supplémentaires de recruteurs tech."
  }
}
```

---

## 6. Intégration OpenAI

### 6.1 Modèle et paramètres

| Paramètre | Valeur | Justification |
|---|---|---|
| Modèle | `gpt-4o` | Meilleur rapport qualité/coût pour génération de texte structuré |
| `temperature` | `0.4` | Recommandations cohérentes, pas aléatoires |
| `max_tokens` | `2000` | Suffisant pour 3–5 recommandations détaillées |
| `response_format` | `json_object` | Garantit un JSON parseable, pas de markdown parasite |
| Timeout | `30s` | Railway déconnecte à 60s — marge de sécurité |

### 6.2 Prompt système

```
Tu es un expert en optimisation de profils LinkedIn avec 10 ans d'expérience
en recrutement et personal branding. Tu analyses des profils LinkedIn et fournis
des recommandations précises, actionnables et personnalisées.

RÈGLES STRICTES :
- Réponds UNIQUEMENT en JSON valide selon le schéma fourni
- Chaque recommandation doit inclure : section, priority, issue, suggestion, example
- Les exemples doivent être concrets et adaptés au secteur détecté
- Priorités : "high" (impact fort, effort faible), "medium" (impact fort, effort moyen), "low" (amélioration marginale)
- Pas de conseils génériques — chaque recommandation doit mentionner le contenu spécifique du profil analysé
- Langue : français uniquement
```

### 6.3 Prompt utilisateur (template)

```
Analyse ce profil LinkedIn et génère des recommandations d'optimisation.

DONNÉES DU PROFIL :
- URL : {linkedin_url}
- Titre actuel : {title}
- Résumé : {summary}
- Nombre d'expériences : {experiences_count}
- Descriptions d'expériences : {experiences_descriptions}
- Compétences listées : {skills}
- Recommandations reçues : {recommendations_count}
- Certifications : {certifications}
- Secteur : {industry}
- Connexions : {connections_range}
- Activité récente : {has_recent_activity}

SCORES PAR CRITÈRE :
{criteria_scores_json}

SECTEUR DÉTECTÉ : {detected_sector}

Génère un JSON avec exactement ce schéma :
{
  "recommendations": [
    {
      "section": "string (ex: Titre, Résumé, Compétences...)",
      "priority": "high|medium|low",
      "issue": "string — problème spécifique identifié",
      "suggestion": "string — action concrète à effectuer",
      "example": "string — exemple de contenu rédigé"
    }
  ],
  "keywords": {
    "missing": ["string"],
    "present": ["string"],
    "suggestion": "string"
  }
}

Génère entre 3 et 7 recommandations, triées par priorité décroissante.
```

### 6.4 Coût estimé par appel

```
Tokens prompt moyen  : ~800 tokens
Tokens réponse moyen : ~600 tokens
Total par appel      : ~1 400 tokens

Coût GPT-4o          : $5 / 1M input + $15 / 1M output
Coût par recommandation : ($5 × 0.0008) + ($15 × 0.0006) = $0.004 + $0.009 = ~$0.013

Avec 19 € de revenu et ~$0.013 de coût IA : marge IA > 99.9%
```

---

## 7. Intégration Stripe

### 7.1 Lien de paiement

```
URL : https://buy.stripe.com/7sYfZh520gyXem39rh6sw00
```

**Ce lien est le seul point d'entrée paiement.** Ne jamais créer de Payment Intent côté frontend. Ne jamais exposer de clé Stripe publishable dans le code client.

### 7.2 Configuration Stripe Dashboard requise

Pour que le flux fonctionne, configurer dans le Dashboard Stripe :

```
Payment Link > Settings :
  ✅ Collecter l'adresse email du client
  ✅ URL de redirection après paiement :
     https://botlings.github.io/Optinkedin/?success=true&session_id={CHECKOUT_SESSION_ID}

Webhooks > Add endpoint :
  URL     : https://[votre-app].railway.app/api/stripe/webhook
  Events  : checkout.session.completed
  Secret  : copier dans variable d'env STRIPE_WEBHOOK_SECRET
```

### 7.3 Vérification webhook

```typescript
// Le backend vérifie que l'événement vient bien de Stripe
// en validant la signature HMAC avec STRIPE_WEBHOOK_SECRET
// Toute requête avec signature invalide → 400 rejetée

stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET)
```

### 7.4 Protection anti-replay

Chaque `session_id` Stripe ne peut être utilisé qu'**une seule fois** pour obtenir des recommandations. Le `SessionStore` marque la session `used: true` après le premier appel à `/api/recommendations`. Un second appel avec le même `session_id` retourne `403 Forbidden`.

---

## 8. Hébergement et déploiement

### 8.1 Frontend — GitHub Pages

```
Branche   : main
Fichier   : index.html (racine)
URL       : https://botlings.github.io/Optinkedin/
Deploy    : automatique à chaque merge sur main (~30s–2min)
HTTPS     : fourni par GitHub Pages (Let's Encrypt)
```

**Domaine custom (Sprint 2 optionnel) :**
```
1. Acheter optinkedin.fr (ou .com) sur Namecheap/OVH
2. Ajouter fichier CNAME à la racine du repo : optinkedin.fr
3. Configurer DNS : CNAME www → botlings.github.io
4. Activer "Enforce HTTPS" dans GitHub Pages settings
```

### 8.2 Backend — Railway

```
Service   : Web Service
Runtime   : Node.js 20 (auto-détecté via package.json)
Branche   : main (sous-dossier /backend si monorepo)
Port      : 3000 (variable PORT fournie par Railway)
Health    : GET /api/health → 200 OK
```

**Variables d'environnement Railway :**
```
NODE_ENV=production
PORT=3000                          (fourni automatiquement par Railway)
OPENAI_API_KEY=sk-...             (secret — jamais en clair)
STRIPE_WEBHOOK_SECRET=whsec_...   (secret — jamais en clair)
ALLOWED_ORIGIN=https://botlings.github.io
```

**Fichier `railway.toml` :**
```toml
[build]
builder = "nixpacks"
buildCommand = "npm ci && npm run build"

[deploy]
startCommand = "node dist/server.js"
healthcheckPath = "/api/health"
healthcheckTimeout = 10
restartPolicyType = "on_failure"
restartPolicyMaxRetries = 3
```

### 8.3 Pipeline CI/CD

```
GitHub (push main)
       │
       ├──[GitHub Pages]──► Build statique (aucun) → Deploy index.html
       │                    Délai : ~30s–2min
       │
       └──[Railway]────────► nixpacks detect Node.js
                             npm ci → npm run build → node dist/server.js
                             Délai : ~2–4min
```

---

## 9. Sécurité et RGPD

### 9.1 Sécurité frontend

| Mesure | Implémentation |
|---|---|
| CSP | `script-src 'unsafe-inline'` (site statique sans nonce) — à migrer vers nonce si Astro adopté |
| Referrer-Policy | `strict-origin-when-cross-origin` |
| X-Content-Type-Options | `nosniff` |
| Permissions-Policy | `camera=(), microphone=(), geolocation=()` |
| Pas de clés en frontend | ✅ Clé OpenAI et Stripe secret côté backend uniquement |

### 9.2 Sécurité backend

| Mesure | Implémentation |
|---|---|
| CORS restrictif | Seule l'origine `https://botlings.github.io` est autorisée |
| Rate limiting | 10 req/IP/heure sur `/api/analyze`, 5 req/IP/heure sur `/api/recommendations` |
| Validation entrées | Zod — toute entrée non conforme → 400 |
| Headers sécurité | Helmet.js (HSTS, no-sniff, frame-guard…) |
| Signature Stripe |```
stripe.webhooks.constructEvent() — rejet si signature invalide |
| Secrets env vars | Jamais en clair dans le code — `process.env.*` uniquement |
| Logs sans PII | pino configuré pour masquer emails et URLs LinkedIn dans les logs |

### 9.3 RGPD

| Obligation | Implémentation |
|---|---|
| Pas de stockage données LinkedIn | ✅ Profil scrappé à la volée, jamais persisté en DB |
| Consentement cookies | ✅ Bandeau RGPD déjà présent dans `index.html` (localStorage) |
| Durée de vie sessions | TTL 1h en mémoire Node.js — pas de trace après expiration |
| Email Stripe | Géré par Stripe (sous-traitant) — DPA Stripe couvre RGPD |
| Droit à l'oubli | Pas de DB en Sprint 1 → rien à supprimer. Sprint 2 : endpoint DELETE |
| Logs | Rétention 7 jours max sur Railway — aucun PII dans les logs |

---

## 10. Variables d'environnement

### Backend (Railway)

| Variable | Description | Exemple | Obligatoire |
|---|---|---|---|
| `NODE_ENV` | Environnement d'exécution | `production` | ✅ |
| `PORT` | Port HTTP (fourni par Railway) | `3000` | ✅ (auto) |
| `OPENAI_API_KEY` | Clé API OpenAI | `sk-proj-...` | ✅ |
| `STRIPE_WEBHOOK_SECRET` | Secret de validation webhook Stripe | `whsec_...` | ✅ |
| `ALLOWED_ORIGIN` | Origine CORS autorisée | `https://botlings.github.io` | ✅ |
| `SESSION_TTL_MS` | Durée de vie session paiement (ms) | `3600000` | ⚠️ défaut 1h |
| `RATE_LIMIT_ANALYZE` | Requêtes max/IP/heure sur /analyze | `10` | ⚠️ défaut 10 |
| `RATE_LIMIT_RECO` | Requêtes max/IP/heure sur /recommendations | `5` | ⚠️ défaut 5 |
| `LOG_LEVEL` | Niveau de log pino | `info` | ⚠️ défaut info |

### Frontend (aucune variable sensible)

Le frontend est statique — **zéro variable d'environnement exposée**. L'URL du backend Railway est la seule configuration, définie en dur dans les modules JS (ou via un fichier `config.js` non-secret).

```javascript
// assets/js/config.js — seul fichier de configuration frontend
// Pas de secret ici — uniquement l'URL publique de l'API
const API_BASE_URL = 'https://optinkedin-api.railway.app';
```

---

## 11. Structure du repo

```
Optinkedin/                          ← racine GitHub Pages
│
├── index.html                       ← ✅ EXISTANT — page publique (ne pas supprimer)
├── ARCHITECTURE.md                  ← ce document
├── README.md                        ← à créer (Sprint 1)
│
├── assets/                          ← ressources frontend (Sprint 1)
│   └── js/
│       ├── config.js                ← URL API backend
│       ├── analyzer.js              ← appel /api/analyze + affichage score
│       ├── results.js               ← rendu critères, paywall, CTA Stripe
│       └── premium.js               ← retour Stripe, appel /api/recommendations
│
└── backend/                         ← API Node.js (déployée sur Railway)
    ├── package.json
    ├── tsconfig.json
    ├── railway.toml
    ├── .env.example                 ← template variables (sans valeurs réelles)
    └── src/
        ├── server.ts
        ├── routes/
        │   ├── analyze.ts
        │   ├── recommendations.ts
        │   ├── webhook.ts
        │   └── health.ts
        ├── services/
        │   ├── linkedin-scraper.ts
        │   ├── scorer.ts
        │   ├── openai.ts
        │   └── session-store.ts
        ├── validators/
        │   ├── linkedin-url.ts
        │   └── session.ts
        ├── middleware/
        │   ├── rate-limiter.ts
        │   ├── cors.ts
        │   └── error-handler.ts
        └── types/
            └── index.ts
```

---

## 12. Roadmap technique par sprint

### Sprint 1 — MVP fonctionnel (2 semaines)

**Objectif :** Un utilisateur peut coller son URL LinkedIn, obtenir un score gratuit sur 7 critères, et être redirigé vers Stripe.

| Tâche | Composant | Priorité |
|---|---|---|
| Créer `backend/` avec structure complète | Backend | 🔴 P0 |
| Implémenter `POST /api/analyze` (7 critères) | Backend | 🔴 P0 |
| Implémenter `linkedin-scraper.ts` (HTML public) | Backend | 🔴 P0 |
| Implémenter `scorer.ts` (7 critères gratuits) | Backend | 🔴 P0 |
| Déployer backend sur Railway | Infrastructure | 🔴 P0 |
| Modifier `index.html` : formulaire → fetch API | Frontend | 🔴 P0 |
| Afficher score + 7 critères + paywall flouté | Frontend | 🔴 P0 |
| Implémenter `POST /api/stripe/webhook` | Backend | 🟠 P1 |
| Implémenter `POST /api/recommendations` + OpenAI | Backend | 🟠 P1 |
| Afficher recommandations IA au retour Stripe | Frontend | 🟠 P1 |
| Configurer webhook dans Stripe Dashboard | Infrastructure | 🟠 P1 |
| Configurer URL de redirection dans Stripe | Infrastructure | 🟠 P1 |

---

### Sprint 2 — Robustesse et conversion (2 semaines)

**Objectif :** Réduire la friction, améliorer la fiabilité, premiers A/B tests.

| Tâche | Composant | Priorité |
|---|---|---|
| Migrer sessions vers PostgreSQL Railway | Backend | 🟠 P1 |
| Implémenter les 20 critères de scoring complets | Backend | 🟠 P1 |
| Export PDF des recommandations (puppeteer ou @react-pdf) | Backend | 🟡 P2 |
| Loader animé pendant l'analyse (UX) | Frontend | 🟡 P2 |
| Page de résultats dédiée (`/results`) | Frontend | 🟡 P2 |
| Monitoring erreurs (Sentry free tier) | Infrastructure | 🟡 P2 |
| Tests unitaires scorer + validators | Backend | 🟡 P2 |
| A/B test prix €19 vs €29 (CPO spec) | Stripe | 🟡 P2 |

---

### Sprint 3 — Scale et SEO (4 semaines)

**Objectif :** Acquisition organique, scalabilité, migration framework si justifiée.

| Tâche | Composant | Priorité |
|---|---|---|
| Migration frontend vers Astro (SSG) si blog validé | Frontend | 🟢 P3 |
| Blog SEO (10 articles cibles CMO) | Contenu | 🟢 P3| Domaine custom + HTTPS | Infrastructure | 🟢 P3 |
| Cache Redis résultats scoring (Railway) | Backend | 🟢 P3 |
| Dashboard analytics simple (Plausible) | Infrastructure | 🟢 P3 |
| API LinkedIn officielle (si accès obtenu) | Backend | 🟢 P3 |

---

## Annexe A — Choix écarté : Vercel

Vercel a été évalué comme hébergement frontend alternatif à GitHub Pages. Écarté pour les raisons suivantes :

1. **GitHub Pages est déjà actif** avec un déploiement automatique fonctionnel — migrer crée de la friction sans valeur ajoutée en Sprint 1.
2. **Le frontend est statique** — les features Vercel (Edge Functions, ISR, middleware) ne sont pas utiles pour une landing page HTML.
3. **Vercel free tier** impose des limites de bande passante (100 GB/mois) et de builds (6000 min/mois) qui pourraient poser problème en cas de croissance rapide.
4. **Séparation claire frontend/backend** : GitHub Pages (statique) + Railway (API) est plus simple à opérer qu'un monorepo Vercel avec API routes.

Vercel reste pertinent **si** la migration vers Next.js est décidée en Sprint 3 pour le SEO (SSR/SSG blog).

---

## Annexe B — Choix écarté : Python / FastAPI

FastAPI a été évalué comme alternative à Node.js/Express. Écarté pour les raisons suivantes :

1. **Cohérence de stack** : le frontend est en JS — un backend Node.js permet à un développeur solo de ne maîtriser qu'un seul langage et écosystème.
2. **SDK OpenAI npm** : feature parity complète avec le SDK Python depuis la v4. Aucun avantage fonctionnel pour Python.
3. **Cold start Railway** : Node.js démarre plus vite (~200ms vs ~400ms pour Python avec uvicorn) — important pour la perception de performance sur le premier appel.
4. **TypeScript strict** : offre les garanties de typage de Python (Pydantic) avec l'écosystème JS.

Python / FastAPI reste pertinent si l'équipe grandit avec des profils data science ou si des traitements NLP custom (au-delà d'OpenAI) sont nécessaires en Sprint 3+.

---

## Annexe C — Évolution vers Astro (décision Sprint 3)

Si le CPO valide la stratégie contenu SEO (blog, guides LinkedIn), la migration frontend vers **Astro** est recommandée :

```
Avantages Astro pour OptinkedIn :
  ✅ SSG (Static Site Generation) — HTML pré-rendu pour le SEO
  ✅ Islands architecture — JS uniquement où nécessaire (formulaire, résultats)
  ✅ Hébergement GitHub Pages ou Vercel (build step requis)
  ✅ Composants réutilisables sans overhead React complet
  ✅ Import du CSS existant (custom properties) sans refonte

Migration path :
  1. Créer src/pages/index.astro qui remplace index.html
  2. Extraire les sections en composants Astro (Hero, Pricing, Testimonials…)
  3. Ajouter src/pages/blog/[slug].astro pour les articles
  4. Configurer GitHub Actions pour le build Astro → GitHub Pages
  5. Vérifier que index.html est bien remplacé (pas coexistence)

Prérequis avant migration :
  - Validation CPO : le blog génère du trafic organique mesurable
  - Au moins 5 articles de blog rédigés et prêts
  - Décision sur domaine custom (Astro + domaine = SEO maximal)
```

---

*Document maintenu par le CTO — toute modification d'architecture doit être reflétée ici avant implémentation.*