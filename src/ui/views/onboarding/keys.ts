// Local TanStack Query key prefixes owned by this view. Shared foundation
// keys (config, providers, authCurrent, appHealth) come from ../../lib/queries.ts
// and are reused as-is; this file only adds the keys this view introduces.

export const onboardingKeys = {
  /** GET security.settings, read for the permissions-mode pick's live audit. */
  security: ["onboarding", "security"] as const,
};
