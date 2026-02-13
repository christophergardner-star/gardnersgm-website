/**
 * GGM Field App — Design Theme
 * Matches the Gardners Ground Maintenance email templates.
 * 
 * Primary: #2E7D32 (green)
 * Gradient: #2E7D32 → #4CAF50
 * Dark footer: #333
 * Cards: #fff with #f8faf8 tinted sections
 * Font: System default (closest to Arial on mobile)
 */

export const Colors = {
  // Primary brand
  primary:       '#2E7D32',
  primaryDark:   '#1B5E20',
  primaryLight:  '#4CAF50',
  primaryPale:   '#E8F5E9',
  primaryTint:   '#f8faf8',

  // Accent
  accentBlue:    '#1565C0',
  accentOrange:  '#E65100',
  gold:          '#FFD700',

  // Backgrounds
  background:    '#f4f7f4',
  card:          '#ffffff',
  cardTint:      '#f8faf8',
  cardAlt:       '#f0f5f0',
  inputBg:       '#f5f5f5',
  headerGradientStart: '#2E7D32',
  headerGradientEnd:   '#4CAF50',
  footerBg:      '#333333',

  // Text
  textPrimary:   '#333333',
  textSecondary: '#555555',
  textMuted:     '#666666',
  textLight:     '#999999',
  textWhite:     '#ffffff',
  textOnPrimary: '#ffffff',

  // Status
  success:       '#2E7D32',
  successBg:     '#E8F5E9',
  successBorder: '#A5D6A7',
  warning:       '#F57F17',
  warningBg:     '#FFF8E1',
  warningBorder: '#FFE082',
  error:         '#E65100',
  errorBg:       '#FFF3E0',
  errorBorder:   '#FFE0B2',
  info:          '#1565C0',
  infoBg:        '#E3F2FD',
  infoBorder:    '#90CAF9',

  // Borders
  border:        '#e0e8e0',
  borderLight:   '#e8ede8',
  divider:       '#e0e0e0',

  // Misc
  shadow:        'rgba(0,0,0,0.08)',
  overlay:       'rgba(0,0,0,0.5)',
};

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
};

export const BorderRadius = {
  sm: 6,
  md: 8,
  lg: 12,
  xl: 16,
  pill: 50,
};

export const Typography = {
  // Matching email Arial styling
  h1: {
    fontSize: 24,
    fontWeight: '700',
    color: Colors.textWhite,
    letterSpacing: 0.3,
  },
  h2: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.primary,
  },
  h3: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  body: {
    fontSize: 14,
    fontWeight: '400',
    color: Colors.textSecondary,
    lineHeight: 22,
  },
  bodyBold: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  caption: {
    fontSize: 12,
    fontWeight: '400',
    color: Colors.textMuted,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textMuted,
  },
  small: {
    fontSize: 11,
    fontWeight: '400',
    color: Colors.textLight,
  },
  button: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textWhite,
  },
  kpi: {
    fontSize: 28,
    fontWeight: '700',
    color: Colors.primary,
  },
};

export const Shadows = {
  card: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 3,
  },
  header: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 5,
  },
  button: {
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 3,
  },
};
