// Service registry (docs/FEATURES.md §19 "gap" row): read-only list of named
// services from the SDK's ServiceRegistry (services.json + the Secrets
// section's SecretsManager), a per-service inspect (which credential fields
// are present — never their values), a live connection test, and a doctor
// summary. There is no create/edit wire or SDK API for services.json itself
// — this renders what exists honestly; adding a service means editing
// ~/.goodvibes/tui/services.json directly (same as the TUI today).

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Server, Stethoscope } from "lucide-react";
import { EmptyState, ErrorState, SkeletonBlock, UnavailableState } from "../../components/feedback.tsx";
import { formatError } from "../../lib/errors.ts";
import { useToast } from "../../lib/toast.ts";
import { isSecretsRouteUnavailable, secretsKeys, servicesApi, type ServiceRow, type ServiceTestResult } from "./secrets-api.ts";
import { SETTINGS_POLL_MS } from "./settings-queries.ts";

export function ServicesSection() {
  const { toast } = useToast();
  const [testResults, setTestResults] = useState<Record<string, ServiceTestResult>>({});

  const list = useQuery({
    queryKey: secretsKeys.services,
    queryFn: () => servicesApi.list(),
    retry: false,
    refetchInterval: SETTINGS_POLL_MS,
  });

  const doctor = useQuery({
    queryKey: secretsKeys.doctor,
    queryFn: () => servicesApi.doctor(),
    retry: false,
    enabled: list.isSuccess,
  });

  const testService = useMutation({
    mutationFn: (name: string) => servicesApi.test(name),
    onSuccess: (result, name) => {
      setTestResults((prev) => ({ ...prev, [name]: result.test }));
      toast({
        title: result.test.ok ? "Connection ok" : "Connection failed",
        description: `${name}: ${result.test.status ?? "no response"}${result.test.error ? ` — ${result.test.error}` : ""}`,
        tone: result.test.ok ? "success" : "danger",
      });
    },
    onError: (error: unknown, name) => {
      setTestResults((prev) => ({ ...prev, [name]: { ok: false, status: null, testedUrl: null, error: formatError(error) } }));
    },
  });

  const rows: ServiceRow[] = list.data?.services ?? [];
  const unavailable = list.isError && isSecretsRouteUnavailable(list.error);

  return (
    <section className="settings-services" aria-label="Service registry">
      <div className="section-toolbar">
        <span className="section-toolbar__summary">
          <Server size={14} aria-hidden="true" /> Service registry
          {list.isSuccess ? ` · ${rows.length}` : ""}
        </span>
      </div>

      <p className="settings-secrets__note">
        Named services from <code>{list.data?.servicesFilePath ?? "~/.goodvibes/tui/services.json"}</code>, each
        resolving its credential through the Secrets store above. No create/edit surface exists yet — add a service by
        editing that file (same as the TUI).
      </p>

      {doctor.isSuccess && (
        <div className="settings-services__doctor" role="status">
          <Stethoscope size={13} aria-hidden="true" />
          <span>
            {doctor.data.services.filter((s) => s.configured).length}/{doctor.data.services.length} services configured
            · {doctor.data.secrets.storedKeys} secrets stored
          </span>
        </div>
      )}

      {list.isPending && <SkeletonBlock variant="text" lines={3} />}

      {unavailable && (
        <UnavailableState capability="/app/secrets/services" description="the service registry is not part of this build." />
      )}

      {list.isError && !unavailable && (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} title="Failed to load services" />
      )}

      {list.isSuccess && rows.length === 0 && (
        <EmptyState
          icon={<Server size={28} aria-hidden="true" />}
          title="No services registered"
          description="services.json has no entries yet."
        />
      )}

      {list.isSuccess && rows.length > 0 && (
        <ul className="settings-rows">
          {rows.map((row) => {
            const test = testResults[row.name];
            return (
              <li key={row.name} className="settings-row">
                <div className="settings-row__main">
                  <div className="settings-row__head">
                    <code className="settings-row__key">{row.name}</code>
                    <span className="settings-row__category">{row.authType}</span>
                  </div>
                  {row.baseUrl && <span className="settings-row__value">{row.baseUrl}</span>}
                  <div className="settings-services__flags">
                    {row.hasPrimaryCredential && <span className="badge ok">credential</span>}
                    {row.hasPasswordCredential && <span className="badge ok">password</span>}
                    {row.hasAuthTokenCredential && <span className="badge ok">auth token</span>}
                    {row.hasAppToken && <span className="badge ok">app token</span>}
                    {row.hasWebhookUrl && <span className="badge info">webhook</span>}
                    {row.hasSigningSecret && <span className="badge info">signing secret</span>}
                    {!row.hasPrimaryCredential && !row.hasPasswordCredential && !row.hasAppToken && (
                      <span className="badge neutral">no credential</span>
                    )}
                    {test && (
                      <span className={test.ok ? "badge ok" : "badge bad"}>
                        {test.ok ? `ok (${test.status ?? "—"})` : "failed"}
                      </span>
                    )}
                  </div>
                </div>
                <div className="settings-row__actions">
                  <button
                    type="button"
                    className="settings-row__edit"
                    onClick={() => testService.mutate(row.name)}
                    disabled={testService.isPending && testService.variables === row.name}
                  >
                    {testService.isPending && testService.variables === row.name ? "Testing…" : "Test connection"}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
