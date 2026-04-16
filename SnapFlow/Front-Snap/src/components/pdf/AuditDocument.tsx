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
import { AnnexePage } from './pages/AnnexePage';
import { BackCoverPage } from './pages/BackCoverPage';

interface Props {
  audit: AuditReport;
  theme?: PdfTheme;
  clientLogoSrc?: string;
}

export function AuditDocument({ audit, theme, clientLogoSrc }: Props) {
  const report = buildAuditDocumentData(audit);

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
      <KpiGridPage report={report} theme={theme} clientLogoSrc={clientLogoSrc} />
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
      <RecommendationsPage report={report} theme={theme} clientLogoSrc={clientLogoSrc} />
      <RoadmapPage report={report} theme={theme} clientLogoSrc={clientLogoSrc} />
      <ConclusionPage report={report} theme={theme} clientLogoSrc={clientLogoSrc} />
      <AnnexePage report={report} theme={theme} clientLogoSrc={clientLogoSrc} />
      <BackCoverPage report={report} theme={theme} clientLogoSrc={clientLogoSrc} />
    </Document>
  );
}
