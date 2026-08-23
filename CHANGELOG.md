# Changelog

All notable changes to the GoodVibes app.

---

## [0.4.4] - 2026-08-23

### Changes

- **The pins move to sdk 2.0.23, with tui 2.0.21 carrying daemon 1.28.25
  inside.** The platform brings honest calendar auth (a dead Google grant
  reads as an auth failure with a re-authorize pointer), provider auth
  summaries that fold in their routes (a usable subscription sign-in reads
  configured), and the new reasoning-effort surface on the model verbs.
  All five generators re-ran against the current tree, so the operator
  routes, presentation tokens, config schema, feature settings, and device
  capabilities match what the daemon actually ships.
