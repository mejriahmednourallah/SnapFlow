# SnapFlow PlantUML Diagrams

This document contains ready-to-render PlantUML diagrams for SnapFlow.

## Class Diagram

```plantuml
@startuml SnapFlow_Class_Diagram
title SnapFlow - Class / Domain Architecture Diagram

skinparam classAttributeIconSize 0
skinparam packageStyle rectangle
skinparam shadowing false
skinparam linetype ortho

class "Admin" as Admin <<actor>>
class "Chargé de projet" as PM <<actor>>
class "Client externe" as Client <<actor>>

package "Front-Snap React SPA" {
  class AuthProvider {
    +session
    +user
    +role
    +signIn()
    +signOut()
    +loadRole()
  }

  class AppLayout {
    +protectedRoutes
    +navigation
  }

  class OverviewPage {
    +loadDashboardStats()
    +renderAuditSummary()
  }

  class AdminProjectsPage {
    +createProject()
    +updateProject()
    +deleteProject()
    +uploadLogo()
  }

  class AuditReportPage {
    +renderSixTabs()
    +exportPdf()
    +editFindings()
    +pollAuditJob()
  }

  class ActivityReportPage {
    +loadRedmineIssues()
    +filterIssues()
    +exportActivityPdf()
    +saveSnapshot()
  }

  class FormTesterPage {
    +discoverForms()
    +createWorkflow()
    +prepareCampaign()
  }

  class FormTesterBuilderPage {
    +editWorkflow()
    +connectNodes()
    +runScenario()
    +applyAiPatch()
  }

  class AuditService {
    +generateAudit(projectId, url)
    +pollAudit(jobId)
    +completeAudit()
  }

  class AuditMapper {
    +mapApiToDisplay()
    +normalizeAxes()
    +resolveKpiLabels()
  }

  class ActivityPdfGenerator {
    +resolveLogo()
    +renderActivityDocument()
    +downloadBlob()
  }
}

package "Supabase Platform" {
  class SupabaseAuth {
    +emailPasswordLogin()
    +manageSession()
  }

  class Project {
    +id
    +site_name
    +url
    +redmine_url
    +logo_url
  }

  class Audit {
    +id
    +project_id
    +status
    +job_id
    +report_data
  }

  class Profile {
    +id
    +email
    +full_name
  }

  class UserRole {
    +user_id
    +role
  }

  class ActivityReportSnapshot {
    +project_id
    +report_data
    +filters
  }

  class Notification {
    +user_id
    +title
    +message
    +category
    +is_read
  }

  class ProjectPerimeterBlock {
    +project_id
    +title
    +subtitle
    +items
    +display_order
  }

  class EdgeFunctionFetchAuditApi {
    +invoke(url, async_mode, max_pages)
    +proxyToAggregator()
  }

  class EdgeFunctionPollAuditJob {
    +invoke(job_id)
    +proxyResult()
  }

  class EdgeFunctionFormWorkflows {
    +createWorkflow()
    +updateScenario()
    +upsertNode()
    +upsertEdge()
    +deleteEdge()
  }

  class EdgeFunctionFormWorkflowEdit {
    +proposePatch()
    +validatePatch()
    +returnPreviewOnly()
  }
}

package "V3 Microservices" {
  class AggregatorAPI {
    +POST /scan
    +POST /scan/sync
    +GET /scan/{id}/status
    +GET /scan/{id}/result
    +GET /scan/{id}/kpis
    +GET /scan/{id}/recommendations
  }

  class ScanOrchestrator {
    +createScanId()
    +persistState()
    +runScanner()
    +waitForNlp()
    +buildReport()
  }

  class KpiBuilder {
    +buildKpiCentricReport()
    +normalizeKpiObject()
    +buildTopLevelKpis()
    +buildQualityDriftArtifact()
  }

  class RecommendationClassifier {
    +classifyFindings()
    +scoreEffort()
    +rankSeverity()
    +buildRoadmap()
  }

  class ScannerGo {
    +POST /scan
    +crawlWebsite()
    +runDomainAnalyzers()
    +discoverForms()
    +sampleHeadlessPages()
    +persistScanData()
  }

  class NlpWorker {
    +pollPendingPages()
    +extractText()
    +analyzeContent()
    +buildSeoKpis()
    +buildRgpdKpis()
    +writeNlpResults()
  }

  class VisualRegressionService {
    +POST /screenshot
    +POST /compare
    +POST /ux-kpis
    +POST /browser-compat
  }

  class BrowserPool {
    +POST /render
    +POST /screenshot
    +POST /batch-screenshot
    +managePlaywrightPool()
  }

  class FormExecutor {
    +pollExecutionQueue()
    +runPlaywrightScenario()
    +storeArtifacts()
    +writeExecutionResult()
  }
}

package "Scan PostgreSQL Database" {
  class ScanPage {
    +scan_id
    +domain
    +url
    +raw_html
    +rendered_html
    +metrics
    +nlp_results
  }

  class ScanSummary {
    +scan_id
    +domain_security
    +domain_tech
    +domain_privacy
    +domain_functional
    +scan_telemetry
  }

  class FormFuzzResult {
    +scan_id
    +page_url
    +form_id
    +test_type
    +payload
    +anomaly
  }

  class ScanKpiOutput {
    +scan_id
    +scan_url
    +kpi_json
    +top_level_kpis
    +quality_drift_artifact
  }

  class ScanState {
    +scan_id
    +state_json
    +updated_at
  }

  class VisualScreenshot {
    +scan_id
    +url
    +screenshot
  }
}

package "External Systems" {
  class RedmineAPI {
    +fetchIssues()
    +fetchProjects()
    +createIssue()
  }

  class OpenAICompatibleAI {
    +chatCompletions()
    +returnStructuredPatch()
  }

  class GeminiAI {
    +generateContent()
    +returnSuggestions()
  }
}

Admin --> AuthProvider
PM --> AuthProvider
Client --> AuditReportPage

AuthProvider --> SupabaseAuth
AppLayout --> AuthProvider
OverviewPage --> Project
AdminProjectsPage --> Project
AuditReportPage --> AuditService
AuditReportPage --> AuditMapper
ActivityReportPage --> RedmineAPI
ActivityReportPage --> ActivityPdfGenerator
FormTesterPage --> EdgeFunctionFormWorkflows
FormTesterBuilderPage --> EdgeFunctionFormWorkflows
FormTesterBuilderPage --> EdgeFunctionFormWorkflowEdit

AuditService --> EdgeFunctionFetchAuditApi
AuditService --> EdgeFunctionPollAuditJob
EdgeFunctionFetchAuditApi --> AggregatorAPI
EdgeFunctionPollAuditJob --> AggregatorAPI

AggregatorAPI --> ScanOrchestrator
ScanOrchestrator --> ScannerGo
ScanOrchestrator --> NlpWorker
ScanOrchestrator --> VisualRegressionService
ScanOrchestrator --> KpiBuilder
KpiBuilder --> RecommendationClassifier

ScannerGo --> BrowserPool
ScannerGo --> ScanPage
ScannerGo --> ScanSummary
ScannerGo --> FormFuzzResult
NlpWorker --> ScanPage
VisualRegressionService --> VisualScreenshot
AggregatorAPI --> ScanState
AggregatorAPI --> ScanKpiOutput
KpiBuilder --> ScanKpiOutput

FormExecutor --> EdgeFunctionFormWorkflows
FormExecutor --> BrowserPool

EdgeFunctionFormWorkflowEdit --> OpenAICompatibleAI
EdgeFunctionFormWorkflowEdit --> GeminiAI

Project "1" --> "many" Audit
Project "1" --> "many" ActivityReportSnapshot
Project "1" --> "many" ProjectPerimeterBlock
Profile "1" --> "many" UserRole
Profile "1" --> "many" Notification

@enduml
```

## Use Case Diagram

```plantuml
@startuml SnapFlow_Use_Case_Diagram
title SnapFlow - Use Case Diagram

left to right direction
skinparam shadowing false
skinparam packageStyle rectangle
skinparam linetype ortho

actor "Super Admin" as SuperAdmin
actor "Chargé de projet" as ProjectManager
actor "Client externe" as ExternalClient
actor "Form Executor Worker" as FormWorker
actor "NLP Worker" as NlpWorkerActor
actor "Scanner Service" as ScannerActor
actor "Visual Regression Service" as VisualActor
actor "Redmine" as Redmine
actor "AI Provider\nGemini / OpenAI-compatible" as AIProvider

rectangle "SnapFlow SaaS Platform" {
  usecase "Se connecter" as UC_Login
  usecase "Gérer les utilisateurs\net rôles" as UC_Users
  usecase "Gérer les projets" as UC_Projects
  usecase "Configurer le branding PDF" as UC_Branding
  usecase "Configurer le périmètre projet" as UC_Perimeter

  usecase "Lancer un audit site web" as UC_StartAudit
  usecase "Suivre le statut d'audit" as UC_PollAudit
  usecase "Consulter le rapport d'audit" as UC_ViewAudit
  usecase "Exporter le rapport d'audit PDF" as UC_AuditPdf
  usecase "Éditer les constats" as UC_EditFindings
  usecase "Créer des tickets Redmine" as UC_CreateRedmineTickets

  usecase "Collecter pages et métriques" as UC_Crawl
  usecase "Analyser sécurité / SEO /\nperformance / RGPD" as UC_Analyze
  usecase "Enrichir contenu par NLP" as UC_Nlp
  usecase "Construire KPIs canoniques" as UC_Kpis
  usecase "Générer recommandations\net roadmap" as UC_Recommendations
  usecase "Comparer visuellement les pages" as UC_VisualCompare

  usecase "Consulter le tableau d'activité" as UC_ActivityDashboard
  usecase "Filtrer les tickets Redmine" as UC_FilterRedmine
  usecase "Exporter le rapport d'activité PDF" as UC_ActivityPdf
  usecase "Sauvegarder un snapshot\nd'activité" as UC_Snapshot

  usecase "Découvrir les formulaires" as UC_DiscoverForms
  usecase "Créer un workflow de test" as UC_CreateWorkflow
  usecase "Éditer un workflow visuel" as UC_EditWorkflow
  usecase "Connecter des noeuds" as UC_ConnectNodes
  usecase "Demander une édition IA" as UC_AiEdit
  usecase "Prévisualiser et appliquer\nun patch IA" as UC_ApplyPatch
  usecase "Préparer une campagne" as UC_PrepareCampaign
  usecase "Exécuter un scénario" as UC_RunScenario
  usecase "Consulter les résultats\nde tests formulaire" as UC_FormResults

  usecase "Recevoir notifications" as UC_Notifications
}

SuperAdmin --> UC_Login
SuperAdmin --> UC_Users
SuperAdmin --> UC_Projects
SuperAdmin --> UC_Branding
SuperAdmin --> UC_Perimeter
SuperAdmin --> UC_StartAudit
SuperAdmin --> UC_ViewAudit
SuperAdmin --> UC_AuditPdf
SuperAdmin --> UC_EditFindings
SuperAdmin --> UC_CreateRedmineTickets
SuperAdmin --> UC_ActivityDashboard
SuperAdmin --> UC_ActivityPdf
SuperAdmin --> UC_CreateWorkflow
SuperAdmin --> UC_EditWorkflow
SuperAdmin --> UC_AiEdit
SuperAdmin --> UC_PrepareCampaign
SuperAdmin --> UC_RunScenario
SuperAdmin --> UC_FormResults
SuperAdmin --> UC_Notifications

ProjectManager --> UC_Login
ProjectManager --> UC_Projects
ProjectManager --> UC_StartAudit
ProjectManager --> UC_PollAudit
ProjectManager --> UC_ViewAudit
ProjectManager --> UC_AuditPdf
ProjectManager --> UC_CreateRedmineTickets
ProjectManager --> UC_ActivityDashboard
ProjectManager --> UC_FilterRedmine
ProjectManager --> UC_ActivityPdf
ProjectManager --> UC_Snapshot
ProjectManager --> UC_DiscoverForms
ProjectManager --> UC_CreateWorkflow
ProjectManager --> UC_EditWorkflow
ProjectManager --> UC_ConnectNodes
ProjectManager --> UC_PrepareCampaign
ProjectManager --> UC_RunScenario
ProjectManager --> UC_FormResults
ProjectManager --> UC_Notifications

ExternalClient --> UC_ViewAudit
ExternalClient --> UC_AuditPdf

UC_StartAudit --> UC_Crawl : <<include>>
UC_StartAudit --> UC_Analyze : <<include>>
UC_StartAudit --> UC_Nlp : <<include>>
UC_StartAudit --> UC_Kpis : <<include>>
UC_ViewAudit --> UC_Recommendations : <<include>>
UC_AuditPdf --> UC_ViewAudit : <<include>>
UC_CreateRedmineTickets --> Redmine

ScannerActor --> UC_Crawl
ScannerActor --> UC_Analyze
NlpWorkerActor --> UC_Nlp
VisualActor --> UC_VisualCompare
UC_Kpis --> UC_VisualCompare : <<extend>>

UC_ActivityDashboard --> UC_FilterRedmine : <<include>>
UC_ActivityPdf --> UC_FilterRedmine : <<include>>
UC_FilterRedmine --> Redmine
UC_Snapshot --> UC_ActivityDashboard : <<include>>

UC_CreateWorkflow --> UC_DiscoverForms : <<include>>
UC_EditWorkflow --> UC_ConnectNodes : <<include>>
UC_AiEdit --> AIProvider
UC_AiEdit --> UC_ApplyPatch : <<include>>
UC_PrepareCampaign --> UC_CreateWorkflow : <<include>>
UC_RunScenario --> UC_CreateWorkflow : <<include>>
FormWorker --> UC_RunScenario
UC_FormResults --> UC_RunScenario : <<include>>

@enduml
```
