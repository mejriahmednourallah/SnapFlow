# KPI Phase 1 Questionnaire (Aggregator)

This file compiles all KPI decision questions to resolve duplication and improve evidence quality before editing logic.

## Current JSON (as-is today)

- Endpoint: `/scan/{scan_id}/kpi` (alias of `/scan/{scan_id}/kpis`)
- Builder source: `V3-Microservices/v3-aggregator/kpi_builder.py`
- Real sample generated from fixture: `V3-Microservices/v3-aggregator/docs/current_kpi_response_from_fixture.json`
- Shape:
```json
{
  "scan_id": "...",
  "domain": "...",
  "pages_scanned": 0,
  "axes": {
    "<Axis>": {
      "<KPI Name>": {
        "info": "...",
        "impact": "...",
        "pages_affected": 0,
        "pages_affected_urls": [],
        "status": "passing|failing|not_available",
        "type": "bug|recommendation|compliance|null",
        "severity": "critical|high|medium|low|null",
        "data": {}
      }
    }
  },
  "generated_at": "..."
}
```

## Decisions already answered

- Broken links duplication: **merge into one KPI** with status-code breakdown evidence.
- Search duplication: keep only **`Fonctionnement du Moteur de Recherche Interne`** as KPI and remove search from `Fonctionnalités`.

## Known duplicate clusters to confirm

- `Liens` + `Erreur 404` (same `broken_link_kpi` source).
- `Fonctionnalités` + `Fonctionnement du Moteur de Recherche Interne` (`has_search` overlap).
- `SEO > Linking Interne` + `Audit UX/UI > Maillage` (`pages_missing_contextual_links` overlap).
- `Audit UX/UI > Structure, Navigation et Parcours Client` + `Tunnel de Conversion` (`pages_with_conversion_funnels` overlap).
- `Audit UX/UI > Pertinence...` + `Contenu > Contenu Fin et Qualité` (thin/typo/stuffing overlap).
- `Audit UX/UI > Périodicité de Mise à Jour` + `Contenu > Fraîcheur du Contenu` (freshness/news overlap).

## Duplicate locations in current JSON sample

Cross-check these paths in `V3-Microservices/v3-aggregator/docs/current_kpi_response_from_fixture.json`:

- `axes["Audit Fonctionnel"]["Liens"]` and `axes["Audit Fonctionnel"]["Erreur 404"]`
- `axes["Audit Fonctionnel"]["Fonctionnalités"]` and `axes["Audit Fonctionnel"]["Fonctionnement du Moteur de Recherche Interne"]`
- `axes["SEO"]["Linking Interne"]` and `axes["Audit UX/UI"]["Maillage"]`
- `axes["Audit UX/UI"]["Structure, Navigation et Parcours Client"]` and `axes["Audit UX/UI"]["Tunnel de Conversion"]`
- `axes["Audit UX/UI"]["Pertinence, Qualité, Originalité et Intérêt"]` and `axes["Contenu"]["Contenu Fin et Qualité"]`
- `axes["Audit UX/UI"]["Périodicité de Mise à Jour"]` and `axes["Contenu"]["Fraîcheur du Contenu"]`

## Per-KPI decisions (fill and send back)

For each KPI, answer:
- `Decision`: `keep`, `merge`, `informational`, or `remove`
- `Evidence depth`: `domain_only`, `url_list`, `url+element`, `url+element+tech`, or custom
- `Required evidence fields`: free text

### Audit Technique

- KPI: **Version CMS/Framework**
  - Decision: 
  - Evidence depth: 
  - Required evidence fields: 

- KPI: **Version Modules Installés**
  - Decision: 
  - Evidence depth: 
  - Required evidence fields: 

- KPI: **Version Langage de Programmation**
  - Decision: 
  - Evidence depth: 
  - Required evidence fields: 

- KPI: **Vérification du Code**
  - Decision: 
  - Evidence depth: 
  - Required evidence fields: 

### Check Sécurité

- KPI: **SSL**
  - Decision: 
  - Evidence depth: 
  - Required evidence fields: 

- KPI: **Sécurité des En-têtes HTTP**
  - Decision: 
  - Evidence depth: 
  - Required evidence fields: 

- KPI: **Gestion des Sessions**
  - Decision: 
  - Evidence depth: 
  - Required evidence fields: 

- KPI: **SQL Injection et DDoS**
  - Decision: 
  - Evidence depth: 
  - Required evidence fields: 

- KPI: **Pages Admin Exposées**
  - Decision: 
  - Evidence depth: 
  - Required evidence fields: 

- KPI: **Divulgation de Version CMS**
  - Decision: 
  - Evidence depth: 
  - Required evidence fields: 

- KPI: **Divulgation d'Information via robots.txt**
  - Decision: 
  - Evidence depth: 
  - Required evidence fields: 

- KPI: **Fuite d'Information Page d'Erreur**
  - Decision: 
  - Evidence depth: 
  - Required evidence fields: 

- KPI: **Fichiers Sensibles Exposés**
  - Decision: 
  - Evidence depth: 
  - Required evidence fields: 

- KPI: **Méthodes HTTP TRACE/TRACK**
  - Decision: 
  - Evidence depth: 
  - Required evidence fields: 

- KPI: **Misconfiguration CORS**
  - Decision: 
  - Evidence depth: 
  - Required evidence fields: 

- KPI: **Protection Brute Force Login**
  - Decision: 
  - Evidence depth: 
  - Required evidence fields: 

- KPI: **Contrôle d'Extension Upload Fichier**
  - Decision: 
  - Evidence depth: 
  - Required evidence fields: 

- KPI: **Dépendances JS Vulnérables (CVE)**
  - Decision: 
  - Evidence depth: 
  - Required evidence fields: 

### Audit Fonctionnel

- KPI: **Les Formulaires**
  - Decision: 
  - Evidence depth: 
  - Required evidence fields: 

- KPI: **Liens**
  - Decision: 
  - Evidence depth: 
  - Required evidence fields: 

- KPI: **Boutons**
  - Decision: 
  - Evidence depth: 
  - Required evidence fields: 

- KPI: **Fonctionnalités**
  - Decision: 
  - Evidence depth: 
  - Required evidence fields: 

- KPI: **Fonctionnement du Moteur de Recherche Interne**
  - Decision: 
  - Evidence depth: 
  - Required evidence fields: 

- KPI: **Erreur 404**
  - Decision: 
  - Evidence depth: 
  - Required evidence fields: 

### Audit de Performance et Temps de Réponse

- KPI: **Temps de Chargement Desktop**
  - Decision: 
  - Evidence depth: 
  - Required evidence fields: 

- KPI: **Temps de Chargement Mobile**
  - Decision: 
  - Evidence depth: 
  - Required evidence fields: 

- KPI: **Optimisation des Images**
  - Decision: 
  - Evidence depth: 
  - Required evidence fields: 

- KPI: **Gestion de Cache**
  - Decision: 
  - Evidence depth: 
  - Required evidence fields: 

- KPI: **Utilisation de Compression**
  - Decision: 
  - Evidence depth: 
  - Required evidence fields: 

### SEO

- KPI: **Balise Alts**
  - Decision: 
  - Evidence depth: 
  - Required evidence fields: 

- KPI: **Balises META**
  - Decision: 
  - Evidence depth: 
  - Required evidence fields: 

- KPI: **Sitemap**
  - Decision: 
  - Evidence depth: 
  - Required evidence fields: 

- KPI: **Robot Txt**
  - Decision: 
  - Evidence depth: 
  - Required evidence fields: 

- KPI: **Duplication de Contenu**
  - Decision: 
  - Evidence depth: 
  - Required evidence fields: 

- KPI: **Compatibilité Multiplateforme**
  - Decision: 
  - Evidence depth: 
  - Required evidence fields: 

- KPI: **Structure des URLs**
  - Decision: 
  - Evidence depth: 
  - Required evidence fields: 

- KPI: **Structure du Contenu (Hn)**
  - Decision: 
  - Evidence depth: 
  - Required evidence fields: 

- KPI: **Linking Interne**
  - Decision: 
  - Evidence depth: 
  - Required evidence fields: 

- KPI: **Linking Externe**
  - Decision: 
  - Evidence depth: 
  - Required evidence fields: 

- KPI: **Qualité H1 (NLP)**
  - Decision: 
  - Evidence depth: 
  - Required evidence fields: 

- KPI: **Méta Description (NLP)**
  - Decision: 
  - Evidence depth: 
  - Required evidence fields: 

- KPI: **AI Readiness (llms.txt)**
  - Decision: 
  - Evidence depth: 
  - Required evidence fields: 

### Audit UX/UI

- KPI: **Ciblage**
  - Decision: 
  - Evidence depth: 
  - Required evidence fields: 

- KPI: **Pertinence, Qualité, Originalité et Intérêt**
  - Decision: 
  - Evidence depth: 
  - Required evidence fields: 

- KPI: **Périodicité de Mise à Jour**
  - Decision: 
  - Evidence depth: 
  - Required evidence fields: 

- KPI: **Partage Social**
  - Decision: 
  - Evidence depth: 
  - Required evidence fields: 

- KPI: **Maillage**
  - Decision: 
  - Evidence depth: 
  - Required evidence fields: 

- KPI: **Ergonomie et Design**
  - Decision: 
  - Evidence depth: 
  - Required evidence fields: 

- KPI: **Structure, Navigation et Parcours Client**
  - Decision: 
  - Evidence depth: 
  - Required evidence fields: 

- KPI: **Tunnel de Conversion**
  - Decision: 
  - Evidence depth: 
  - Required evidence fields: 

- KPI: **Mobile Friendly**
  - Decision: 
  - Evidence depth: 
  - Required evidence fields: 

### Contenu

- KPI: **Fraîcheur du Contenu**
  - Decision: 
  - Evidence depth: 
  - Required evidence fields: 

- KPI: **Contenu Fin et Qualité**
  - Decision: 
  - Evidence depth: 
  - Required evidence fields: 

- KPI: **Pages Clés**
  - Decision: 
  - Evidence depth: 
  - Required evidence fields: 

- KPI: **Cannabalisation de Mots-clés**
  - Decision: 
  - Evidence depth: 
  - Required evidence fields: 

- KPI: **CTA Transactionnels Manquants**
  - Decision: 
  - Evidence depth: 
  - Required evidence fields: 

- KPI: **Structure Contenu Cassée**
  - Decision: 
  - Evidence depth: 
  - Required evidence fields: 

- KPI: **Diversité Lexicale**
  - Decision: 
  - Evidence depth: 
  - Required evidence fields: 

### Eco Index

- KPI: **Score Écologique et Impact Climatique**
  - Decision: 
  - Evidence depth: 
  - Required evidence fields: 

### RGPD

- KPI: **Consentement Cookies**
  - Decision: 
  - Evidence depth: 
  - Required evidence fields: 

- KPI: **Politique de Confidentialité**
  - Decision: 
  - Evidence depth: 
  - Required evidence fields: 

- KPI: **Durée de Conservation**
  - Decision: 
  - Evidence depth: 
  - Required evidence fields: 

- KPI: **Minimisation des Données**
  - Decision: 
  - Evidence depth: 
  - Required evidence fields: 

- KPI: **Mentions Légales**
  - Decision: 
  - Evidence depth: 
  - Required evidence fields: 

- KPI: **Droits des Personnes**
  - Decision: 
  - Evidence depth: 
  - Required evidence fields: 

- KPI: **Finalité du Traitement**
  - Decision: 
  - Evidence depth: 
  - Required evidence fields: 

- KPI: **Couverture des Droits RGPD**
  - Decision: 
  - Evidence depth: 
  - Required evidence fields: 

- KPI: **Trackers Avant Consentement**
  - Decision: 
  - Evidence depth: 
  - Required evidence fields: 

- KPI: **Score Politique de Confidentialité**
  - Decision: 
  - Evidence depth: 
  - Required evidence fields: 

## Example evidence contract (Broken Buttons)

- `url`
- `button_text`
- `selector`
- `action_type` (`href|onclick|submit|none`)
- `target` (href/action value if present)
- `failure_reason`
- `status_code` (if request attempted)

## Notes for implementation after approvals

- No KPI behavior changes will be applied until this questionnaire is approved.