export type Criticality = 'critical' | 'high' | 'medium' | 'low';
export type Priority = 'quick-win' | 'moyen-terme' | 'long-terme';
export type FindingType = 'bug' | 'recommendation' | 'pass';
export type FindingStatus = 'pass' | 'fail' | 'not_measured' | 'not_available' | 'not_evaluated';
export type FindingOrigin = 'bug' | 'recommendation' | 'RGPD' | 'coverage' | 'passing_kpi' | 'legacy';

// ── French display labels for the new KPI contract ───────────────────
export type KpiStatut = 'Concluant' | 'Non concluant' | 'Non testé';
export type KpiTypeLabel = 'Conforme' | 'Bug' | 'Recommandation' | 'Indéterminé' | 'Non applicable';
export type KpiPriorite = 'Majeure' | 'Mineure' | 'Normale';

export interface KpiLabels {
  statut: KpiStatut;
  typeLabel: KpiTypeLabel;
  priorite: KpiPriorite;
}

export interface KpiEvidenceDigest {
  quality?: 'VALID' | 'PARTIAL' | 'MISSING' | string;
  summary?: string;
  proof_lines?: string[];
  rows?: Record<string, string | number | boolean | null | undefined>[];
  urls?: string[];
  affected_pages?: number;
  csv_columns?: string[];
  csv_rows?: Record<string, string | number | boolean | null | undefined>[];
  missing_reason?: string;
  top_urls?: string[];
  top_items?: string[];
  key_metrics?: Record<string, string | number | boolean>;
}

export interface AxisScoreBreakdown {
  passed: number;
  failed: number;
  notMeasured: number;
  notAvailable: number;
  x: number;
  y: number;
  scorePct: number;
}

export type RiskLevel = 'critical' | 'high' | 'medium' | 'low';

export interface AuditSummary {
  total: number;
  bugs: number;
  recommendations: number;
  compliance: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
}

export interface AuditActionItem {
  id: string;
  title: string;
  type: string;
  severity: string;
  scope: string;
  description: string;
  impact: string;
  effort: string;
  affected_count: number;
  example_urls: string[];
  fix: string;
  source_kpi: string;
  evidence: string[];
}

export interface AuditCoverageItem {
  id: string;
  label: string;
  status: 'covered' | 'not_measured' | 'not_available';
  evidence: string[];
}

export interface AuditPassingKpi {
  id: string;
  label: string;
  source_kpi: string;
  observed_value: string;
  status: 'pass';
  evidence: string[];
}

export interface KpiEvidenceItem {
  name: string;
  status_code?: number;
  status?: string;
  error?: string;
  found_on: string;
  anchor_text?: string;
  fix?: string;
}

export interface KpiItem {
  kpi_name: string;
  status: 'passing' | 'failing' | 'warning' | 'not_available' | 'not_evaluated' | 'not_measured' | 'non_evalue';
  type: 'bug' | 'recommendation' | 'RGPD' | 'compliance' | null;
  recommended_action?: string;
  recommendation_source?: 'fix' | 'ticket_payload' | 'generated' | string;
  evidence_digest?: KpiEvidenceDigest;
  axis: string;
  evidence: {
    summary?: string;
    items?: KpiEvidenceItem[];
    fix?: string;
    detail?: Record<string, unknown>;
    affected_pages?: string[];
    metric?: number | string;
    threshold?: Record<string, string>;
    current_grade?: string;
    warning?: string;
  };
  client_impact?: string;
}

export interface AuditRoadmapEntry {
  id: string;
  title: string;
  type: string;
  severity: string;
  effort: string;
}

export interface AuditRoadmap {
  immediate: AuditRoadmapEntry[];
  this_sprint: AuditRoadmapEntry[];
  this_quarter: AuditRoadmapEntry[];
  backlog: AuditRoadmapEntry[];
}

export interface PageMeta {
  url: string;
  title: string;
  hasMetaDescription: boolean;
  metaDescription?: string;
  metaDescriptionLength?: number;
}

export interface ImageToOptimize {
  url: string;
  page: string;
  currentSize: string;
  format: string;
  suggestedFormat: string;
  suggestedSize: string;
}

export interface TestCase {
  name: string;
  description: string;
  status: 'pass' | 'fail' | 'warning';
}

export interface AuditFinding {
  id: string;
  title: string;
  description: string;
  criticality: Criticality;
  priority: Priority;
  recommendation: string;
  type: FindingType;
  status?: FindingStatus;
  risk?: string;
  annexes?: string[];
  page?: string;
  pageUrl?: string;
  screenshotUrl?: string;
  testCases?: TestCase[];
  origin?: FindingOrigin;
  effort?: string;
  scope?: string;
  impact?: string;
  fix?: string;
  sourceKpi?: string;
  affectedCount?: number;
  exampleUrls?: string[];
  evidence?: string[];
  evidenceSummary?: string[];
  evidenceRows?: Record<string, string | number | boolean | null | undefined>[];
  evidenceCsvColumns?: string[];
  evidenceCsvRows?: Record<string, string | number | boolean | null | undefined>[];
  evidenceMissingReason?: string;
  evidenceRaw?: unknown;
  recommendationSource?: string;
  displayScorePct?: number;
  /** French display labels per the new KPI contract */
  kpiLabels?: KpiLabels;
}

export interface NewsItem {
  title: string;
  date: string;
  url: string;
}

export interface AuditAxis {
  id: string;
  name: string;
  icon: string;
  score: number;
  maxScore: number;
  description: string;
  findings: AuditFinding[];
}

export interface AuditReport {
  id: string;
  url: string;
  siteName: string;
  date: string;
  globalScore: number;
  maturityLevel: string;
  riskLevel: Criticality;
  axes: AuditAxis[];
  strategicSummary: string;
  positivePoints: string[];
  negativePoints: string[];
  opportunities: string[];
  criticalPoints: string[];
  pagesMeta: PageMeta[];
  imagesToOptimize: ImageToOptimize[];
  sitemapUrl: string;
  sitemapFound: boolean;
  newsItems: NewsItem[];
  summary?: AuditSummary;
  quickWins?: AuditActionItem[];
  bugs?: AuditActionItem[];
  recommendations?: AuditActionItem[];
  compliance?: AuditActionItem[];
  roadmap?: AuditRoadmap;
  auditCoverage?: AuditCoverageItem[];
  passingKpis?: AuditPassingKpi[];
  kpis?: KpiItem[];
  scanId?: string;
  generatedAt?: string;
}

export const mockAudit: AuditReport = {
  id: 'audit-001',
  url: 'https://www.bnda-mali.com/fr',
  siteName: 'BNDA Mali',
  date: '2026-02-23',
  globalScore: 38,
  maturityLevel: 'En développement',
  riskLevel: 'high',
  sitemapUrl: 'https://www.bnda-mali.com/sitemap.xml',
  sitemapFound: false,
  strategicSummary: "Le site de la BNDA Mali dispose d'une identité de marque reconnaissable et d'un contenu institutionnel solide. Cependant, des lacunes importantes subsistent en matière de performance, d'accessibilité et de conformité RGPD. La structure SEO est insuffisante et l'expérience utilisateur nécessite des améliorations significatives. Des quick wins sont possibles sur l'optimisation des images et la mise en conformité légale.",
  positivePoints: [
    "Identité visuelle cohérente avec la charte de la banque",
    "Contenu institutionnel complet (produits, services, agences)",
    "Site disponible en HTTPS avec certificat valide",
    "Présence d'une page dédiée aux données personnelles avec politique PDF",
    "Structure de navigation principale claire avec catégories de produits",
    "Actualités régulièrement mises à jour (dernière publication récente)",
  ],
  negativePoints: [
    "Temps de chargement excessif (> 8s sur mobile)",
    "Absence de gestion du consentement cookies (non conforme RGPD)",
    "Images non optimisées (poids total > 5 Mo)",
    "78% des images sans attribut ALT",
    "10 pages sur 12 sans meta description",
    "Aucun sitemap XML détecté",
    "Design non responsive sur mobile",
    "12 liens internes cassés (erreurs 404)",
  ],
  opportunities: [
    "Optimisation des Core Web Vitals pour améliorer le référencement",
    "Mise en place d'une stratégie de contenu ciblée",
    "Refonte du tunnel de conversion pour les services bancaires en ligne",
    "Amélioration de l'accessibilité pour toucher un public plus large",
  ],
  criticalPoints: [
    "Temps de chargement excessif (> 8s sur mobile)",
    "Absence de politique de confidentialité conforme",
    "Aucune gestion du consentement cookies",
    "Structure HTML non sémantique",
    "Images non optimisées (poids total > 5 Mo)",
  ],
  pagesMeta: [
    { url: 'https://www.bnda-mali.com/fr', title: 'Accueil', hasMetaDescription: false, metaDescriptionLength: 0 },
    { url: 'https://www.bnda-mali.com/fr/a-propos', title: 'À propos', hasMetaDescription: false, metaDescriptionLength: 0 },
    { url: 'https://www.bnda-mali.com/fr/services', title: 'Services', hasMetaDescription: false, metaDescriptionLength: 0 },
    { url: 'https://www.bnda-mali.com/fr/contact', title: 'Contact', hasMetaDescription: true, metaDescription: 'Contactez la BNDA Mali pour vos besoins bancaires.', metaDescriptionLength: 50 },
    { url: 'https://www.bnda-mali.com/fr/actualites', title: 'Actualités', hasMetaDescription: false, metaDescriptionLength: 0 },
    { url: 'https://www.bnda-mali.com/fr/produits/epargne', title: 'Épargne', hasMetaDescription: false, metaDescriptionLength: 0 },
    { url: 'https://www.bnda-mali.com/fr/produits/credits', title: 'Crédits', hasMetaDescription: false, metaDescriptionLength: 0 },
    { url: 'https://www.bnda-mali.com/fr/produits/transferts', title: 'Transferts', hasMetaDescription: false, metaDescriptionLength: 0 },
    { url: 'https://www.bnda-mali.com/fr/agences', title: 'Agences', hasMetaDescription: true, metaDescription: 'Trouvez une agence BNDA près de chez vous.', metaDescriptionLength: 43 },
    { url: 'https://www.bnda-mali.com/fr/carrieres', title: 'Carrières', hasMetaDescription: false, metaDescriptionLength: 0 },
    { url: 'https://www.bnda-mali.com/fr/donnees-personnelles', title: 'Données personnelles', hasMetaDescription: false, metaDescriptionLength: 0 },
    { url: 'https://www.bnda-mali.com/fr/mentions-legales', title: 'Mentions légales', hasMetaDescription: false, metaDescriptionLength: 0 },
  ],
  imagesToOptimize: [
    { url: 'https://www.bnda-mali.com/sites/default/files/banner-home.jpg', page: 'Accueil', currentSize: '1.8 Mo', format: 'JPEG', suggestedFormat: 'WebP', suggestedSize: '~180 Ko' },
    { url: 'https://www.bnda-mali.com/sites/default/files/services-bg.jpg', page: 'Services', currentSize: '1.2 Mo', format: 'JPEG', suggestedFormat: 'WebP', suggestedSize: '~120 Ko' },
    { url: 'https://www.bnda-mali.com/sites/default/files/about-team.png', page: 'À propos', currentSize: '950 Ko', format: 'PNG', suggestedFormat: 'WebP', suggestedSize: '~95 Ko' },
    { url: 'https://www.bnda-mali.com/sites/default/files/logo-bnda-large.png', page: 'Toutes les pages', currentSize: '420 Ko', format: 'PNG', suggestedFormat: 'SVG/WebP', suggestedSize: '~30 Ko' },
    { url: 'https://www.bnda-mali.com/sites/default/files/agences-map.jpg', page: 'Agences', currentSize: '680 Ko', format: 'JPEG', suggestedFormat: 'WebP', suggestedSize: '~70 Ko' },
    { url: 'https://www.bnda-mali.com/sites/default/files/credit-hero.jpg', page: 'Crédits', currentSize: '540 Ko', format: 'JPEG', suggestedFormat: 'WebP', suggestedSize: '~55 Ko' },
  ],
  newsItems: [
    { title: "Lancement du nouveau service e-banking BNDA", date: '2026-01-26', url: 'https://www.bnda-mali.com/fr/actualites/e-banking' },
    { title: "Partenariat BNDA x Banque Mondiale pour le financement agricole", date: '2025-12-15', url: 'https://www.bnda-mali.com/fr/actualites/partenariat-bm' },
    { title: "Assemblée Générale 2025 de la BNDA", date: '2025-11-20', url: 'https://www.bnda-mali.com/fr/actualites/ag-2025' },
    { title: "Ouverture de 3 nouvelles agences à Bamako", date: '2025-06-10', url: 'https://www.bnda-mali.com/fr/actualites/nouvelles-agences' },
    { title: "Campagne de microcrédits ruraux", date: '2025-03-05', url: 'https://www.bnda-mali.com/fr/actualites/microcredits' },
    { title: "Résultats financiers 2024", date: '2024-09-01', url: 'https://www.bnda-mali.com/fr/actualites/resultats-2024' },
    { title: "Forum économique de Bamako", date: '2024-06-15', url: 'https://www.bnda-mali.com/fr/actualites/forum-2024' },
  ],
  axes: [
    {
      id: 'functional', name: 'Audit Fonctionnel', icon: 'functional', score: 45, maxScore: 100,
      description: "Vérifie le bon fonctionnement des formulaires, liens, boutons CTA, fonctionnalités interactives, moteur de recherche interne, et détecte les erreurs (404, redirections).",
      findings: [
        {
          id: 'f1', title: 'Formulaire de contact non fonctionnel', description: "Le formulaire de contact retourne une erreur 500 lors de la soumission.", criticality: 'critical', priority: 'quick-win', type: 'bug',
          recommendation: "Corriger le backend du formulaire et ajouter une validation côté client.",
          page: 'Contact', pageUrl: 'https://www.bnda-mali.com/fr/contact',
          testCases: [
            { name: 'Test champ vide', description: "Soumettre le formulaire avec tous les champs vides", status: 'fail' },
            { name: 'Test email invalide', description: "Saisir un email au format invalide (ex: test@)", status: 'fail' },
            { name: 'Test soumission valide', description: "Remplir tous les champs correctement et soumettre", status: 'fail' },
            { name: 'Test message d\'erreur', description: "Vérifier l'affichage des messages d'erreur utilisateur", status: 'fail' },
            { name: 'Test message de confirmation', description: "Vérifier l'affichage du message de succès après envoi", status: 'fail' },
          ]
        },
        {
          id: 'f2', title: 'Liens morts détectés', description: "12 liens internes retournent des erreurs 404.", criticality: 'high', priority: 'quick-win', type: 'bug',
          recommendation: "Mettre en place des redirections 301 et corriger les liens cassés.",
          page: 'Multiple pages',
          testCases: [
            { name: 'Test liens internes', description: "Crawler tous les liens internes du site", status: 'fail' },
            { name: 'Test liens externes', description: "Vérifier les liens sortants vers des sites tiers", status: 'warning' },
            { name: 'Test redirections', description: "Vérifier que les redirections 301/302 fonctionnent", status: 'warning' },
          ]
        },
        {
          id: 'f3', title: 'CTA peu visibles', description: "Les boutons d'action principaux manquent de contraste et de hiérarchie visuelle.", criticality: 'medium', priority: 'moyen-terme', type: 'recommendation',
          recommendation: "Redesigner les CTA avec des couleurs contrastées et un sizing cohérent.",
          screenshotUrl: 'https://placehold.co/800x400/1a1a2e/39d2c0?text=CTA+peu+visibles',
          testCases: [
            { name: 'Test visibilité CTA', description: "Vérifier le contraste des boutons d'action", status: 'fail' },
            { name: 'Test cohérence CTA', description: "Vérifier l'uniformité des styles de boutons sur toutes les pages", status: 'warning' },
          ]
        },
        {
          id: 'f4', title: 'Pas de moteur de recherche interne', description: "Aucune fonctionnalité de recherche disponible sur le site.", criticality: 'medium', priority: 'moyen-terme', type: 'recommendation',
          recommendation: "Implémenter un moteur de recherche avec suggestions.",
          testCases: [
            { name: 'Test présence barre de recherche', description: "Vérifier la présence d'un champ de recherche", status: 'fail' },
          ]
        },
      ]
    },
    {
      id: 'accessibility', name: 'Accessibilité & W3C', icon: 'accessibility', score: 28, maxScore: 100,
      description: "Évalue la conformité aux standards W3C (HTML/CSS), le respect des normes WCAG 2.1, les contrastes, la navigation clavier, les attributs ALT et la structure des titres.",
      findings: [
        { id: 'a1', title: 'Validation HTML échouée', description: "87 erreurs de validation W3C détectées.", criticality: 'high', priority: 'moyen-terme', type: 'bug', recommendation: "Corriger les erreurs HTML et adopter une structure sémantique." },
        { id: 'a2', title: 'Contrastes insuffisants', description: "Ratio de contraste inférieur à 4.5:1 sur 60% des textes.", criticality: 'critical', priority: 'quick-win', type: 'bug', recommendation: "Ajuster la palette de couleurs pour respecter WCAG 2.1 AA.", screenshotUrl: 'https://placehold.co/800x400/1a1a2e/39d2c0?text=Contrastes+insuffisants' },
        { id: 'a3', title: 'Attributs ALT manquants', description: "78% des images n'ont pas d'attribut ALT.", criticality: 'high', priority: 'quick-win', type: 'bug', recommendation: "Ajouter des descriptions ALT pertinentes à toutes les images." },
        { id: 'a4', title: 'Navigation clavier impossible', description: "Les éléments interactifs ne sont pas accessibles au clavier.", criticality: 'critical', priority: 'moyen-terme', type: 'bug', recommendation: "Ajouter des tabindex et des focus styles." },
      ]
    },
    {
      id: 'performance', name: 'Performance', icon: 'performance', score: 32, maxScore: 100,
      description: "Mesure les temps de chargement desktop et mobile, les Core Web Vitals (LCP, FID, CLS), l'optimisation des images, la compression serveur et les scripts bloquants.",
      findings: [
        { id: 'p1', title: 'LCP excessif', description: "Largest Contentful Paint à 8.2s sur mobile.", criticality: 'critical', priority: 'quick-win', type: 'bug', recommendation: "Optimiser les images, activer le lazy loading et utiliser un CDN." },
        { id: 'p2', title: 'Images non compressées', description: "Poids total des images : 5.2 Mo sans compression.", criticality: 'high', priority: 'quick-win', type: 'bug', recommendation: "Convertir en WebP et implémenter le responsive images." },
        { id: 'p3', title: 'Pas de compression serveur', description: "Ni GZIP ni Brotli activé.", criticality: 'high', priority: 'quick-win', type: 'bug', recommendation: "Activer la compression Brotli sur le serveur." },
        { id: 'p4', title: 'Scripts render-blocking', description: "4 scripts JS bloquent le rendu initial.", criticality: 'medium', priority: 'moyen-terme', type: 'recommendation', recommendation: "Ajouter defer/async aux scripts non critiques." },
      ]
    },
    {
      id: 'seo', name: 'Audit SEO', icon: 'seo', score: 35, maxScore: 100,
      description: "Analyse les balises META, la structure Hn, le sitemap XML, le robots.txt, la qualité des URLs, le contenu dupliqué et l'indexation Google.",
      findings: [
        { id: 's1', title: 'Meta descriptions manquantes', description: "10 pages sur 12 n'ont pas de meta description.", criticality: 'high', priority: 'quick-win', type: 'bug', recommendation: "Rédiger des meta descriptions uniques de moins de 70 caractères pour chaque page." },
        { id: 's2', title: 'Sitemap XML non trouvé', description: `Le sitemap a été recherché à l'URL correcte : https://www.bnda-mali.com/sitemap.xml — mais retourne une erreur 404.`, criticality: 'high', priority: 'quick-win', type: 'bug', recommendation: "Générer et soumettre un sitemap XML à Google Search Console à l'URL https://www.bnda-mali.com/sitemap.xml." },
        { id: 's3', title: 'Structure Hn incorrecte', description: "Plusieurs H1 par page, sauts de niveaux.", criticality: 'medium', priority: 'moyen-terme', type: 'recommendation', recommendation: "Restructurer les titres avec un seul H1 et une hiérarchie logique." },
        { id: 's4', title: 'URLs non optimisées', description: "URLs contenant des paramètres et IDs non lisibles.", criticality: 'medium', priority: 'moyen-terme', type: 'recommendation', recommendation: "Adopter des URLs propres avec des slugs descriptifs." },
      ]
    },
    {
      id: 'content', name: 'Audit de Contenu', icon: 'content', score: 42, maxScore: 100,
      description: "Évalue le ciblage, la pertinence, la qualité rédactionnelle, l'originalité du contenu, la cohérence éditoriale et la fréquence de mise à jour des actualités.",
      findings: [
        { id: 'c1', title: 'Actualités non mises à jour', description: "Plusieurs actualités datent de plus de 6 mois.", criticality: 'medium', priority: 'moyen-terme', type: 'recommendation', recommendation: "Mettre en place un calendrier éditorial avec publications régulières." },
        { id: 'c2', title: 'Contenu dupliqué', description: "Plusieurs pages partagent un contenu quasi identique.", criticality: 'high', priority: 'moyen-terme', type: 'bug', recommendation: "Réécrire les contenus dupliqués et utiliser des canonical URLs." },
        { id: 'c3', title: 'Manque de ciblage', description: "Le contenu ne cible pas de mots-clés spécifiques.", criticality: 'medium', priority: 'long-terme', type: 'recommendation', recommendation: "Effectuer une recherche de mots-clés et optimiser le contenu." },
      ]
    },
    {
      id: 'ux-ui', name: 'Audit UX/UI', icon: 'ux-ui', score: 40, maxScore: 100,
      description: "Analyse le maillage interne, l'ergonomie, le design, la hiérarchie visuelle, la navigation, le tunnel de conversion, la compatibilité mobile et la clarté des CTA.",
      findings: [
        { id: 'u1', title: 'Non responsive', description: "Le site n'est pas correctement adapté aux mobiles.", criticality: 'critical', priority: 'quick-win', type: 'bug', recommendation: "Implémenter un design responsive mobile-first.", screenshotUrl: 'https://placehold.co/800x400/1a1a2e/39d2c0?text=Design+non+responsive' },
        { id: 'u2', title: 'Navigation confuse', description: "Le menu principal contient trop d'éléments sans hiérarchie.", criticality: 'high', priority: 'moyen-terme', type: 'recommendation', recommendation: "Restructurer la navigation avec maximum 7 items principaux.", screenshotUrl: 'https://placehold.co/800x400/1a1a2e/39d2c0?text=Navigation+confuse' },
        { id: 'u3', title: 'Incohérence graphique', description: "Typographies et couleurs non uniformes entre les pages.", criticality: 'medium', priority: 'moyen-terme', type: 'recommendation', recommendation: "Créer un design system et l'appliquer uniformément.", screenshotUrl: 'https://placehold.co/800x400/1a1a2e/39d2c0?text=Incohérence+graphique' },
      ]
    },
    {
      id: 'eco-index', name: 'Eco Index', icon: 'eco-index', score: 48, maxScore: 100,
      description: "Mesure l'impact environnemental du site : poids des pages, nombre de requêtes serveur, bonnes pratiques d'éco-conception web.",
      findings: [
        { id: 'e1', title: 'Poids excessif des pages', description: "Poids moyen des pages : 3.8 Mo.", criticality: 'high', priority: 'moyen-terme', type: 'bug', recommendation: "Réduire le poids sous 1 Mo par page avec compression et optimisation." },
        { id: 'e2', title: 'Trop de requêtes serveur', description: "85 requêtes en moyenne par page.", criticality: 'medium', priority: 'moyen-terme', type: 'recommendation', recommendation: "Consolider les ressources et utiliser le bundling." },
      ]
    },
    {
      id: 'rgpd', name: 'RGPD & Conformité', icon: 'rgpd', score: 22, maxScore: 100,
      description: "Vérifie la politique de confidentialité, la gestion des cookies, le consentement utilisateur, la finalité et conservation des données, les mentions légales et les droits RGPD.",
      findings: [
        { id: 'r1', title: 'Aucune bannière de cookies', description: "Pas de système de gestion du consentement cookies détecté.", criticality: 'critical', priority: 'quick-win', type: 'bug', recommendation: "Implémenter un CMP conforme au RGPD (ex: Tarteaucitron, Axeptio)." },
        { id: 'r2', title: 'Politique de confidentialité partiellement conforme', description: "Un document PDF existe mais n'est pas en HTML.", criticality: 'high', priority: 'quick-win', type: 'bug', recommendation: "Publier la politique en page HTML accessible.", pageUrl: 'https://bnda-mali.com/sites/default/files/2024-08/politique_de_protection_des_donnees_a_caracrtere_personnel_v_fr.pdf' },
        { id: 'r3', title: 'Mentions légales incomplètes', description: "Informations manquantes : éditeur, hébergeur, DPO.", criticality: 'high', priority: 'quick-win', type: 'bug', recommendation: "Compléter les mentions légales.", page: 'Mentions légales', pageUrl: 'https://www.bnda-mali.com/fr/mentions-legales' },
        { id: 'r4', title: "Pas de procédure d'exercice des droits", description: "Aucun mécanisme pour les demandes RGPD.", criticality: 'high', priority: 'moyen-terme', type: 'bug', recommendation: "Mettre en place un formulaire RGPD et nommer un DPO." },
        { id: 'r5', title: "Finalité des données non spécifiée", description: "Aucune info sur la finalité des collectes.", criticality: 'medium', priority: 'moyen-terme', type: 'recommendation', recommendation: "Ajouter un texte clair sur la finalité de chaque collecte." },
        { id: 'r6', title: "Durée de conservation non mentionnée", description: "Aucune mention de la durée de conservation.", criticality: 'medium', priority: 'moyen-terme', type: 'recommendation', recommendation: "Définir et publier les durées de conservation." },
        { id: 'r7', title: "Sécurité des données insuffisante", description: "HTTPS présent mais mesures techniques non documentées.", criticality: 'medium', priority: 'long-terme', type: 'recommendation', recommendation: "Documenter les mesures de sécurité techniques." },
      ]
    },
  ],
};

export function getRecentNews(audit: AuditReport, monthsLimit = 6): NewsItem[] {
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - monthsLimit);
  return audit.newsItems.filter(n => new Date(n.date) >= cutoff);
}

export function getPagesWithoutMeta(audit: AuditReport): PageMeta[] {
  return audit.pagesMeta.filter(p => !p.hasMetaDescription);
}

export function getPagesWithLongMeta(audit: AuditReport, maxLength = 70): PageMeta[] {
  return audit.pagesMeta.filter(p => p.hasMetaDescription && p.metaDescription && p.metaDescription.length > maxLength);
}

export function getScoreColor(score: number): string {
  if (score >= 80) return 'text-emerald-400';
  if (score >= 60) return 'text-yellow-400';
  if (score >= 40) return 'text-orange-400';
  return 'text-red-400';
}

export function getScoreBg(score: number): string {
  if (score >= 80) return 'bg-emerald-500/10';
  if (score >= 60) return 'bg-yellow-500/10';
  if (score >= 40) return 'bg-orange-500/10';
  return 'bg-red-500/10';
}

export function getCriticalityLabel(c: Criticality): string {
  const map: Record<Criticality, string> = { critical: 'Critique', high: 'Élevé', medium: 'Moyen', low: 'Faible' };
  return map[c];
}

export function getPriorityLabel(p: Priority): string {
  const map: Record<Priority, string> = { 'quick-win': 'Prioritaire', 'moyen-terme': 'Moyen terme', 'long-terme': 'Long terme' };
  return map[p];
}

export function isNonTestedStatus(statusRaw: unknown): boolean {
  const status = String(statusRaw ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\s-]+/g, '_');

  return (
    status === 'not_measured' ||
    status === 'not_available' ||
    status === 'not_evaluated' ||
    status === 'not_applicable' ||
    status === 'non_evalue' ||
    status === 'non_teste'
  );
}

export function isNonTestedFinding(finding: AuditFinding): boolean {
  return finding.origin === 'coverage' || isNonTestedStatus(resolveFindingStatus(finding));
}

export function getTotalFindings(audit: AuditReport): number {
  return audit.axes.reduce((sum, ax) => sum + ax.findings.length, 0);
}

export function getCriticalCount(audit: AuditReport): number {
  return audit.axes.reduce((sum, ax) => sum + ax.findings.filter(f => f.criticality === 'critical').length, 0);
}

export function getAxisScoreBreakdown(axis: AuditAxis): AxisScoreBreakdown {
  const statuses = axis.findings.map(resolveFindingStatus);
  const passed = statuses.filter(status => status === 'pass').length;
  const failed = statuses.filter(status => status === 'fail').length;
  const notAvailable = statuses.filter(status => status === 'not_available').length;
  const notMeasured = statuses.filter(
    status => isNonTestedStatus(status) && status !== 'not_available',
  ).length;
  const x = passed;
  const y = passed + failed + notMeasured + notAvailable;
  const scorePct = y > 0 ? Math.round((x / y) * 100) : 0;

  return {
    passed,
    failed,
    notMeasured,
    notAvailable,
    x,
    y,
    scorePct,
  };
}

export function getRiskLevelFromScore(scorePct: number): RiskLevel {
  if (scorePct < 30) return 'critical';
  if (scorePct < 50) return 'high';
  if (scorePct < 70) return 'medium';
  return 'low';
}

export function getAuditGlobalScore(audit: AuditReport): number {
  const passCount = audit.passingKpis?.length ?? 0;
  const failCount = (audit.bugs?.length ?? 0) + (audit.recommendations?.length ?? 0) + (audit.compliance?.length ?? 0);
  const coverageCount = audit.auditCoverage?.length ?? 0;
  const rawTotal = passCount + failCount + coverageCount;

  if (rawTotal > 0) {
    return Math.round((passCount / rawTotal) * 100);
  }

  const totalX = audit.axes.reduce((sum, axis) => sum + getAxisScoreBreakdown(axis).x, 0);
  const totalY = audit.axes.reduce((sum, axis) => sum + getAxisScoreBreakdown(axis).y, 0);
  if (totalY > 0) return Math.round((totalX / totalY) * 100);
  return audit.globalScore ?? 0;
}

function resolveFindingStatus(finding: AuditFinding): FindingStatus {
  return finding.status ?? (finding.type === 'pass' ? 'pass' : finding.type === 'bug' ? 'fail' : 'not_measured');
}

function toAuditActionItem(finding: AuditFinding, typeOverride?: string): AuditActionItem {
  const effort = finding.effort?.trim();
  const normalizedEffort = effort && effort.length > 0
    ? effort
    : finding.priority === 'long-terme'
      ? 'high'
      : 'medium';

  return {
    id: finding.id,
    title: finding.title,
    type: typeOverride ?? finding.type,
    severity: finding.criticality,
    scope: finding.scope || 'global',
    description: finding.description,
    impact: finding.risk || finding.impact || '',
    effort: normalizedEffort,
    affected_count: finding.affectedCount ?? finding.exampleUrls?.length ?? 0,
    example_urls: finding.exampleUrls ?? [],
    fix: finding.recommendation,
    source_kpi: finding.sourceKpi || finding.id,
    evidence: finding.evidence ?? finding.annexes ?? [],
  };
}

export function recomputeAuditReport(audit: AuditReport): AuditReport {
  const axes = audit.axes.map((axis) => {
    const breakdown = getAxisScoreBreakdown(axis);
    return {
      ...axis,
      score: breakdown.x,
      maxScore: breakdown.y,
    };
  });

  const findingsWithStatus = axes.flatMap((axis) =>
    axis.findings.map((finding) => ({
      finding,
      status: resolveFindingStatus(finding),
    })),
  );

  const passingFindings = findingsWithStatus
    .filter((entry) => entry.status === 'pass')
    .map((entry) => entry.finding);

  const failedFindings = findingsWithStatus
    .filter((entry) => entry.status === 'fail')
    .map((entry) => entry.finding);

  const coverageFindings = findingsWithStatus
    .filter((entry) => isNonTestedStatus(entry.status))
    .map((entry) => entry.finding);

  const bugFindings: AuditFinding[] = [];
  const recommendationFindings: AuditFinding[] = [];
  const complianceFindings: AuditFinding[] = [];

  failedFindings.forEach((finding) => {
    if (finding.origin === 'RGPD') {
      complianceFindings.push(finding);
      return;
    }

    if (finding.type === 'bug' || finding.origin === 'bug') {
      bugFindings.push(finding);
      return;
    }

    recommendationFindings.push(finding);
  });

  const bugs = bugFindings.map((finding) => toAuditActionItem(finding, 'bug'));
  const recommendations = recommendationFindings.map((finding) => toAuditActionItem(finding, 'recommendation'));
  const compliance = complianceFindings.map((finding) => toAuditActionItem(finding, 'RGPD'));

  const passingKpis: AuditPassingKpi[] = passingFindings.map((finding) => ({
    id: finding.id,
    label: finding.title,
    source_kpi: finding.sourceKpi || finding.id,
    observed_value: finding.description,
    status: 'pass',
    evidence: finding.evidence ?? finding.annexes ?? [],
  }));

  const auditCoverage: AuditCoverageItem[] = coverageFindings.map((finding) => {
    const status = resolveFindingStatus(finding);
    return {
      id: finding.id,
      label: finding.title,
      status: status === 'not_available' ? 'not_available' : 'not_measured',
      evidence: finding.evidence ?? finding.annexes ?? [],
    };
  });

  const passCount = passingFindings.length;
  const failCount = failedFindings.length;
  const coverageCount = coverageFindings.length;
  const total = passCount + failCount + coverageCount;
  const globalScore = total > 0 ? Math.round((passCount / total) * 100) : 0;

  const summary: AuditSummary = {
    total,
    bugs: bugFindings.length,
    recommendations: recommendationFindings.length,
    compliance: complianceFindings.length,
    critical: failedFindings.filter((finding) => finding.criticality === 'critical').length,
    high: failedFindings.filter((finding) => finding.criticality === 'high').length,
    medium: failedFindings.filter((finding) => finding.criticality === 'medium').length,
    low: failedFindings.filter((finding) => finding.criticality === 'low').length,
  };

  const quickWinsDerived = [...bugFindings, ...recommendationFindings, ...complianceFindings]
    .filter((finding) => finding.priority === 'quick-win')
    .slice(0, 6)
    .map((finding) => {
      if (finding.origin === 'RGPD') return toAuditActionItem(finding, 'RGPD');
      if (finding.type === 'bug' || finding.origin === 'bug') return toAuditActionItem(finding, 'bug');
      return toAuditActionItem(finding, 'recommendation');
    });

  return {
    ...audit,
    axes,
    globalScore,
    maturityLevel: globalScore >= 75 ? 'Avancé' : globalScore >= 50 ? 'Intermédiaire' : 'En développement',
    riskLevel: getRiskLevelFromScore(globalScore),
    summary,
    bugs,
    recommendations,
    compliance,
    passingKpis,
    auditCoverage,
    quickWins: quickWinsDerived.length > 0 ? quickWinsDerived : audit.quickWins,
  };
}
