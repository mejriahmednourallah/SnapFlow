import { Font, StyleSheet } from '@react-pdf/renderer';
import playfairBold from '@fontsource/playfair-display/files/playfair-display-latin-700-normal.woff?url';
import playfairSemiBold from '@fontsource/playfair-display/files/playfair-display-latin-600-normal.woff?url';
import dmSansBold from '@fontsource/dm-sans/files/dm-sans-latin-700-normal.woff?url';
import dmSansMedium from '@fontsource/dm-sans/files/dm-sans-latin-500-normal.woff?url';
import dmSansRegular from '@fontsource/dm-sans/files/dm-sans-latin-400-normal.woff?url';
import dmSansSemiBold from '@fontsource/dm-sans/files/dm-sans-latin-600-normal.woff?url';
import type { SeverityStatus } from './types';

let fontsRegistered = false;

function registerFonts() {
  if (fontsRegistered) return;

  Font.register({
    family: 'PlayfairDisplay',
    fonts: [
      {
        src: playfairSemiBold,
        fontWeight: 600,
      },
      {
        src: playfairBold,
        fontWeight: 700,
      },
    ],
  });

  Font.register({
    family: 'DMSans',
    fonts: [
      {
        src: dmSansRegular,
        fontWeight: 400,
      },
      {
        src: dmSansMedium,
        fontWeight: 500,
      },
      {
        src: dmSansSemiBold,
        fontWeight: 600,
      },
      {
        src: dmSansBold,
        fontWeight: 700,
      },
    ],
  });

  fontsRegistered = true;
}

export interface PdfTheme {
  id: string;
  name: string;
  primary: string;
  accent: string;
  bg: string;
  surface: string;
  border: string;
  text: string;
  textMuted: string;
  heroBg: string;
  heroText: string;
  headerBg: string;
  headerBorder: string;
  recBg: string;
}

export const PDF_THEMES: PdfTheme[] = [
  {
    id: 'modern-slate',
    name: 'Slate',
    primary: '#1E3A5F',
    accent: '#4E8CCF',
    bg: '#F8FAFC',
    surface: '#FFFFFF',
    border: '#D7E0EA',
    text: '#0F172A',
    textMuted: '#475569',
    heroBg: '#10243C',
    heroText: '#EFF6FF',
    headerBg: '#E7EEF7',
    headerBorder: '#C5D4E5',
    recBg: '#F1F4F8',
  },
  {
    id: 'mineral-green',
    name: 'Mineral',
    primary: '#1E5B4E',
    accent: '#3B9B86',
    bg: '#F6FAF9',
    surface: '#FFFFFF',
    border: '#D4E4DE',
    text: '#0F1F1A',
    textMuted: '#49635B',
    heroBg: '#143E35',
    heroText: '#ECFDF5',
    headerBg: '#E6F3EE',
    headerBorder: '#BFD7CF',
    recBg: '#F4FAF7',
  },
  {
    id: 'sand-charter',
    name: 'Sand',
    primary: '#6D4D2E',
    accent: '#BD8C4F',
    bg: '#FBF8F3',
    surface: '#FFFFFF',
    border: '#E5D9C9',
    text: '#2C2118',
    textMuted: '#6D5B4D',
    heroBg: '#4B3623',
    heroText: '#FDF6ED',
    headerBg: '#FBF5EB',
    headerBorder: '#E0D1BD',
    recBg: '#F9F4EB',
  },
  {
    id: 'steel-ink',
    name: 'Steel',
    primary: '#334155',
    accent: '#64748B',
    bg: '#F8FAFC',
    surface: '#FFFFFF',
    border: '#D1D9E0',
    text: '#111827',
    textMuted: '#4B5563',
    heroBg: '#1E293B',
    heroText: '#F8FAFC',
    headerBg: '#F2F4F8',
    headerBorder: '#CBD3DE',
    recBg: '#F4F6FA',
  },
];

export const DEFAULT_THEME = PDF_THEMES[0];

export const STATUS_COLORS = {
  success: '#16A34A',
  warning: '#F97316',
  danger: '#DC2626',
  neutral: '#64748B',
} as const;

export function getStatusColor(status: SeverityStatus): string {
  if (status === 'danger') return STATUS_COLORS.danger;
  if (status === 'warning') return STATUS_COLORS.warning;
  return STATUS_COLORS.success;
}

export function makePageStyles(theme?: PdfTheme) {
  registerFonts();
  const t = theme ?? DEFAULT_THEME;

  return StyleSheet.create({
    page: {
      backgroundColor: t.bg,
      color: t.text,
      fontFamily: 'DMSans',
      fontSize: 9,
      paddingTop: 0,
      paddingBottom: 42,
      paddingHorizontal: 0,
    },
    body: {
      paddingHorizontal: 38,
    },
    pageHeader: {
      paddingHorizontal: 38,
      paddingVertical: 12,
      backgroundColor: t.surface,
      borderBottomWidth: 1,
      borderBottomColor: t.border,
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 18,
    },
    pageHeaderTitle: {
      fontSize: 11,
      fontFamily: 'DMSans',
      fontWeight: 700,
      color: t.primary,
    },
    pageHeaderText: {
      fontSize: 8,
      color: t.textMuted,
    },
    pageFooter: {
      position: 'absolute',
      bottom: 16,
      left: 38,
      right: 38,
      borderTopWidth: 0.8,
      borderTopColor: t.border,
      paddingTop: 6,
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    pageFooterText: {
      fontSize: 7,
      color: t.textMuted,
    },
    h1: {
      fontFamily: 'PlayfairDisplay',
      fontWeight: 700,
      fontSize: 40,
      color: t.text,
      lineHeight: 1.15,
    },
    h2: {
      fontFamily: 'PlayfairDisplay',
      fontWeight: 600,
      fontSize: 20,
      color: t.text,
      lineHeight: 1.2,
      marginBottom: 6,
    },
    h3: {
      fontFamily: 'DMSans',
      fontWeight: 700,
      fontSize: 13,
      color: t.text,
      lineHeight: 1.25,
      marginBottom: 5,
    },
    bodyText: {
      fontSize: 9.5,
      fontFamily: 'DMSans',
      color: t.text,
      lineHeight: 1.5,
    },
    textMuted: {
      fontSize: 8.5,
      color: t.textMuted,
      lineHeight: 1.45,
    },
    card: {
      backgroundColor: t.surface,
      borderWidth: 0.9,
      borderColor: t.border,
      borderRadius: 12,
      padding: 12,
    },
  });
}
