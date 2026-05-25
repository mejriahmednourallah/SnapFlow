type MetadataUser = {
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
};

type DisplayProfile = {
  email?: string | null;
  full_name?: string | null;
  redmine_login?: string | null;
  redmine_display_name?: string | null;
};

const syntheticRedmineEmail = /^redmine-(\d+)@snapflow\.local$/i;

const clean = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  return value.trim();
};

export const isSyntheticRedmineEmail = (email?: string | null): boolean =>
  Boolean(email && syntheticRedmineEmail.test(email));

export const getUserDisplayName = (user?: MetadataUser | null): string => {
  if (!user) return 'Utilisateur';

  const metadata = user.user_metadata ?? {};
  const redmineLogin = clean(metadata.redmine_login);
  const redmineDisplayName = clean(metadata.redmine_display_name);
  const fullName = clean(metadata.full_name) || clean(metadata.name);

  if (redmineLogin) return redmineLogin;
  if (redmineDisplayName) return redmineDisplayName;
  if (fullName) return fullName;
  if (isSyntheticRedmineEmail(user.email)) return 'Utilisateur Redmine';
  return user.email || 'Utilisateur';
};

export const getProfileDisplayName = (profile?: DisplayProfile | null): string => {
  if (!profile) return 'Utilisateur';

  const fullName = clean(profile.full_name);
  const redmineLogin = clean(profile.redmine_login);
  const redmineDisplayName = clean(profile.redmine_display_name);

  if (fullName) return fullName;
  if (redmineLogin) return redmineLogin;
  if (redmineDisplayName) return redmineDisplayName;
  if (isSyntheticRedmineEmail(profile.email)) return 'Utilisateur Redmine';
  return profile.email || 'Utilisateur';
};
