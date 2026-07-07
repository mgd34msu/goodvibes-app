// PROCESS-LOCAL environment reads/normalization for the app's own process.
// This module must be the FIRST import of the entrypoint. Nothing outside this
// process is ever touched, and the inherited environment is NOT modified:
// unsetting GDK_SCALE here or at spawn time breaks this WebKitGTK stack
// outright (black/white blob + SIGILL crash, verified live 2026-07-07) — so we
// record the inherited scale and let the UI compensate instead (see
// /app/health display.gdkScale and src/ui/main.tsx).

// Linux WebKitGTK renders blank without this (verified on Arch — docs/ARCHITECTURE.md §1).
process.env["WEBKIT_DISABLE_DMABUF_RENDERER"] ??= "1";

/**
 * The GDK integer scale this process inherited (1 when unset/invalid). On
 * X11/XWayland GTK multiplies all rendering by it, so devicePixelRatio in the
 * webview equals this value even on a scale-1.0 monitor; GTK4 Wayland apps
 * ignore GDK_SCALE entirely, which is why only this app is affected.
 */
export function inheritedGdkScale(): number {
  if (process.platform !== "linux") return 1; // GDK is a Linux-only concern
  const raw = Number(process.env["GDK_SCALE"] ?? "1");
  return Number.isInteger(raw) && raw >= 1 && raw <= 4 ? raw : 1;
}
