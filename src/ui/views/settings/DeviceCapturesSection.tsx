// Retained device captures: the list, and one viewer for the bytes
// (devices.artifacts.list / devices.artifacts.read).
//
// These are pictures taken on someone's phone. They are inside a retention
// window the daemon enforces, and each one carries the reason the request stated
// when it was taken, so a person reading this page can see WHY a picture of
// their screen exists as well as that it does.
//
// THE BYTES ARE UNTRUSTED CONTENT. They came off a device, through the daemon,
// and are about to be handed to a renderer running on this app's own origin.
// Every decision about how to render them is made in devices.ts and enforced
// here in one place:
//   • a Blob is only ever built with safeBlobMediaType(), so an object URL can
//     only be an allowlisted raster image or an opaque octet-stream download,
//     never a same-origin HTML or SVG document;
//   • text is put in a text node, never into markup;
//   • anything else is offered as a download and not rendered at all.
//
// The daemon re-hashes a capture against the digest recorded when it was taken
// and refuses to serve a mismatch, so a payload that arrives and will not decode
// is reported rather than rendered as a blank picture: the failure is in the
// answer, not in the capture, and hiding it would be the wrong lesson.

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, Download, Eye, RefreshCw } from "lucide-react";
import { gv } from "../../lib/gv.ts";
import { queryKeys } from "../../lib/queries.ts";
import { formatError, isMethodUnavailableError } from "../../lib/errors.ts";
import { EmptyState, ErrorState, SkeletonBlock, UnavailableState } from "../../components/feedback.tsx";
import {
  captureFileName,
  captureRendering,
  decodeCaptureBytes,
  decodeCaptureText,
  decodedLengthMatches,
  expiryLine,
  formatBytes,
  formatWhen,
  readDeviceArtifactContent,
  readDeviceArtifactList,
  readDeviceNodesSnapshot,
  safeBlobMediaType,
  type DeviceArtifact,
} from "./devices.ts";

/** How the open capture is being shown, or why it is not. */
type CaptureView =
  | { phase: "idle" }
  | { phase: "loading"; artifactId: string }
  | { phase: "image"; artifact: DeviceArtifact; url: string; truncated: boolean }
  | { phase: "text"; artifact: DeviceArtifact; text: string; truncated: boolean }
  | { phase: "binary"; artifact: DeviceArtifact; url: string; truncated: boolean }
  | { phase: "undecodable"; artifact: DeviceArtifact }
  | { phase: "malformed"; artifactId: string }
  | { phase: "error"; artifactId: string; message: string };

/** Text previews are capped so a large capture cannot lock the window up. */
const TEXT_PREVIEW_CAP = 64 * 1024;

function triggerDownload(url: string, filename: string): void {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

export function DeviceCapturesSection() {
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const queryClient = useQueryClient();
  const [view, setView] = useState<CaptureView>({ phase: "idle" });

  const artifacts = useQuery({
    queryKey: queryKeys.deviceArtifacts,
    queryFn: () => gv.devices.artifacts.list(),
    retry: false,
  });

  const nodes = useQuery({
    queryKey: queryKeys.deviceNodes,
    queryFn: () => gv.devices.nodes.list(),
    retry: false,
  });

  const parsed = useMemo(() => readDeviceArtifactList(artifacts.data), [artifacts.data]);
  const nodeLabels = useMemo(() => {
    const snapshot = readDeviceNodesSnapshot(nodes.data);
    return new Map((snapshot?.nodes ?? []).map((node) => [node.nodeId, node.label]));
  }, [nodes.data]);

  // Object URLs are created here and revoked when the view moves on or the
  // section unmounts, so a session of flicking through captures does not leave
  // a pile of live blobs behind.
  useEffect(() => {
    const url = view.phase === "image" || view.phase === "binary" ? view.url : "";
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [view]);

  const open = useMutation({
    mutationFn: (artifactId: string) => gv.devices.artifacts.read(artifactId),
    onMutate: (artifactId: string) => {
      setView({ phase: "loading", artifactId });
    },
    onSuccess: (result, artifactId) => {
      // A response landing after this section unmounted (tab switched away
      // mid-read) must not mint an object URL nothing will ever revoke.
      if (!mountedRef.current) return;
      const content = readDeviceArtifactContent(result);
      if (content === null) {
        setView({ phase: "malformed", artifactId });
        return;
      }
      const bytes = decodeCaptureBytes(content.dataBase64);
      if (bytes === null) {
        setView({ phase: "undecodable", artifact: content.artifact });
        return;
      }
      const truncated = !decodedLengthMatches(content.artifact, bytes);
      const rendering = captureRendering(content.artifact.mediaType);
      if (rendering === "text") {
        const text = decodeCaptureText(bytes);
        setView({
          phase: "text",
          artifact: content.artifact,
          text: text.length > TEXT_PREVIEW_CAP ? text.slice(0, TEXT_PREVIEW_CAP) : text,
          truncated,
        });
        return;
      }
      // One chokepoint for every object URL in this section: the media type is
      // laundered through the allowlist before a Blob is ever built.
      const blob = new Blob([bytes], { type: safeBlobMediaType(content.artifact.mediaType) });
      const url = URL.createObjectURL(blob);
      setView(
        rendering === "image"
          ? { phase: "image", artifact: content.artifact, url, truncated }
          : { phase: "binary", artifact: content.artifact, url, truncated },
      );
    },
    onError: (error: unknown, artifactId) => {
      // A 404 here is the honest one the daemon documents: expired, swept,
      // missing, or failing its digest re-check, and its message names which.
      setView({ phase: "error", artifactId, message: formatError(error) });
    },
  });

  const unavailable = artifacts.isError && isMethodUnavailableError(artifacts.error);

  return (
    <section className="settings-device-captures" aria-label="Retained device captures">
      <div className="section-toolbar">
        <span className="section-toolbar__summary">
          <Camera size={14} aria-hidden="true" /> Retained captures
        </span>
        <button
          type="button"
          onClick={() => {
            setView({ phase: "idle" });
            void queryClient.invalidateQueries({ queryKey: queryKeys.deviceArtifacts });
          }}
          disabled={artifacts.isFetching}
        >
          <RefreshCw size={14} aria-hidden="true" className={artifacts.isFetching ? "spinning" : undefined} /> Refresh
        </button>
      </div>

      {artifacts.isPending && <SkeletonBlock variant="text" lines={3} />}

      {unavailable && (
        <UnavailableState
          capability="devices.artifacts.list"
          description="this daemon does not serve the paired-device verbs, so it keeps no device captures."
        />
      )}

      {artifacts.isError && !unavailable && (
        <ErrorState
          error={artifacts.error}
          onRetry={() => void artifacts.refetch()}
          title="Failed to read retained captures"
        />
      )}

      {artifacts.isSuccess && parsed === null && (
        <div className="settings-devices__malformed" role="status">
          <strong>The daemon answered without a capture list</strong>
          <span>devices.artifacts.list returned a body with no `artifacts` array, so nothing is shown.</span>
        </div>
      )}

      {parsed !== null && (
        <>
          <p className="settings-device-captures__description">
            Captures are deleted after {parsed.retentionHours} hours by the daemon, whether or not anyone looks
            at them. {parsed.retained} kept right now.
          </p>

          {parsed.artifacts.length === 0 ? (
            <EmptyState
              title="No captures kept"
              description="No camera or screen capture is inside its retention window. Capabilities that only read data (a location fix, the clipboard) keep nothing at all."
            />
          ) : (
            <ul className="settings-device-captures__list">
              {parsed.artifacts.map((artifact) => (
                <li key={artifact.artifactId} className="settings-device-captures__row">
                  <div>
                    <strong>{artifact.capabilityId}</strong>
                    <div className="settings-device-captures__detail">
                      {nodeLabels.get(artifact.nodeId) ?? artifact.nodeId} · {artifact.mediaType || "unreported type"}{" "}
                      · {formatBytes(artifact.byteLength)}
                    </div>
                    <div className="settings-device-captures__detail">
                      Taken {formatWhen(artifact.capturedAt)} · {expiryLine(artifact.expiresAt)}
                    </div>
                    {artifact.reason && (
                      <div className="settings-device-captures__reason">Asked for: {artifact.reason}</div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => open.mutate(artifact.artifactId)}
                    disabled={open.isPending}
                    aria-label={`Open the capture from ${artifact.capabilityId}`}
                  >
                    <Eye size={14} aria-hidden="true" /> Open
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {view.phase === "loading" && <SkeletonBlock variant="block" />}

      {view.phase === "malformed" && (
        <p className="settings-device-captures__viewer-note" role="status">
          The daemon answered for {view.artifactId} without any bytes, so there is nothing to show. That is a
          malformed answer, not an empty capture.
        </p>
      )}

      {view.phase === "undecodable" && (
        <p className="settings-device-captures__viewer-note" role="alert">
          The bytes for this capture did not decode. The daemon checks them against the digest recorded when the
          capture was taken, so this is a problem with the answer rather than with the picture.
        </p>
      )}

      {view.phase === "error" && (
        <p className="settings-device-captures__viewer-note" role="alert">
          {view.message}
        </p>
      )}

      {(view.phase === "image" || view.phase === "text" || view.phase === "binary") && (
        <div className="settings-device-captures__viewer">
          <div className="settings-device-captures__viewer-head">
            <strong>{view.artifact.capabilityId}</strong>
            <button
              type="button"
              onClick={() => {
                if (view.phase === "text") {
                  // Downloaded as an opaque stream rather than as its claimed
                  // type, for the same reason the blob above is laundered.
                  const url = URL.createObjectURL(new Blob([view.text], { type: "application/octet-stream" }));
                  triggerDownload(url, captureFileName(view.artifact));
                  setTimeout(() => URL.revokeObjectURL(url), 10_000);
                  return;
                }
                triggerDownload(view.url, captureFileName(view.artifact));
              }}
            >
              <Download size={14} aria-hidden="true" /> Download
            </button>
          </div>

          {view.truncated && (
            <p className="settings-device-captures__viewer-note" role="alert">
              This capture arrived shorter than the {formatBytes(view.artifact.byteLength)} its record claims, so
              what is shown is not all of it.
            </p>
          )}

          {view.phase === "image" && (
            <img
              className="settings-device-captures__image"
              src={view.url}
              alt={`Capture from ${view.artifact.capabilityId}, taken ${formatWhen(view.artifact.capturedAt)}`}
            />
          )}

          {view.phase === "text" && <pre className="settings-device-captures__text">{view.text}</pre>}

          {view.phase === "binary" && (
            <p className="settings-device-captures__viewer-note">
              This capture is a {view.artifact.mediaType || "type this app does not recognise"}, which is not shown
              here. Download it and open it in something that handles that format.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
