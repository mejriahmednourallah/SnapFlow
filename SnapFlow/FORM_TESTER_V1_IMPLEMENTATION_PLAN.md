# Formulaire Testing V1 - Plan d'Implementation

## 1. Resume

Transformer la fonctionnalite Formulaire Testing en un atelier de test visuel inspire de n8n. Le client doit pouvoir detecter un formulaire, construire plusieurs scenarios, controler chaque etape, suivre l'execution, examiner les preuves, demander de l'aide a l'IA et exporter les resultats.

Le V1 couvre les tests fonctionnels et de validation des formulaires publics. Il n'inclut pas le fuzzing de securite agressif, les paiements, le contournement automatique des CAPTCHA/OTP ou l'execution autonome par l'IA.

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
- Contournement automatique CAPTCHA ou OTP.
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

- Definir une interface pour CAPTCHA/OTP.
- Ne fournir aucun contournement automatique en V1.
- Retourner `blocked` avec `challenge_type` et `failure_reason`.

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
- Contourner un CAPTCHA ou OTP.

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
- Envoyer une notification applicative et un email apres succes, echec, erreur ou blocage.
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
- Ajouter les fixtures HTML locales.

Critere de sortie :

- Les scenarios de contact, login et upload passent sur fixtures.
- Les erreurs sont visibles par etape.
- Aucun secret n'apparait dans les logs.

### Phase 3 - Orchestration

- Remplacer la simulation Edge Function.
- Ajouter file durable et commandes.
- Ajouter Realtime.
- Ajouter validation d'approbation.

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
