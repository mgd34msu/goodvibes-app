// Profiles + profile-sync bundles, and the read-only settings import bridge
// from the TUI/agent (docs/FEATURES.md §19, two rows sharing one tab: both
// are "bring settings in from elsewhere"). Bundle export/import is entirely
// app-local (theme + keybindings + app-own settings, JSON download/upload,
// preview before apply). The TUI/agent bridge is READ-ONLY on the source —
// it previews ~/.goodvibes/<tui|agent>/settings.json (redacted Bun-side
// before it ever reaches this webview) and applies only the two properties
// this app can honestly act on: theme mode and the daemon endpoint.

import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, PackageOpen, Upload } from "lucide-react";
import { ConfirmSurface } from "../../components/ConfirmSurface.tsx";
import { ErrorState, SkeletonBlock, UnavailableState } from "../../components/feedback.tsx";
import { gv } from "../../lib/gv.ts";
import { formatError } from "../../lib/errors.ts";
import { useToast } from "../../lib/toast.ts";
import { useTheme } from "../../lib/theme.ts";
import { requiresDaemonRestart } from "./config-redaction.ts";
import { appOwnSettingsApi, importPreviewApi, isSecretsRouteUnavailable, secretsKeys, type ImportSuggestion } from "./secrets-api.ts";
import {
  applyProfileBundleLocally,
  buildProfileBundle,
  parseProfileBundle,
  serializeProfileBundle,
  type ProfileBundle,
} from "./profile-bundle.ts";

export function ProfilesSection() {
  return (
    <section className="settings-profiles" aria-label="Profiles and settings import">
      <BundleExportImport />
      <TuiAgentImport />
    </section>
  );
}

// ─── this app's own export/import bundle ────────────────────────────────────

function BundleExportImport() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingBundle, setPendingBundle] = useState<ProfileBundle | null>(null);
  const [parseError, setParseError] = useState("");

  const appSettings = useQuery({
    queryKey: secretsKeys.appSettings,
    queryFn: () => appOwnSettingsApi.get(),
    retry: false,
  });

  const applyAppSettings = useMutation({
    mutationFn: (patch: { stopDaemonOnQuit: boolean }) => appOwnSettingsApi.put(patch),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: secretsKeys.appSettings });
    },
  });

  function handleExport(): void {
    const bundle = buildProfileBundle(appSettings.data?.app.stopDaemonOnQuit ?? false);
    const blob = new Blob([serializeProfileBundle(bundle)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `goodvibes-app-profile-${bundle.exportedAt.slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: "Profile bundle exported", tone: "success" });
  }

  async function handleFilePicked(file: File): Promise<void> {
    setParseError("");
    try {
      const text = await file.text();
      setPendingBundle(parseProfileBundle(text));
    } catch (err) {
      setParseError(formatError(err));
    }
  }

  function handleApply(): void {
    if (!pendingBundle) return;
    const patch = applyProfileBundleLocally(pendingBundle);
    applyAppSettings.mutate(patch);
    toast({ title: "Profile bundle applied", description: "Theme and keybinding overrides took effect immediately.", tone: "success" });
    setPendingBundle(null);
  }

  return (
    <div className="settings-profiles__panel">
      <div className="section-toolbar">
        <span className="section-toolbar__summary">
          <PackageOpen size={14} aria-hidden="true" /> Profile bundle
        </span>
      </div>
      <p className="settings-secrets__note">
        Theme, keybinding overrides, and the app-own settings above — one JSON file you can move between machines.
      </p>
      <div className="settings-profiles__actions">
        <button type="button" className="settings-secrets__add" onClick={handleExport}>
          <Download size={13} aria-hidden="true" /> Export bundle
        </button>
        <button type="button" className="settings-secrets__add" onClick={() => fileInputRef.current?.click()}>
          <Upload size={13} aria-hidden="true" /> Import bundle…
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json"
          className="settings-profiles__file-input"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFilePicked(file);
            e.target.value = "";
          }}
        />
      </div>
      {parseError && (
        <p className="settings-editor__error" role="alert">
          {parseError}
        </p>
      )}

      <ConfirmSurface
        open={pendingBundle !== null}
        action="Apply profile bundle"
        target={pendingBundle ? `exported ${pendingBundle.exportedAt.slice(0, 10)}` : ""}
        blastRadius="Overwrites your current theme, density, motion, and any keybinding customizations in this browser."
        confirmLabel="Apply"
        onCancel={() => setPendingBundle(null)}
        onConfirm={handleApply}
      >
        {pendingBundle && (
          <dl className="confirm-surface__facts">
            <dt>Theme</dt>
            <dd>
              {pendingBundle.theme.theme} · {pendingBundle.theme.density} · motion {pendingBundle.theme.motion}
            </dd>
            <dt>Keybinding overrides</dt>
            <dd>{Object.keys(pendingBundle.keybindingOverrides).length}</dd>
            <dt>Stop daemon on quit</dt>
            <dd>{pendingBundle.appSettings.stopDaemonOnQuit ? "yes" : "no"}</dd>
          </dl>
        )}
      </ConfirmSurface>
    </div>
  );
}

// ─── read-only import bridge from tui/agent settings.json ──────────────────

function TuiAgentImport() {
  const { toast } = useToast();
  const theme = useTheme();
  const [source, setSource] = useState<"tui" | "agent">("tui");
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const [confirming, setConfirming] = useState(false);

  const preview = useQuery({
    queryKey: secretsKeys.importPreview(source),
    queryFn: () => importPreviewApi.preview(source),
    retry: false,
  });

  const applyDaemonEndpoint = useMutation({
    mutationFn: (endpoint: string) => {
      const [host, portRaw] = endpoint.split(":");
      const port = Number(portRaw);
      if (!host || !Number.isFinite(port)) throw new Error(`Could not parse daemon endpoint "${endpoint}".`);
      return Promise.all([gv.config.set({ key: "controlPlane.host", value: host }), gv.config.set({ key: "controlPlane.port", value: port })]);
    },
    onSuccess: () => toast({ title: "Daemon endpoint updated", description: "Takes effect after the daemon restarts.", tone: "warning" }),
    onError: (error: unknown) => toast({ title: "Failed to update daemon endpoint", description: formatError(error), tone: "danger" }),
  });

  function toggle(key: string): void {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function applySelected(): void {
    if (!preview.data) return;
    for (const suggestion of preview.data.suggestions) {
      if (!checked.has(suggestion.key)) continue;
      if (suggestion.key === "themeMode") {
        theme.setTheme(suggestion.value === "light" ? "light" : "dark");
      } else if (suggestion.key === "daemonEndpoint") {
        applyDaemonEndpoint.mutate(suggestion.value);
      }
    }
    toast({ title: "Applied selected suggestions", tone: "success" });
    setConfirming(false);
    setChecked(new Set());
  }

  const unavailable = preview.isError && isSecretsRouteUnavailable(preview.error);

  return (
    <div className="settings-profiles__panel">
      <div className="section-toolbar">
        <span className="section-toolbar__summary">Import from TUI / Agent</span>
        <div className="settings-profiles__source" role="radiogroup" aria-label="Import source">
          {(["tui", "agent"] as const).map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={source === s}
              className={source === s ? "settings-pref__option settings-pref__option--active" : "settings-pref__option"}
              onClick={() => {
                setSource(s);
                setChecked(new Set());
              }}
            >
              {s === "tui" ? "goodvibes-tui" : "goodvibes-agent"}
            </button>
          ))}
        </div>
      </div>
      <p className="settings-secrets__note">
        Read-only preview of <code>~/.goodvibes/{source}/settings.json</code> — that file is never modified. Values
        are redacted before leaving the app process.
      </p>

      {preview.isPending && <SkeletonBlock variant="text" lines={3} />}

      {unavailable && (
        <UnavailableState capability="/app/secrets/import-preview" description="the settings import bridge is not part of this build." />
      )}

      {preview.isError && !unavailable && (
        <ErrorState error={preview.error} onRetry={() => void preview.refetch()} title="Failed to preview settings" />
      )}

      {preview.isSuccess && !preview.data.found && (
        <p className="settings-pref__note">No <code>{source}</code> settings file was found on this machine.</p>
      )}

      {preview.isSuccess && preview.data.found && preview.data.suggestions.length === 0 && (
        <p className="settings-pref__note">Found the file, but nothing in it maps onto a setting this app can apply.</p>
      )}

      {preview.isSuccess && preview.data.found && preview.data.suggestions.length > 0 && (
        <>
          <ul className="reg-import__collections">
            {preview.data.suggestions.map((s: ImportSuggestion) => (
              <li key={s.key} className="reg-import__collection">
                <label className="reg-import__check">
                  <input type="checkbox" checked={checked.has(s.key)} onChange={() => toggle(s.key)} />
                  <span className="reg-import__name">{s.label}</span>
                  <code>{s.value}</code>
                </label>
                {s.key === "daemonEndpoint" && <p className="reg-import__samples">Requires a daemon restart to take effect.</p>}
              </li>
            ))}
          </ul>
          <div className="settings-profiles__actions">
            <button
              type="button"
              className="settings-secrets__add"
              disabled={checked.size === 0}
              onClick={() => setConfirming(true)}
            >
              Apply {checked.size > 0 ? checked.size : ""} suggestion{checked.size === 1 ? "" : "s"}
            </button>
          </div>
        </>
      )}

      <ConfirmSurface
        open={confirming}
        action="Apply imported suggestions"
        target={`from ${source}`}
        blastRadius={
          checked.has("daemonEndpoint")
            ? `${requiresDaemonRestart("controlPlane.host") ? "Changes the daemon endpoint (restart required); " : ""}applies the selected settings to this app.`
            : "Applies the selected settings to this app."
        }
        confirmLabel="Apply"
        onCancel={() => setConfirming(false)}
        onConfirm={applySelected}
      />
    </div>
  );
}
