export const colors = {
  bg: '#0f172a',
  surface: '#1e293b',
  surfaceAlt: '#334155',
  border: '#334155',
  text: '#f8fafc',
  textMuted: '#94a3b8',
  primary: '#38bdf8',
  primaryText: '#0f172a',
  danger: '#f87171',
  warning: '#fbbf24',
  success: '#4ade80',
} as const;

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 } as const;

export const radius = { sm: 6, md: 12, lg: 20, full: 999 } as const;

export const typography = {
  title: { fontSize: 24, fontWeight: '700' as const, color: colors.text },
  heading: { fontSize: 18, fontWeight: '600' as const, color: colors.text },
  body: { fontSize: 15, color: colors.text },
  caption: { fontSize: 13, color: colors.textMuted },
} as const;
