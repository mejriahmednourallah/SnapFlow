import { View, Text } from '@react-pdf/renderer';
import type { SeverityStatus } from '../types';
import { STATUS_COLORS } from '../theme';

interface StatusBadgeProps {
  label: string;
  status: SeverityStatus;
}

export function StatusBadge({ label, status }: StatusBadgeProps) {
  const color = status === 'danger'
    ? STATUS_COLORS.danger
    : status === 'warning'
      ? STATUS_COLORS.warning
      : STATUS_COLORS.success;
  const bg = status === 'danger' ? '#FEF2F2' : status === 'warning' ? '#FFF7ED' : '#ECFDF5';
  const border = status === 'danger' ? '#FECACA' : status === 'warning' ? '#FED7AA' : '#BBF7D0';

  return (
    <View
      style={{
        borderRadius: 999,
        borderWidth: 0.8,
        borderColor: border,
        backgroundColor: bg,
        paddingHorizontal: 8,
        paddingVertical: 3,
      }}
    >
      <Text style={{ fontSize: 7, color: color, fontFamily: 'DMSans', fontWeight: 700 }}>{label}</Text>
    </View>
  );
}
