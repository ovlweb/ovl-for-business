/**
 * Curated colour themes shared by every client (web, admin panel, native apps).
 * Web turns them into CSS variables; the native apps generate their palettes from this file
 * (`pnpm themes:dart`), so a theme looks the same everywhere.
 */

export interface ThemeColors {
  bg: string;
  surface: string;
  surface2: string;
  surface3: string;
  border: string;
  borderStrong: string;
  text: string;
  text2: string;
  text3: string;
  accent: string;
  accent2: string;
  accentSoft: string;
  accentText: string;
  gradFrom: string;
  gradTo: string;
  success: string;
  successSoft: string;
  warning: string;
  warningSoft: string;
  danger: string;
  dangerSoft: string;
  owner: string;
  ownerSoft: string;
  admin: string;
  adminSoft: string;
  council: string;
  councilSoft: string;
  moderator: string;
  moderatorSoft: string;
  manager: string;
  managerSoft: string;
  support: string;
  supportSoft: string;
  sidebarBg: string;
  sidebarText: string;
  sidebarMuted: string;
  sidebarActiveBg: string;
  sidebarActiveText: string;
  sidebarBorder: string;
}

export interface Theme {
  id: string;
  name: string;
  description: string;
  mode: 'light' | 'dark';
  colors: ThemeColors;
}

const roles = {
  light: {
    owner: '#B7791F',
    ownerSoft: '#FBF1DC',
    admin: '#DC2626',
    adminSoft: '#FDE8E8',
    council: '#7C3AED',
    councilSoft: '#F0E9FE',
    moderator: '#2563EB',
    moderatorSoft: '#E6EEFE',
    manager: '#059669',
    managerSoft: '#DEF6EE',
    support: '#0891B2',
    supportSoft: '#DDF4F9',
  },
  dark: {
    owner: '#F5C451',
    ownerSoft: '#3A2E10',
    admin: '#F87171',
    adminSoft: '#3B1418',
    council: '#B794F6',
    councilSoft: '#2B1F4D',
    moderator: '#6B9BFF',
    moderatorSoft: '#1A2A55',
    manager: '#34D399',
    managerSoft: '#0F3029',
    support: '#22D3EE',
    supportSoft: '#0B3440',
  },
};

export const THEMES: readonly Theme[] = [
  {
    id: 'daylight',
    name: 'Daylight',
    description: 'Crisp and bright, for long working days.',
    mode: 'light',
    colors: {
      bg: '#F4F6FA',
      surface: '#FFFFFF',
      surface2: '#F1F4F9',
      surface3: '#E6EAF2',
      border: '#E3E8F0',
      borderStrong: '#CBD3E0',
      text: '#0F172A',
      text2: '#475569',
      text3: '#7B8698',
      accent: '#2563EB',
      accent2: '#1D4ED8',
      accentSoft: '#E7EEFE',
      accentText: '#FFFFFF',
      gradFrom: '#2563EB',
      gradTo: '#7C3AED',
      success: '#16A34A',
      successSoft: '#E3F6EA',
      warning: '#C2700C',
      warningSoft: '#FEF3E2',
      danger: '#DC2626',
      dangerSoft: '#FDE8E8',
      ...roles.light,
      sidebarBg: '#FFFFFF',
      sidebarText: '#334155',
      sidebarMuted: '#8A94A6',
      sidebarActiveBg: '#E7EEFE',
      sidebarActiveText: '#1D4ED8',
      sidebarBorder: '#E3E8F0',
    },
  },
  {
    id: 'midnight',
    name: 'Midnight',
    description: 'Deep navy with an electric blue accent.',
    mode: 'dark',
    colors: {
      bg: '#0A0F1E',
      surface: '#10172C',
      surface2: '#161F3A',
      surface3: '#1E2949',
      border: '#1F2A4B',
      borderStrong: '#324069',
      text: '#E7EBF6',
      text2: '#A9B3CF',
      text3: '#6E7998',
      accent: '#5B8CFF',
      accent2: '#82A7FF',
      accentSoft: '#1A2A55',
      accentText: '#FFFFFF',
      gradFrom: '#3B82F6',
      gradTo: '#8B5CF6',
      success: '#34D399',
      successSoft: '#0F3029',
      warning: '#FBBF24',
      warningSoft: '#3A2C0B',
      danger: '#F87171',
      dangerSoft: '#3B1418',
      ...roles.dark,
      sidebarBg: '#0D1326',
      sidebarText: '#B8C1DB',
      sidebarMuted: '#5F6A8A',
      sidebarActiveBg: '#1A2A55',
      sidebarActiveText: '#FFFFFF',
      sidebarBorder: '#1A2442',
    },
  },
  {
    id: 'graphite',
    name: 'Graphite',
    description: 'Neutral charcoal with a warm amber highlight.',
    mode: 'dark',
    colors: {
      bg: '#111111',
      surface: '#191919',
      surface2: '#212121',
      surface3: '#2B2B2B',
      border: '#2C2C2C',
      borderStrong: '#404040',
      text: '#EDEDED',
      text2: '#B4B4B4',
      text3: '#7A7A7A',
      accent: '#F59E0B',
      accent2: '#FBBF24',
      accentSoft: '#3A2A0A',
      accentText: '#141414',
      gradFrom: '#F59E0B',
      gradTo: '#EF4444',
      success: '#4ADE80',
      successSoft: '#12301D',
      warning: '#FACC15',
      warningSoft: '#3A320A',
      danger: '#F87171',
      dangerSoft: '#3B1616',
      ...roles.dark,
      moderator: '#60A5FA',
      moderatorSoft: '#16283F',
      sidebarBg: '#151515',
      sidebarText: '#C8C8C8',
      sidebarMuted: '#6E6E6E',
      sidebarActiveBg: '#2A2210',
      sidebarActiveText: '#FBBF24',
      sidebarBorder: '#242424',
    },
  },
  {
    id: 'emerald',
    name: 'Emerald',
    description: 'Private-banking green on soft mint.',
    mode: 'light',
    colors: {
      bg: '#F2F7F4',
      surface: '#FFFFFF',
      surface2: '#EDF4F0',
      surface3: '#DFEAE4',
      border: '#DAE6DF',
      borderStrong: '#BACDC3',
      text: '#0B1F16',
      text2: '#3E5A4D',
      text3: '#728A7E',
      accent: '#047857',
      accent2: '#065F46',
      accentSoft: '#DCF3E9',
      accentText: '#FFFFFF',
      gradFrom: '#047857',
      gradTo: '#0EA5E9',
      success: '#15803D',
      successSoft: '#E1F4E6',
      warning: '#B45309',
      warningSoft: '#FDF0DC',
      danger: '#B91C1C',
      dangerSoft: '#FBE5E5',
      ...roles.light,
      manager: '#047857',
      sidebarBg: '#0B3527',
      sidebarText: '#CFE8DC',
      sidebarMuted: '#78A392',
      sidebarActiveBg: '#13513C',
      sidebarActiveText: '#FFFFFF',
      sidebarBorder: '#0F4332',
    },
  },
  {
    id: 'obsidian',
    name: 'Obsidian',
    description: 'True black for OLED screens, violet accent.',
    mode: 'dark',
    colors: {
      bg: '#000000',
      surface: '#0B0B0D',
      surface2: '#131316',
      surface3: '#1C1C21',
      border: '#1F1F25',
      borderStrong: '#303038',
      text: '#F4F4F5',
      text2: '#A1A1AA',
      text3: '#6B6B76',
      accent: '#8B5CF6',
      accent2: '#A78BFA',
      accentSoft: '#221A3D',
      accentText: '#FFFFFF',
      gradFrom: '#8B5CF6',
      gradTo: '#EC4899',
      success: '#22C55E',
      successSoft: '#0E2A18',
      warning: '#EAB308',
      warningSoft: '#2E2606',
      danger: '#EF4444',
      dangerSoft: '#2E0E0E',
      ...roles.dark,
      sidebarBg: '#050506',
      sidebarText: '#C4C4CC',
      sidebarMuted: '#5E5E68',
      sidebarActiveBg: '#1D1633',
      sidebarActiveText: '#FFFFFF',
      sidebarBorder: '#141418',
    },
  },
  {
    id: 'ivory',
    name: 'Ivory',
    description: 'Warm paper tones with a terracotta accent.',
    mode: 'light',
    colors: {
      bg: '#F6F2EA',
      surface: '#FFFDF8',
      surface2: '#F1EBE1',
      surface3: '#E7DECF',
      border: '#E4DACA',
      borderStrong: '#CDBFA9',
      text: '#231C14',
      text2: '#5C5043',
      text3: '#8C7F6F',
      accent: '#B4532A',
      accent2: '#9A4422',
      accentSoft: '#F5E3D8',
      accentText: '#FFFFFF',
      gradFrom: '#B4532A',
      gradTo: '#D4A24C',
      success: '#3F7D3A',
      successSoft: '#E5F0E1',
      warning: '#A8620F',
      warningSoft: '#FAEAD1',
      danger: '#B42318',
      dangerSoft: '#F9E1DE',
      ...roles.light,
      owner: '#9A6A12',
      sidebarBg: '#EEE6D8',
      sidebarText: '#4A3F33',
      sidebarMuted: '#948672',
      sidebarActiveBg: '#FFFDF8',
      sidebarActiveText: '#9A4422',
      sidebarBorder: '#E0D5C2',
    },
  },
  {
    id: 'aurora',
    name: 'Aurora',
    description: 'Dark teal with a northern-lights gradient.',
    mode: 'dark',
    colors: {
      bg: '#061519',
      surface: '#0B2026',
      surface2: '#102A31',
      surface3: '#16353D',
      border: '#18343B',
      borderStrong: '#244E57',
      text: '#E2F4F3',
      text2: '#9BC3C3',
      text3: '#5E898B',
      accent: '#2DD4BF',
      accent2: '#5EEAD4',
      accentSoft: '#0F3A36',
      accentText: '#04201C',
      gradFrom: '#2DD4BF',
      gradTo: '#A855F7',
      success: '#4ADE80',
      successSoft: '#0E3020',
      warning: '#FBBF24',
      warningSoft: '#352A0B',
      danger: '#FB7185',
      dangerSoft: '#3A1520',
      ...roles.dark,
      support: '#2DD4BF',
      supportSoft: '#0F3A36',
      sidebarBg: '#081B20',
      sidebarText: '#B5D6D6',
      sidebarMuted: '#557D80',
      sidebarActiveBg: '#0F3A36',
      sidebarActiveText: '#5EEAD4',
      sidebarBorder: '#10292F',
    },
  },
  {
    id: 'contrast',
    name: 'High contrast',
    description: 'Maximum legibility and strong outlines.',
    mode: 'light',
    colors: {
      bg: '#FFFFFF',
      surface: '#FFFFFF',
      surface2: '#F2F2F2',
      surface3: '#E0E0E0',
      border: '#1A1A1A',
      borderStrong: '#000000',
      text: '#000000',
      text2: '#1F1F1F',
      text3: '#3D3D3D',
      accent: '#0040C1',
      accent2: '#002F8F',
      accentSoft: '#DCE6FF',
      accentText: '#FFFFFF',
      gradFrom: '#0040C1',
      gradTo: '#0040C1',
      success: '#0B6B2E',
      successSoft: '#DDF2E4',
      warning: '#8A4B00',
      warningSoft: '#FFEBCC',
      danger: '#B00020',
      dangerSoft: '#FFE0E5',
      ...roles.light,
      sidebarBg: '#FFFFFF',
      sidebarText: '#000000',
      sidebarMuted: '#3D3D3D',
      sidebarActiveBg: '#000000',
      sidebarActiveText: '#FFFFFF',
      sidebarBorder: '#000000',
    },
  },
];

export const THEME_IDS = THEMES.map((t) => t.id) as readonly string[];
export const DEFAULT_LIGHT_THEME = 'daylight';
export const DEFAULT_DARK_THEME = 'midnight';

export function getTheme(id: string | undefined | null): Theme {
  return THEMES.find((t) => t.id === id) ?? THEMES[0]!;
}

/** "system" follows the OS light / dark setting. */
export function resolveThemeId(preference: string | undefined | null, prefersDark: boolean): string {
  if (!preference || preference === 'system' || !THEME_IDS.includes(preference)) {
    return prefersDark ? DEFAULT_DARK_THEME : DEFAULT_LIGHT_THEME;
  }
  return preference;
}

/** CSS custom property name for a colour token: surface2 → --surface-2, accentSoft → --accent-soft. */
export function cssVarName(token: string): string {
  return `--${token.replace(/([a-z])([A-Z0-9])/g, '$1-$2').toLowerCase()}`;
}
