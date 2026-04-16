import { mockAudit } from '@/data/mockAuditData';
import { buildAuditDocumentData } from './types';

export const auditDataExample = buildAuditDocumentData(mockAudit);
