# Formulaire Testing V1 - Plan d'Implementation

## 1. Resume

Transformer la fonctionnalite Formulaire Testing en un atelier de test visuel inspire de n8n. Le client doit pouvoir detecter un formulaire, construire plusieurs scenarios, controler chaque etape, suivre l'execution, examiner les preuves, demander de l'aide a l'IA et exporter les resultats.

Le V1 couvre les tests fonctionnels et de validation des formulaires publics. Il n'inclut pas le fuzzing de securite agressif, les paiements, les OTP ou l'execution autonome par l'IA. La resolution automatique des CAPTCHA visuels est prise en charge via l'API 2Captcha.

## 2. Problemes Actuels

- Le canvas ReactFlow est statique : les noeuds ne peuvent pas etre librement ajoutes, connectes, deplaces ou supprimes.
- Un workflow ne supporte pas plusieurs scenarios independants.
- Les valeurs de test sont directement attachees aux champs, sans jeux de donnees versionnes.
- L'execution simulee peut etre presentee comme une execution Chromium reelle.
- `form-workflows-execute` appelle un endpoint `/execute` qui n'existe pas dans le browser pool actuel.
- Le browser pool assure la decouverte, le rendu et les captures, mais pas l'execution durable de workflows.
- Les resultats ne fournissent pas assez de logs, erreurs, reponses reseau, assertions ou captures pour diagnostiquer un echec.
- L'IA se limite principalement a la suggestion de valeurs de champs.
- L'approbation n'est pas liee a une version immutable du scenario.
- Il n'existe pas de planification complete, d'export PDF/CSV specifique ou de creation assistee de ticket Redmine.
- Le role `client` n'est pas explicitement defini dans le modele d'autorisation actuel.
- Les secrets et donnees sensibles ne sont pas geres par un coffre dedie.
- Plusieurs composants contiennent des textes avec des problemes d'encodage.

## 3. Objectif Fonctionnel

Le nouvel atelier doit permettre au client de :

1. Creer un workflow depuis une URL et choisir un environnement.
2. Detecter les formulaires, champs, boutons et contraintes disponibles.
3. Creer plusieurs scenarios independants pour un meme formulaire.
4. Construire librement un workflow visuel.
5. Generer, modifier et versionner les donnees de test.
6. Soumettre une version immutable a l'approbation administrative.
7. Executer tout le scenario, une seule etape ou une portion du graphe.
8. Arreter, relancer ou reprendre une execution.
9. Suivre les etapes, captures et logs presque en direct.
10. Examiner les validations, requetes, reponses et erreurs.
11. Utiliser l'IA pour generer des cas, expliquer les erreurs et proposer des corrections.
12. Conserver, comparer et exporter les resultats.
13. Preparer manuellement un ticket Redmine.
14. Planifier une execution quotidienne ou hebdomadaire.

## 4. Perimetre V1

### Inclus

- Formulaires de contact.
- Newsletter.
- Recherche.
- Inscription.
- Connexion.
- Prise de rendez-vous.
- Resolution automatique de CAPTCHA visuel (image/text) via l'API 2Captcha.
- Detection des CAPTCHA non resolvables (reCAPTCHA v3 enterprise, hCaptcha score eleve) avec blocage propre.
- Upload de fichier.
- Environnements staging et production-safe.
- Tests nominaux, invalides et limites.
- Validation des champs, formats, contraintes et messages.
- Branches conditionnelles simples vrai/faux.
- Execution complete, etape seule et execution depuis une etape.
- Arret cooperatif et nouvelle tentative.
- Canvas ReactFlow libre.
- Plusieurs scenarios par workflow.
- Approbation administrative par version.
- Historique sans expiration automatique.
- Suppression explicite par le client ou l'administrateur.
- Export PDF et CSV.
- Notifications applicatives et email.
- Projet facultatif lors de la creation.
- Creation Redmine seulement lorsqu'un projet est associe.

### Exclu du V1

- Paiement et checkout.
- Fuzzing SQLi, XSS ou tests de securite agressifs.
- Contournement automatique OTP.
- Boucles et expressions avancees.
- Noeuds JavaScript ou HTTP personnalises.
- Prise de controle interactive du navigateur.
- Nettoyage automatique des donnees creees.
- Mise a jour des KPI d'audit.
- Execution ou modification autonome par l'IA.
- Baselines de regression visuelle avancees.

## 5. Parcours Utilisateur

1. Le client cree un workflow avec une URL, un environnement et eventuellement un projet.
2. SnapFlow detecte les formulaires, champs, boutons, contraintes et preuves DOM.
3. Le client choisit le formulaire a tester.
4. SnapFlow cree un premier scenario et propose un graphe initial.
5. Le client ajoute, deplace, relie, configure ou supprime les etapes.
6. L'IA propose des jeux de donnees nominaux, invalides et limites.
7. Le client accepte, modifie ou rejette chaque suggestion.
8. Le client enregistre un brouillon puis cree une version immutable.
9. Cette version est soumise a un administrateur.
10. L'administrateur examine les donnees, les actions et les risques puis approuve ou rejette.
11. Une version approuvee peut etre executee manuellement ou planifiee.
12. L'execution affiche l'etape active, les captures, les logs et les problemes.
13. Le client ouvre le resultat detaille et examine chaque etape.
14. L'IA explique les erreurs et propose des recommandations.
15. Le client exporte le resultat ou prepare un ticket Redmine.

## 6. Architecture Cible

```text
Frontend Form Tester
    |
    | Supabase Edge Functions
    v
Supabase
    - workflows
    - scenarios
    - versions
    - executions
    - logs
    - artifacts
    - schedules
    |
    | durable execution queue
    v
v3-form-executor
    - Playwright
    - Chromium / Obscura CDP
    - node handlers
    - screenshots
    - redaction
    |
    v
Target form
```

Le service `v3-browser-pool` reste responsable du rendu, de la decouverte et des captures generiques. La logique metier d'execution des workflows appartient au nouveau service `v3-form-executor`.

## 7. Modele de Donnees

Creer une migration Supabase dediee, par exemple :

`Front-Snap/supabase/migrations/202606_form_tester_v1.sql`

Le nom final doit respecter l'ordre chronologique reel des migrations au moment de l'implementation.

### 7.1 Etendre `form_workflows`

Ajouter :

- `project_id uuid null`
- `environment text not null default 'staging'`
- `target_url text not null`
- `owner_id uuid`
- `created_by uuid`
- `updated_by uuid`
- `archived_at timestamptz null`

Contraindre `environment` a :

- `staging`
- `production_safe`

La table reste le conteneur principal lie a une URL ou un formulaire detecte.

### 7.2 Ajouter `form_test_scenarios`

Champs minimum :

- `id uuid primary key`
- `workflow_id uuid not null`
- `name text not null`
- `description text`
- `status text`
- `draft_graph jsonb`
- `draft_test_data jsonb`
- `created_by uuid`
- `created_at timestamptz`
- `updated_at timestamptz`
- `deleted_at timestamptz null`

Un workflow peut posseder plusieurs scenarios independants.

### 7.3 Ajouter `form_scenario_versions`

Champs minimum :

- `id uuid primary key`
- `scenario_id uuid not null`
- `version_number integer not null`
- `graph_snapshot jsonb not null`
- `test_data_snapshot jsonb not null`
- `settings_snapshot jsonb not null`
- `checksum text not null`
- `approval_status text not null`
- `submitted_by uuid`
- `submitted_at timestamptz`
- `approved_by uuid null`
- `approved_at timestamptz null`
- `rejection_reason text null`
- `created_at timestamptz`

Etats :

- `draft`
- `pending`
- `approved`
- `rejected`

Une version approuvee ne doit plus pouvoir etre modifiee. Toute modification cree un nouveau brouillon et une nouvelle version.

### 7.4 Etendre les tables de graphe

Pour `workflow_nodes`, `workflow_edges` et `workflow_form_fields` :

- Ajouter `scenario_id`.
- Backfiller les anciennes lignes vers un scenario par defaut.
- Etendre les contraintes de type de noeud.
- Ajouter les parametres specifiques dans un champ JSONB valide.
- Ajouter l'ordre et la position du noeud si absents.

Types de noeuds V1 :

- `navigate`
- `fill`
- `select`
- `check`
- `upload`
- `click`
- `submit`
- `wait`
- `condition`
- `assert`
- `screenshot`
- `inspect_response`

### 7.5 Etendre `workflow_results`

Utiliser cette table comme resume d'execution.

Ajouter :

- `scenario_id uuid`
- `scenario_version_id uuid`
- `execution_mode text`
- `execution_engine text`
- `environment text`
- `start_node_id uuid null`
- `current_node_id uuid null`
- `schedule_id uuid null`
- `queued_at timestamptz`
- `started_at timestamptz null`
- `completed_at timestamptz null`
- `stopped_at timestamptz null`
- `requested_by uuid`
- `failure_reason text null`
- `summary jsonb`

Modes :

- `full`
- `step`
- `from_step`
- `scheduled`

Engines :

- `chromium`
- `obscura`
- `simulated_legacy`

Etats :

- `queued`
- `running`
- `stopping`
- `passed`
- `failed`
- `error`
- `blocked`
- `cancelled`

Supprimer la contrainte qui force actuellement `execution_source = 'chromium'`. Migrer les anciens resultats simules vers `simulated_legacy`.

### 7.6 Ajouter `workflow_step_results`

Champs minimum :

- `id uuid`
- `execution_id uuid`
- `node_id uuid`
- `sequence_number integer`
- `status text`
- `started_at timestamptz`
- `completed_at timestamptz`
- `duration_ms integer`
- `input_redacted jsonb`
- `output_redacted jsonb`
- `assertions jsonb`
- `error_code text null`
- `error_message text null`
- `retry_count integer`
- `captcha_detected boolean default false`
- `captcha_type text null`
- `captcha_solved boolean default false`
- `captcha_solve_duration_ms integer null`
- `captcha_solve_cost numeric(10,6) null`

### 7.7 Ajouter `workflow_logs`

Champs minimum :

- `id uuid`
- `execution_id uuid`
- `step_result_id uuid null`
- `level text`
- `event_type text`
- `message text`
- `details_redacted jsonb`
- `created_at timestamptz`

Niveaux :

- `debug`
- `info`
- `warning`
- `error`

### 7.8 Ajouter `workflow_artifacts`

Champs minimum :

- `id uuid`
- `execution_id uuid`
- `step_result_id uuid null`
- `artifact_type text`
- `storage_path text`
- `mime_type text`
- `size_bytes bigint`
- `redaction_status text`
- `created_at timestamptz`

Types :

- `screenshot`
- `html_snapshot`
- `network_response`
- `uploaded_fixture`
- `downloaded_file`

Creer un bucket Supabase Storage prive et retourner uniquement des URLs signees de courte duree.

### 7.9 Ajouter les tables IA

`workflow_ai_suggestions`

- Suggestion structuree.
- Contexte.
- Confiance.
- Statut `pending`, `accepted`, `edited` ou `rejected`.
- Auteur de la decision.

`workflow_ai_messages`

- Conversation liee au workflow, scenario ou resultat.
- Role `user`, `assistant` ou `system`.
- Contenu redacted.
- References vers les etapes ou erreurs analysees.

### 7.10 Ajouter `workflow_schedules`

Champs minimum :

- `id uuid`
- `workflow_id uuid`
- `scenario_id uuid`
- `scenario_version_id uuid`
- `frequency text`
- `day_of_week integer null`
- `time_of_day time`
- `timezone text`
- `enabled boolean`
- `next_run_at timestamptz`
- `last_run_at timestamptz null`
- `created_by uuid`

Le planning doit toujours pointer vers une version approuvee precise.

### 7.11 Ajouter `workflow_execution_commands`

Champs minimum :

- `id uuid`
- `execution_id uuid`
- `command text`
- `node_id uuid null`
- `status text`
- `requested_by uuid`
- `requested_at timestamptz`
- `processed_at timestamptz null`

Commandes :

- `stop`
- `retry`
- `run_step`
- `run_from`

### 7.12 Secrets et RLS

- Stocker les secrets dans Supabase Vault.
- Stocker uniquement `secret_ref` dans les scenarios.
- Interdire les valeurs de mot de passe, token ou cookie dans les logs.
- Ajouter un role explicite `client`.
- Autoriser le client sur ses workflows et projets.
- Autoriser l'administrateur a approuver et consulter.
- Interdire a un client d'approuver sa propre version.
- Ajouter des quotas par utilisateur ou organisation.
- Conserver les donnees sans expiration automatique.
- Permettre une suppression explicite et auditee.

## 8. Nouveau Service `v3-form-executor`

Creer :

`V3-Microservices/v3-form-executor/`

### 8.1 Fichiers

```text
v3-form-executor/
  main.py
  worker.py
  executor.py
  models.py
  storage.py
  redaction.py
  settings.py
  challenge_resolver.py
  requirements.txt
  Dockerfile
  nodes/
    __init__.py
    navigate.py
    fill.py
    select.py
    check.py
    upload.py
    click.py
    submit.py
    wait.py
    condition.py
    assert_node.py
    screenshot.py
    inspect_response.py
  tests/
    test_executor.py
    test_redaction.py
    test_conditions.py
    test_stop_retry.py
    fixtures/
```

### 8.2 Responsabilites

`main.py`

- Exposer `/health`.
- Exposer des metriques internes si necessaire.
- Ne pas exposer une API publique permettant de contourner les Edge Functions.

`worker.py`

- Recuperer les executions `queued`.
- Verrouiller atomiquement une execution.
- Mettre a jour la progression.
- Verifier les commandes d'arret.
- Garantir qu'une execution n'est traitee qu'une fois.

`executor.py`

- Creer un contexte Playwright isole.
- Charger la version immutable.
- Construire le graphe executable.
- Valider les noeuds et connexions avant execution.
- Executer les handlers dans l'ordre.
- Maintenir l'etat de session entre les etapes.
- Capturer les erreurs et produire un resultat final fiable.

`storage.py`

- Lire les executions et versions.
- Ecrire les step results et logs.
- Uploader les artefacts.
- Generer les references signees.

`redaction.py`

- Masquer mots de passe, tokens, cookies et champs sensibles.
- Nettoyer les headers Authorization et Cookie.
- Redacter les donnees personnelles configurees.
- Etre execute avant toute persistence.

`challenge_resolver.py`

- Detecter le type de CAPTCHA present sur la page via des selecteurs DOM cibles (iframe `g-recaptcha`, `h-captcha`, `.cf-turnstile`, `img[src*="captcha"]`).
- Pour les CAPTCHAs visuels resolvables (image CAPTCHA, reCAPTCHA v2) : soumettre a l'API 2Captcha (`createTask`), polluer la resolution (`getTaskResult` toutes les 5 secondes), puis injecter le token dans le formulaire.
- Pour les CAPTCHAs avances non resolvables (reCAPTCHA v3 enterprise, hCaptcha a score eleve) : retourner `blocked` avec `challenge_type` et `failure_reason`.
- Timeout de resolution configurable via `FORM_EXECUTOR_CAPTCHA_TIMEOUT_S` (defaut 120 secondes).
- Enregistrer `captcha_solved: true`, `captcha_solve_duration_ms` et `captcha_solve_cost` dans le step result. Logger le type de CAPTCHA detecte mais jamais le token resolu.
- La cle API 2Captcha est lue depuis `FORM_EXECUTOR_2CAPTCHA_API_KEY` (variable d'environnement, jamais loggee ni persistee).
- Sans cle API configuree : le CAPTCHA est detecte mais aucune resolution n'est tentee, l'etape devient `blocked` avec `failure_reason: "no_captcha_api_key_configured"`. Aucune erreur levee.

**Fonctions principales :**
- `detect_captcha(page)` → `CaptchaInfo | None`
- `is_solvable(captcha_info)` → `bool`
- `solve_captcha(page, captcha_info, api_key)` → `SolveResult`
- `resolve_or_block(page, api_key, timeout_s)` → `StepResult`

**Endpoints 2Captcha utilises :**
- `POST https://api.2captcha.com/createTask` (types : `RecaptchaV2Task`, `ImageToTextTask`)
- `POST https://api.2captcha.com/getTaskResult` (polling)

### 8.3 Regles d'Execution

- Un contexte navigateur par execution.
- Meme contexte entre les etapes du scenario.
- Capture apres chaque etape significative.
- Mise a jour Realtime de l'etape active.
- Arret cooperatif entre les actions.
- Timeout configurable par noeud et par execution.
- Retry limite et explicite.
- `run_step` rejoue les prerequis necessaires en mode setup.
- `run_from` rejoue le chemin jusqu'au noeud cible sans enregistrer les prerequis comme nouveaux tests.
- Les branches conditionnelles V1 sont limitees a vrai/faux.
- Les uploads utilisent des fixtures autorisees et controlees.
- Aucun payload de securite agressif.
- Aucun resultat simule ne doit etre marque `passed`.
- Une panne de l'executor produit `error`, jamais `failed`.
- Un CAPTCHA detecte declenche automatiquement `challenge_resolver.resolve_or_block()`. Si la resolution reussit, l'execution continue. Si elle echoue (timeout, type non supporte, erreur API), l'etape devient `blocked` avec `challenge_type`, `challenge_url`, `captcha_solve_attempted: true` et `failure_reason`.
- Les screenshots d'une etape bloquee pour CAPTCHA montrent le challenge mais masquent les eventuels tokens.

## 9. Edge Functions

### 9.1 Adapter les fonctions existantes

`Front-Snap/supabase/functions/form-workflows/`

- Ajouter le CRUD des metadonnees du workflow.
- Gerer `project_id` facultatif.
- Ajouter environnement et archivage.
- Appliquer les permissions client/admin.

`form-workflows-detect`

- Retourner formulaires, champs, contraintes et boutons.
- Conserver les sources de detection.
- Retourner une confiance par candidat.
- Retourner une capture et les preuves DOM.
- Ne creer un scenario qu'apres selection du formulaire.

`form-workflows-approve`

- Approuver une version immutable.
- Verifier que l'utilisateur est administrateur.
- Enregistrer approbateur et date.
- Refuser toute modification ulterieure de la version.

`form-workflows-execute`

- Supprimer le mode simule.
- Verifier que la version est approuvee.
- Creer une execution `queued`.
- Retourner immediatement l'identifiant d'execution.

`form-workflows-suggest`

- Conserver la generation de donnees.
- Ajouter cas limites, assertions et recommandations.
- Retourner une structure de suggestion validable.

### 9.2 Ajouter de nouvelles fonctions

- `form-scenarios`
- `form-scenario-versions`
- `form-executions`
- `form-execution-control`
- `form-workflows-ai`
- `form-workflows-export`
- `form-workflow-schedules`
- `form-workflows-ticket`
- `form-captcha-proxy` *(optionnel, recommande pour la production)* — Edge Function qui lit `2CAPTCHA_API_KEY` depuis Supabase Vault et agit comme proxy vers l'API 2Captcha. L'executor appelle cette fonction au lieu d'appeler 2Captcha directement, evitant de stocker la cle dans les variables d'environnement du conteneur. Non requis pour le V1.

### 9.3 Code partage

Etendre :

`Front-Snap/supabase/functions/_shared/formTester.ts`

Ajouter :

- Verification centralisee des roles.
- Verification d'acces au workflow et au projet.
- Validation des statuts.
- Validation des graphes.
- Validation des types de noeuds.
- Redaction des payloads.
- Helpers de creation de version.
- Helpers de creation d'execution.

Mettre a jour :

`Front-Snap/supabase/config.toml`

Ajouter chaque nouvelle fonction et conserver la validation Bearer actuelle tant que l'ensemble des fonctions n'est pas migre vers une autre strategie JWT.

## 10. Frontend

### 10.1 Mettre a jour les types

Fichier :

`Front-Snap/src/lib/form-tester/types.ts`

Ajouter :

- `FormTestScenario`
- `ScenarioVersion`
- `WorkflowNodeType`
- `WorkflowExecution`
- `WorkflowStepResult`
- `WorkflowLog`
- `WorkflowArtifact`
- `AISuggestion`
- `WorkflowSchedule`
- `ExecutionCommand`

Remplacer les anciens statuts et types limites par les contrats V1.

Ajouter des schemas Zod afin de valider toutes les reponses d'API avant utilisation.

### 10.2 Mettre a jour l'API frontend

Fichier :

`Front-Snap/src/lib/form-tester/api.ts`

Ajouter les appels :

- Lister et creer les scenarios.
- Sauvegarder le brouillon.
- Creer une version.
- Soumettre et approuver une version.
- Lancer une execution.
- Lancer une etape.
- Lancer depuis une etape.
- Arreter et relancer.
- Recuperer les step results, logs et artefacts.
- Demander une suggestion IA.
- Accepter ou rejeter une suggestion.
- Gerer les plannings.
- Exporter PDF/CSV.
- Preparer un ticket Redmine.

### 10.3 Refaire `FormTesterPage.tsx`

Fichier :

`Front-Snap/src/pages/FormTesterPage.tsx`

- Afficher les workflows sous forme de dashboard.
- Afficher URL, environnement, projet, scenarios et derniere execution.
- Ajouter creation par URL.
- Rendre le projet facultatif.
- Afficher les plannings actifs.
- Supprimer l'interface de creation dupliquee.
- Corriger tous les textes mal encodes.

### 10.4 Refaire `FormTesterBuilderPage.tsx`

Fichier :

`Front-Snap/src/pages/FormTesterBuilderPage.tsx`

- Charger workflow, scenarios, brouillon et versions.
- Construire l'interface trois panneaux.
- Ajouter la barre d'execution.
- Afficher l'etat de sauvegarde.
- Empecher l'execution d'un brouillon non approuve.
- Afficher les risques production-safe.
- Ajouter un avertissement explicite pour les actions avec effet de bord.

### 10.5 Refactorer `WorkflowBuilder.tsx`

Fichier :

`Front-Snap/src/components/form-tester/WorkflowBuilder.tsx`

- Transformer le composant en shell d'orchestration.
- Activer `nodesDraggable`.
- Activer `nodesConnectable`.
- Ajouter creation, connexion, suppression et repositionnement.
- Ajouter validation des connexions.
- Interdire les cycles non supportes.
- Limiter un noeud Condition a deux sorties.
- Gerer les changements non sauvegardes.
- Conserver position et zoom du canvas.

### 10.6 Creer les composants d'atelier

Sous :

`Front-Snap/src/components/form-tester/`

Creer :

- `ScenarioSidebar.tsx`
- `NodePalette.tsx`
- `WorkflowCanvas.tsx`
- `PreviewPanel.tsx`
- `ExecutionToolbar.tsx`
- `NodeInspector.tsx`
- `AIAssistantPanel.tsx`
- `ExecutionLogsPanel.tsx`
- `IssuesPanel.tsx`
- `VersionApprovalPanel.tsx`
- `ScheduleDialog.tsx`
- `TestDataPanel.tsx`
- `ArtifactViewer.tsx`
- `ExecutionTimeline.tsx`

Disposition :

- Gauche : scenarios, versions et palette.
- Centre : canvas, preview et donnees.
- Droite : configuration, IA, logs, problemes et preuves.

### 10.7 Creer les noeuds ReactFlow

Sous :

`Front-Snap/src/components/form-tester/nodes/`

Creer ou adapter :

- `NavigateNode.tsx`
- `FillNode.tsx`
- `SelectNode.tsx`
- `CheckNode.tsx`
- `UploadNode.tsx`
- `ClickNode.tsx`
- `SubmitNode.tsx`
- `WaitNode.tsx`
- `ConditionNode.tsx`
- `AssertNode.tsx`
- `ScreenshotNode.tsx`
- `InspectResponseNode.tsx`

Chaque noeud doit afficher :

- Nom.
- Type.
- Etat de configuration.
- Etat de la derniere execution.
- Erreur courte si presente.
- Entrees et sorties valides.

### 10.8 Refaire la page de resultats

Fichier :

`Front-Snap/src/pages/FormTesterResultsPage.tsx`

Ajouter :

- Resume global.
- Statut et duree.
- Scenario et version.
- Environnement et moteur.
- Timeline des etapes.
- Detail entree/sortie redacted.
- Assertions attendues et observees.
- Logs filtres par niveau.
- Captures et artefacts.
- Comparaison avec une execution precedente.
- Suggestions IA.
- Export PDF/CSV.
- Creation assistee d'un ticket Redmine.

### 10.9 Diviser les hooks

Creer :

- `useWorkflowEditor.ts`
- `useExecutionStream.ts`
- `useScenarioVersions.ts`
- `useFormAI.ts`
- `useFormSchedules.ts`

Responsabilites :

- `useWorkflowEditor` : graphe, undo/redo, sauvegarde.
- `useExecutionStream` : Realtime, progression, logs.
- `useScenarioVersions` : brouillons, versions, approbation.
- `useFormAI` : conversation et suggestions.
- `useFormSchedules` : CRUD des plannings.

## 11. Assistance IA

L'IA doit pouvoir :

- Generer des valeurs realistes.
- Generer des cas nominaux, invalides et limites.
- Detecter les champs obligatoires non signales.
- Detecter les formats ou contraintes incoherents.
- Proposer des assertions.
- Expliquer une etape echouee.
- Resumer les logs reseau.
- Identifier les validations uniquement cote client.
- Recommander des ameliorations de champs et messages.
- Resumer une execution.
- Preparer le contenu d'un ticket Redmine.
- Generer un rapport final.

Chaque suggestion doit contenir :

- `suggestion_type`
- `title`
- `explanation`
- `confidence`
- `proposed_change`
- `evidence_refs`
- `status`

L'utilisateur doit toujours choisir :

- Accepter.
- Modifier puis accepter.
- Rejeter.

L'IA ne peut jamais :

- Modifier directement le graphe.
- Lancer une execution.
- Approuver une version.
- Creer automatiquement un ticket.

L'IA peut suggerer si un CAPTCHA detecte est probablement resolvable ou non, mais ne peut ni le resoudre ni contourner un OTP.

## 12. Exports et Redmine

### 12.1 PDF

Creer :

- `Front-Snap/src/lib/generateFormTestPdf.tsx`
- `Front-Snap/src/components/form-tester/pdf/FormTestDocument.tsx`

Le PDF contient :

- Workflow, scenario et version.
- URL et environnement.
- Date, duree et moteur.
- Resume.
- Etapes et statuts.
- Assertions.
- Erreurs et raisons de blocage.
- Captures autorisees.
- Donnees redacted.
- Statut de resolution CAPTCHA par etape (resolu / non resolu / bloque).
- Duree de resolution et cout estime (visible uniquement pour l'admin).
- Suggestions et recommandations.

### 12.2 CSV

Creer :

`Front-Snap/src/lib/form-tester/exportCsv.ts`

Exporter au minimum :

- Execution.
- Scenario.
- Version.
- Etape.
- Type.
- Statut.
- Duree.
- Erreur.
- Assertion attendue.
- Valeur observee redacted.

### 12.3 Redmine

Reutiliser :

`Front-Snap/src/services/redmineService.ts`

Ajouter un adaptateur Form Tester qui prepare :

- Titre.
- Description.
- URL.
- Scenario et version.
- Etape echouee.
- Resultat attendu.
- Resultat observe.
- Erreur.
- Captures autorisees.
- Lien vers l'execution SnapFlow.

La creation reste manuelle. Le bouton est desactive si aucun projet n'est associe.

## 13. Planification et Notifications

- Frequences V1 : quotidienne et hebdomadaire.
- Fuseau horaire obligatoire.
- Version approuvee epinglee.
- Une nouvelle version ne remplace pas automatiquement la version planifiee.
- Dispatcher les executions via cron Supabase ou un worker dedie.
- Envoyer une notification applicative et un email apres succes, echec, erreur, blocage ou resolution CAPTCHA.
- Une execution planifiee rencontrant un CAPTCHA tente une resolution automatique via 2Captcha. En cas d'echec, l'etape devient `blocked` avec preuve et notification. En cas de succes, l'execution continue normalement.
- Afficher la prochaine execution et la derniere execution dans le dashboard.
- Desactiver automatiquement un planning si sa version ou son workflow est supprime.

## 14. Infrastructure

### Docker Compose

Modifier :

`V3-Microservices/docker-compose.yml`

Ajouter `v3-form-executor` avec :

- Image Playwright compatible.
- Variables Supabase.
- Acces au stockage.
- Configuration Chromium/Obscura.
- Healthcheck.
- Limites CPU et memoire.
- Dependances minimales.

### Kubernetes

Ajouter sous `k8s/02-services/form-executor/` :

- `deployment.yaml`
- `service.yaml`
- `configmap.yaml` si necessaire

Ajouter :

- HPA dans `k8s/03-autoscaling/`.
- NetworkPolicy.
- ServiceMonitor et alertes.
- Secrets dans le mecanisme existant.

### Variables

Mettre a jour les exemples d'environnement avec :

- `FORM_EXECUTOR_POLL_INTERVAL`
- `FORM_EXECUTOR_CONCURRENCY`
- `FORM_EXECUTOR_BROWSER_ENGINE`
- `FORM_EXECUTOR_DEFAULT_TIMEOUT`
- `FORM_EXECUTOR_MAX_EXECUTION_TIME`
- `FORM_EXECUTOR_ARTIFACT_BUCKET`
- `OBSCURA_CDP_URL`
- Variables Supabase service role.
- `FORM_EXECUTOR_2CAPTCHA_API_KEY` — cle API 2Captcha (stockee dans Supabase Vault, injectee dans K8s secrets ; jamais commitee dans Git).
- `FORM_EXECUTOR_CAPTCHA_TIMEOUT_S` — timeout maximum pour la resolution d'un CAPTCHA (defaut 120).
- `FORM_EXECUTOR_CAPTCHA_POLL_INTERVAL_S` — intervalle de polling 2Captcha (defaut 5).

## 15. Strategie de Migration

1. Creer un scenario par defaut pour chaque workflow existant.
2. Rattacher les noeuds, champs et edges existants a ce scenario.
3. Creer une version initiale depuis le graphe existant.
4. Marquer les anciennes executions simulees `simulated_legacy`.
5. Ne pas considerer les anciennes executions comme preuves de production.
6. Conserver la lecture des anciennes donnees pendant la transition.
7. Activer le nouveau moteur derriere un feature flag.
8. Migrer progressivement les utilisateurs.
9. Supprimer la simulation uniquement apres validation du nouvel executor.

## 16. Ordre d'Implementation

### Phase 1 - Contrats et migration

- Finaliser les types TypeScript et Python.
- Ajouter les tables et contraintes.
- Ajouter le role client et les RLS.
- Backfiller les workflows existants.
- Corriger `execution_source`.

Critere de sortie :

- Anciennes donnees lisibles.
- Nouveau schema deployable sans perte.
- Tests RLS passes.

### Phase 2 - Executor

- Creer `v3-form-executor`.
- Implementer les handlers V1.
- Ajouter redaction et artefacts.
- Ajouter stop, retry, run step et run from.
- Implemeter `challenge_resolver.py` avec integration 2Captcha (detection, resolution, fallback sans cle).
- Ajouter les fixtures HTML locales incluant des pages avec CAPTCHA (image, reCAPTCHA v2).
- Ajouter les tests de detection et resolution CAPTCHA avec mock 2Captcha.
- Ajouter les tests de blocage pour CAPTCHA non resolvables et fallback sans cle API.

Critere de sortie :

- Les scenarios de contact, login et upload passent sur fixtures.
- Les erreurs sont visibles par etape.
- Aucun secret n'apparait dans les logs.

### Phase 3 - Orchestration

- Remplacer la simulation Edge Function.
- Ajouter file durable et commandes.
- Ajouter Realtime.
- Ajouter validation d'approbation.

## 18. Gestion des Secrets 2Captcha

### 18.1 Stockage de la cle API

La cle API 2Captcha ne doit **jamais** etre commitee dans Git, ni apparaître dans les logs, artefacts, step results ou notifications.

**Developpement local :**
```powershell
$env:FORM_EXECUTOR_2CAPTCHA_API_KEY="<cle-2captcha>"
docker compose --profile form-tester up v3-form-executor
```

**Deploiement k3s :**
```powershell
kubectl create secret generic form-executor-secrets \
  --from-literal=2CAPTCHA_API_KEY="<cle-2captcha>" \
  -n snapflow-prod
```

**Edge Functions (si proxy utilise) :**
```powershell
npx supabase secrets set 2CAPTCHA_API_KEY="<cle-2captcha>"
```

### 18.2 Fallback sans cle API

Si `FORM_EXECUTOR_2CAPTCHA_API_KEY` est vide ou absente :
- `challenge_resolver` detecte le CAPTCHA mais ne tente pas de resolution.
- L'etape est marquee `blocked` avec `failure_reason: "no_captcha_api_key_configured"`.
- Le comportement est identique au V1 sans 2Captcha (blocage propre avec preuve et notification).
- Aucune erreur n'est levee — le workflow continue avec l'etape bloquee.

### 18.3 Rotation de cle

- La cle 2Captcha peut etre changee sans redeploiement en mettant a jour le secret K8s.
- L'executor lit la variable d'environnement a chaque nouvelle execution (pas de cache).
- Documenter la procedure de rotation dans le RUNBOOK.

### 18.4 Cout

- Le cout de chaque resolution CAPTCHA est enregistre dans `workflow_step_results.captcha_solve_cost`.
- Aucun budget maximum n'est applique en V1. Les couts sont consultables par l'administrateur uniquement.
- Les CAPTCHAs echoues (timeout, type non supporte) ne generent pas de cout 2Captcha (seule la creation de tache est facturable ; le polling ne l'est pas).

Critere de sortie :

- Une version non approuvee est refusee.
- Une version approuvee est executee une seule fois.
- Stop et retry fonctionnent.

### Phase 4 - Editeur frontend

- Refaire les trois panneaux.
- Activer le canvas libre.
- Ajouter scenarios et versions.
- Ajouter preview hybride.
- Ajouter barre d'execution.

Critere de sortie :

- Creation et edition completes sans modification manuelle de JSON.
- Sauvegarde et rechargement conservent le graphe.

### Phase 5 - Resultats et IA

- Ajouter timeline, logs, captures et assertions.
- Etendre le copilote.
- Ajouter comparaison d'executions.

Critere de sortie :

- Tout echec est diagnostiquable depuis l'interface.
- Aucune suggestion IA n'est appliquee sans validation.

### Phase 6 - Export, Redmine et planning

- Ajouter PDF et CSV.
- Ajouter creation assistee Redmine.
- Ajouter planning et notifications.

Critere de sortie :

- Exports complets et redacted.
- Ticket correctement pre-rempli.
- Planning execute la version epinglee.

### Phase 7 - Durcissement et rollout

- Ajouter quotas.
- Ajouter monitoring.
- Tester production-safe.
- Activer par groupe d'utilisateurs.
- Retirer la simulation.

Critere de sortie :

- Aucun faux succes.
- Monitoring et alertes disponibles.
- Rollback documente.

## 17. Tests

### Tests Executor

- Navigation valide et timeout.
- Remplissage texte, email, nombre et date.
- Select, checkbox et radio.
- Upload valide et type interdit.
- Submit succes et erreur.
- Assertions DOM, URL, texte et reseau.
- Conditions vrai/faux.
- Stop cooperatif.
- Retry.
- Run step.
- Run from.
- CAPTCHA/OTP retourne `blocked`.
- Executor indisponible retourne `error`.
- Redaction des mots de passe, cookies et tokens.

### Tests Edge Functions

- Permissions client/admin.
- Creation de scenario.
- Version immutable.
- Approbation admin obligatoire.
- Execution refusee pour brouillon.
- Commandes d'execution.
- Projet facultatif.
- Ticket refuse sans projet.
- Planning refuse une version non approuvee.

### Tests Frontend

- Creation et suppression de noeuds.
- Connexion et deplacement.
- Validation des branches.
- Sauvegarde et restauration.
- Changement de scenario.
- Soumission et approbation.
- Affichage Realtime.
- Arret et retry.
- Affichage des artefacts.
- Acceptation/rejet IA.
- Export PDF/CSV.
- Redmine desactive sans projet.

### Scenarios E2E

- Contact valide et invalide.
- Newsletter avec email incorrect.
- Recherche avec et sans resultat.
- Inscription avec contraintes.
- Login succes et echec.
- Rendez-vous conditionnel.
- Upload valide et interdit.
- Branche conditionnelle vrai/faux.
- Execution planifiee.

### Commandes de validation

```powershell
cd Front-Snap
npm run build
npm test
```

```powershell
cd V3-Microservices/v3-form-executor
python -m pytest tests -q
```

Executer egalement les tests Deno des Edge Functions selon la commande standard du projet.

## 18. Criteres d'Acceptation V1

- Aucun resultat simule n'est presente comme test reel.
- Plusieurs scenarios sont possibles par workflow.
- Seules les versions approuvees sont executables.
- Toutes les etapes sont controlables depuis l'interface.
- Les executions completes, par etape et depuis une etape fonctionnent.
- Stop et retry sont disponibles.
- Chaque echec contient une cause, une etape et des preuves.
- Les logs et artefacts sont redacted.
- Le client peut utiliser la fonctionnalite sans intervention technique.
- Les suggestions IA exigent une validation humaine.
- Les exports PDF/CSV fonctionnent.
- Le ticket Redmine est manuel et assiste.
- Les plannings utilisent une version approuvee epinglee.
- Les formulaires publics V1 disposent de tests E2E.
- Aucun KPI d'audit existant n'est modifie.

## 19. Decisions et Hypotheses Figees

- Audience principale : clients autonomes.
- Nouveau role : `client`.
- Projet facultatif.
- Association Redmine obligatoire uniquement pour creer un ticket.
- Canvas libre inspire de n8n.
- Plusieurs scenarios independants.
- Approbation administrative par version immutable.
- Tests fonctionnels et de validation uniquement.
- Production autorisee en mode production-safe avec avertissement.
- Les effets de bord sont autorises apres confirmation explicite.
- Pas de nettoyage automatique V1.
- Historique sans expiration automatique.
- Suppression explicite par client ou administrateur.
- Preview statique au repos et captures quasi temps reel pendant l'execution.
- IA copilote complet, jamais autonome.
- CAPTCHA/OTP bloques jusqu'a definition d'une strategie fournisseur et juridique.
- Integration separee des KPI d'audit.

## 20. Backlog Operationnel par Phases

Cycle obligatoire pour chaque phase :

1. Implementer uniquement la phase courante.
2. Lancer les tests de la phase.
3. Corriger les regressions.
4. Valider localement les criteres de sortie.
5. S'arreter et confirmer avant de passer a la phase suivante.

### Phase 0 - Stabilisation avant refonte

Objectif : empecher les faux resultats avant de construire la nouvelle UI.

- [x] Identifier les endroits ou une execution simulee est affichee comme reelle.
- [x] Remplacer `execution_source: 'chromium'` simule par `simulated_legacy`.
- [x] Elargir la contrainte DB `workflow_results_execution_source_check`.
- [x] Adapter les types frontend `ExecutionResponse` et `WorkflowResult`.
- [x] Afficher clairement `Simulation legacy`, `Chromium reel`, `Executor indisponible`.
- [x] Corriger les textes mojibake visibles dans Form Tester.
- [x] Empecher tout wording qui laisse croire qu'une simulation est un test navigateur reel.

Tests Phase 0 :

- [x] Test Edge Function : simulation retourne `simulated_legacy`.
- [x] Test frontend : resultat simule affiche un badge non reel.
- [x] `npm run build`.
- [x] Tests Supabase/Edge si disponibles.

Validation Phase 0 :

- [x] Aucun resultat simule ne peut etre confondu avec Chromium.
- [x] L'ancienne fonctionnalite reste utilisable.
- [x] Aucune refonte UI lourde n'est encore engagee.

### Phase 1 - Contrats, scenarios et versions

- [x] Creer migration Supabase Form Tester V1.
- [x] Ajouter `form_test_scenarios`.
- [x] Ajouter `form_scenario_versions`.
- [x] Ajouter `scenario_id` aux nodes, edges et fields.
- [x] Ajouter `scenario_id` et `scenario_version_id` aux results.
- [x] Backfiller un scenario par defaut pour chaque workflow existant.
- [x] Creer une version initiale depuis chaque workflow existant.
- [x] Ajouter checksum de version.
- [x] Interdire la modification d'une version approuvee.
- [x] Ajouter statuts `draft`, `pending`, `approved`, `rejected`.
- [x] Adapter RLS client/admin.
- [x] Empecher un client d'approuver sa propre version.
- [x] Adapter `_shared/formTester.ts`.
- [x] Adapter `form-workflows`.
- [x] Adapter `form-workflows-approve`.
- [x] Adapter `form-workflows-execute`.

Tests Phase 1 :

- [x] Migration sur DB locale propre.
- [x] Migration sur DB locale avec anciens workflows.
- [x] Tests RLS client/admin.
- [x] Test version approuvee immutable.
- [x] Test execution refusee si version non approuvee.

Validation Phase 1 :

- [x] Anciennes donnees lisibles.
- [x] Plusieurs scenarios par workflow.
- [x] Une execution pointe vers une version precise.

### Phase 2 - Queue d'execution et resultats par etape

- [x] Ajouter `workflow_step_results`.
- [x] Ajouter `workflow_logs`.
- [x] Ajouter `workflow_artifacts`.
- [x] Ajouter `workflow_execution_commands`.
- [x] Ajouter statuts `queued`, `running`, `stopping`, `passed`, `failed`, `error`, `blocked`, `cancelled`.
- [x] Modifier `form-workflows-execute` pour creer une execution queued.
- [x] Ajouter `form-executions`.
- [x] Ajouter `form-execution-control`.
- [x] Ajouter redaction minimale avant persistence.
- [x] Preparer Supabase Realtime.

Tests Phase 2 :

- [ ] Test creation execution queued.
- [ ] Test commande stop.
- [ ] Test logs lisibles par proprietaire.
- [ ] Test anciens resultats legacy.
- [x] `npm run build`.

Validation Phase 2 :

- [x] L'UI peut afficher une execution progressive.
- [x] Les resultats ne sont plus un blob unique.

Etat de validation locale Phase 2 au 2026-06-08 :

- [x] 21 tests frontend et contractuels cibles passent.
- [x] Build production Vite valide.
- [ ] Migration Supabase locale appliquee par l'utilisateur.
- [ ] Script d'integration `scripts/test-form-tester-phase2.mjs` valide sur la base locale.

Correctif de compatibilite ajoute apres validation UI :

- [x] Normaliser les resultats historiques sans `execution_source`.
- [x] Ne pas afficher `0 ms` comme une duree mesuree.
- [x] Remplacer le faux verdict `Erreur` par `Non interpretable` lorsque la tentative ne contient aucune preuve.
- [x] Ajouter un backfill `legacy_unknown` sans attribuer abusivement Chromium.
- [x] Conserver le polling lorsque Supabase Realtime redemarre temporairement.

### Phase 3 - Nouveau service `v3-form-executor`

- [x] Creer `V3-Microservices/v3-form-executor/`.
- [x] Ajouter worker, executor, storage, redaction et settings.
- [x] Implementer les handlers V1.
- [x] Valider le graphe avant execution.
- [x] Utiliser un contexte navigateur isole par execution.
- [x] Ecrire step results, logs et artefacts redacted.
- [x] Retourner `blocked` sur CAPTCHA/OTP.
- [x] Retourner `error` sur panne executor.
- [x] Ne jamais retourner `passed` pour une execution non jouee.
- [x] Ajouter Dockerfile et service compose.

Tests Phase 3 :

- [x] Fixtures contact, login, upload.
- [x] Test CAPTCHA/OTP blocked.
- [x] Test stop/retry/run_step/run_from.
- [x] Test redaction.
- [x] `python -m pytest tests -q`.

Validation Phase 3 :

- [x] Au moins 3 types de formulaires V1 passent sur fixtures.
- [x] Chaque echec montre etape, erreur et preuve.

Checkpoint local Phase 3 - 2026-06-08 :

- `12 passed` dans `v3-form-executor/tests`.
- Contact, login et upload executes dans un vrai Chromium local.
- CAPTCHA et OTP retournes en `blocked`, sans bypass.
- Un submit sans effet observable retourne `failed` avec code, screenshot et snapshot HTML.
- Une panne du moteur retourne `error`, jamais un faux succes.
- `step` et `from_step` rejouent les prerequis en setup sans les presenter comme nouveaux tests.
- Le worker ne reclame que les lignes `queued` avec `execution_source=pending_executor` et version approuvee referencee.
- Aucun Docker ni Supabase n'a ete demarre pendant cette validation.

### Phase 4 - Orchestration complete

- [x] Brancher queue, executor et Edge Functions.
- [x] Ajouter lock atomique.
- [x] Traiter stop/retry/run_step/run_from.
- [ ] Differencier `failed` metier et `error` technique.
- [ ] Ajouter notifications.
- [ ] Ajouter timeouts et quotas.
- [ ] Ajouter feature flag executor.

Tests Phase 4 :

- [x] Execution approuvee jouee une seule fois.
- [x] Deux workers ne prennent pas la meme execution.
- [x] Stop pendant running fonctionne.
- [ ] Executor indisponible devient `error`.

Validation Phase 4 :

- [x] L'execution reelle remplace la simulation.
- [ ] Rollback possible via feature flag.

Checkpoint local Phase 4 - 2026-06-08 :

- Execution reelle Chromium validee sur `https://httpbin.org/forms/post`.
- Soumission complete passee avec `14/14` etapes, `final_url=https://httpbin.org/post`, et `2` requetes reseau.
- Les commandes utilisateur sont exposees dans la page resultats :
  - relancer toute une execution terminee ;
  - executer une seule etape ;
  - executer depuis une etape.
- Le worker cree deja une nouvelle execution `queued` pour `retry`, `run_step` et `run_from`.
- Tests frontend cibles Phase 4 : `23 passed`.
- Build frontend Vite valide.

### Phase 5 - Refonte UI n8n-like

- [ ] Refaire dashboard Form Tester.
- [x] Refaire builder en trois panneaux.
- [x] Activer canvas libre ReactFlow.
- [ ] Ajouter scenarios, versions, palette, inspector, logs, IA et issues.
- [x] Ajouter scenarios, palette, inspector, logs live et generation de cas IA.
- [ ] Ajouter versions et panneau issues dans le nouveau builder.
- [x] Ajouter validation des connexions et cycles.
- [x] Ajouter etat sauvegarde.
- [ ] Ajouter warnings production-safe.
- [ ] Nettoyer tous les textes mojibake.

Tests Phase 5 :

- [x] Creation/suppression/connexion/deplacement de noeuds.
- [x] Sauvegarde et reload du graphe.
- [x] Brouillon executable sans approbation en mode V1 non bloquant.
- [x] `npm run build`.
- [x] Tests frontend cibles.

Validation Phase 5 :

- [x] L'utilisateur construit les conditions et assertions sans JSON.
- [x] L'UI ne propose aucune action non supportee backend.

Checkpoint local Phase 5 - Branches et cas IA - 2026-06-08 :

- Branches typees `true/false`, `success/failure` persistees dans les snapshots.
- Routage graphe reel dans Chromium; les branches non choisies ne sont pas executees.
- Creation, suppression et connexion de noeuds depuis ReactFlow.
- Protection frontend et backend contre les cycles.
- Re-detection bloquee si elle risque d'effacer un graphe personnalise.
- Generation IA avec fallback heuristique de cas nominaux, invalides et limites.
- Clonage independant des scenarios, valeurs de champs et identifiants de noeuds.
- Execution groupee des cas et matrice resultat attendu/resultat observe.
- Cas de validation navigateur attendu considere comme un test reussi.
- Tests executor : `18 passed`.
- Tests frontend cibles : `28 passed`.
- Build frontend Vite valide.

Checkpoint local Phase 5 - Generation IA dynamique V2 - 2026-06-10 :

- La detection produit un `FormProfile` versionne avec type metier, confiance,
  methode, action, selecteur de soumission, contraintes, options, etapes,
  conditions, preuves candidates et effets possibles.
- L'exploration navigateur est bornee a 6 etapes, 8 chemins et 24 interactions,
  recharge un contexte propre entre les chemins et ne soumet pas le formulaire.
- La bibliotheque deterministe genere entre 4 et 12 cas selon le type de
  formulaire et ses capacites speciales; le LLM enrichit ce socle sans pouvoir
  inventer de champ, d'option, de selecteur ou de type de signal.
- Le plan V2 distingue `success`, `validation_error`, `business_rejection`,
  `server_error` et `blocked`, avec valeurs, parcours, oracle, effets possibles
  et raisonnement inspectables avant application.
- Le compilateur serveur valide champs, options, groupes radio, seuils, signaux,
  parcours et graphes avant une application atomique par
  `form_test_apply_generated_suite()`.
- Chaque scenario compile contient une chaine post-soumission executable :
  `submit -> inspect_response -> condition -> assert/screenshot`.
- L'oracle pondere URL, DOM, validation, reponse HTTP, formulaire, texte et
  reseau. Une preuve entre 0.40 et 0.64 produit `inconclusive`, jamais un faux
  echec.
- `submit.py` collecte les observations V2 sans interrompre le graphe; les
  scenarios historiques conservent leur comportement.
- L'aperçu UI permet de corriger le type, les valeurs, le resultat attendu,
  l'activation des preuves et les seuils avant d'appliquer la matrice.
- L'Edge Function d'execution cree un snapshot approuve non nul avant la mise
  en file, ce qui respecte le contrat strict du worker.
- Le rollout est protege par `FORM_TESTER_AI_BRANCHING_V2`; la valeur `false`
  restaure le chemin historique.
- Tests executor : `21 passed`.
- Tests browser pool : `9 passed`.
- Tests frontend cibles : `28 passed`.
- Build frontend Vite valide.

### Phase 6 - Resultats, logs, IA et debug

- [ ] Refaire page resultats.
- [ ] Ajouter timeline, logs, captures, assertions, reseau.
- [ ] Ajouter comparaison d'executions.
- [ ] Ajouter IA explicative.
- [ ] Enregistrer suggestions et messages IA.
- [ ] Interdire toute application automatique par l'IA.

Tests Phase 6 :

- [ ] Timeline.
- [ ] Logs filtres.
- [ ] Artefacts signes.
- [ ] Suggestions IA accept/reject.
- [ ] Donnees sensibles masquees.

Validation Phase 6 :

- [ ] Un echec est diagnostiquable sans JSON brut.

### Phase 7 - Exports, Redmine et planning

- [ ] Ajouter PDF Form Tester.
- [ ] Ajouter CSV.
- [ ] Ajouter adaptateur Redmine.
- [x] Ajouter `workflow_schedules`.
- [x] Ajouter dispatcher planifie.
- [x] Ajouter notifications planning.
- [x] Rendre la creation workflow + scenario atomique.
- [x] Separer `Mes workflows` de la `File de validation`.
- [x] Ajouter les snapshots approuves et epingles par planning.
- [x] Ajouter le panneau planning dans le builder.
- [x] Ajouter les executions Form Tester au calendrier global.
- [x] Configurer Gemini cote serveur avec fallback heuristique.
- [x] Ajouter un diagnostic Gemini sans exposition du secret.

Tests Phase 7 :

- [ ] PDF redacted.
- [ ] CSV complet.
- [ ] Redmine refuse sans projet.
- [x] Planning refuse version non approuvee.
- [x] Planning execute version epinglee.

Validation Phase 7 :

- [ ] Export client utilisable.
- [ ] Ticket Redmine actionnable.
- [x] Planning fiable.

Checkpoint local Phase 7 - Persistance, planning et Gemini - 2026-06-12 :

- Migration `20260612020000_form_tester_persistence_scheduling.sql` appliquee localement.
- `supabase db lint --local --level warning` : aucune erreur de schema.
- Smoke test transactionnel : workflow + scenario crees atomiquement, puis rollback.
- Smoke test transactionnel : planning quotidien avec snapshot approuve epingle, puis rollback.
- Smoke test end-to-end : execution planifiee reclamee par Chromium et terminee `passed`.
- Run de planning synchronise en `completed` et notification creee.
- Suppression du workflow fixture validee apres correction du guard de versions approuvees.
- Recurrences quotidienne et mensuelle verifiees avec timezone `Europe/Paris`.
- Cron `form-tester-schedule-dispatch` actif chaque minute.
- Tests frontend cibles : `27 passed`.
- Tests executor contractuels : `8 passed`.
- Build frontend production : valide.
- Suite executor hors CAPTCHA : valide.
- Suite CAPTCHA utilisateur : 14 tests async non executes car `pytest-asyncio` manque dans l'environnement local; aucune modification CAPTCHA effectuee.

### Phase 8 - Durcissement, monitoring et rollout

- [ ] Ajouter metriques executor.
- [ ] Ajouter alertes.
- [ ] Ajouter quotas.
- [ ] Ajouter limites max steps/duration/artifacts.
- [ ] Ajouter rollback documente.
- [ ] Ajouter feature flag par groupe.
- [ ] Verifier aucune modification KPI audit.
- [ ] Rediger guide utilisateur.

Tests Phase 8 :

- [ ] Quotas.
- [ ] Timeout global.
- [ ] Limite artefacts.
- [ ] Rollback flag.
- [ ] Monitoring endpoint.

Validation Phase 8 :

- [ ] Deploiement progressif possible.
- [ ] Monitoring disponible.
- [ ] Aucun faux succes.
