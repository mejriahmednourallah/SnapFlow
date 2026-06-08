import { Document } from '@react-pdf/renderer';
import type { AuditReport } from '@/data/mockAuditData';
import type { PdfTheme } from './theme';
import { buildAuditDocumentData } from './types';
import { CoverPage } from './pages/CoverPage';
import { TableOfContentsPage } from './pages/TableOfContentsPage';
import { ExecutiveSummaryPage } from './pages/ExecutiveSummaryPage';
import { KpiGridPage } from './pages/KpiGridPage';
import { AxisPage } from './pages/AxisPage';
import { RecommendationsPage } from './pages/RecommendationsPage';
import { RoadmapPage } from './pages/RoadmapPage';
import { ConclusionPage } from './pages/ConclusionPage';
import { AnnexePage, hasUsefulAnnexeEvidence } from './pages/AnnexePage';
import { BackCoverPage } from './pages/BackCoverPage';

interface Props {
  audit: AuditReport;
  theme?: PdfTheme;
  clientLogoSrc?: string;
}

export function AuditDocument({ audit, theme, clientLogoSrc }: Props) {
  const report = buildAuditDocumentData(audit);
  const hasAxes = report.axes.length > 0;
  const hasRecommendations = report.recommendations.length > 0;
  const hasAnnexes = report.axes.some((axis) => axis.findings.some(hasUsefulAnnexeEvidence));

  return (
    <Document
      title={`Audit - ${report.siteName}`}
      author={report.preparedBy}
      subject={`Rapport d'audit du ${report.date}`}
      creator="Snapflow App"
    >
      <CoverPage report={report} theme={theme} clientLogoSrc={clientLogoSrc} />
      <TableOfContentsPage report={report} theme={theme} clientLogoSrc={clientLogoSrc} />
      <ExecutiveSummaryPage report={report} theme={theme} clientLogoSrc={clientLogoSrc} />
      {hasAxes ? <KpiGridPage report={report} theme={theme} clientLogoSrc={clientLogoSrc} /> : null}
      {report.axes.map((axis, idx) => (
        <AxisPage
          key={axis.id}
          report={report}
          axis={axis}
          index={idx}
          theme={theme}
          clientLogoSrc={clientLogoSrc}
        />
      ))}
      {hasRecommendations ? <RecommendationsPage report={report} theme={theme} clientLogoSrc={clientLogoSrc} /> : null}
      {hasRecommendations ? <RoadmapPage report={report} theme={theme} clientLogoSrc={clientLogoSrc} /> : null}
      <ConclusionPage report={report} theme={theme} clientLogoSrc={clientLogoSrc} />
      {hasAnnexes ? <AnnexePage report={report} theme={theme} clientLogoSrc={clientLogoSrc} /> : null}
      <BackCoverPage report={report} theme={theme} clientLogoSrc={clientLogoSrc} />
    </Document>
  );
}
