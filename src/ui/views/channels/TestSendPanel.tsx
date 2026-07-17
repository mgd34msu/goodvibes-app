// Test send — the FIRST surface anywhere for channels.test.send (contract
// 1.11): a live probe through the REAL delivery router for one surface, with
// an optional address/body override. TRAP (see gv.ts's channelTest.send
// comment): `delivered:false` with an `error` string in an otherwise-200
// response is the NORMAL failure path — a real attempt the surface rejected
// — never a thrown exception. This renders the real result verbatim either
// way: no try/catch-expect-throw, no invented success.

import { useState, type FormEvent } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Send } from "lucide-react";
import { gv } from "../../lib/gv.ts";
import { formatError } from "../../lib/errors.ts";
import { channelsKeys } from "./keys.ts";
import { readStatusRows, readTestSendResult, type TestSendResult } from "./channels-wire.ts";

export function TestSendPanel() {
  const [surface, setSurface] = useState("");
  const [address, setAddress] = useState("");
  const [body, setBody] = useState("");
  const [result, setResult] = useState<TestSendResult | null>(null);

  // Best-effort suggestions only — a surface that has never been onboarded
  // can still be tested by typing its id, so this list is a convenience, not
  // a validation gate.
  const status = useQuery({
    queryKey: channelsKeys.status,
    queryFn: () => gv.invoke("channels.status"),
    select: readStatusRows,
    retry: false,
  });
  const knownSurfaces = status.data ?? [];

  const send = useMutation({
    mutationFn: (input: { surface: string; address?: string; body?: string }) => gv.channelTest.send(input),
    onSuccess: (data) => setResult(readTestSendResult(data)),
  });

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    const s = surface.trim();
    if (!s || send.isPending) return;
    setResult(null);
    send.mutate({
      surface: s,
      ...(address.trim() ? { address: address.trim() } : {}),
      ...(body.trim() ? { body: body.trim() } : {}),
    });
  }

  return (
    <section className="channels-principals" aria-label="Test send">
      <div className="section-toolbar">
        <span className="section-toolbar__summary">
          <Send size={14} aria-hidden="true" /> Send test message
        </span>
      </div>
      <p className="channels-catalog__desc">
        Sends one real message through the delivery router for a surface — the fastest way to
        confirm a channel is actually wired up end to end.
      </p>
      <form className="channels-policy-form" onSubmit={handleSubmit}>
        <div className="channels-policy-form__grid">
          <label className="channels-field">
            <span>Surface</span>
            <input
              type="text"
              list="test-send-surfaces"
              value={surface}
              onChange={(e) => setSurface(e.target.value)}
              placeholder="slack"
              disabled={send.isPending}
              required
            />
            <datalist id="test-send-surfaces">
              {knownSurfaces.map((row) => (
                <option key={row.id} value={row.surface} />
              ))}
            </datalist>
          </label>
          <label className="channels-field">
            <span>Address (optional)</span>
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="daemon default target"
              disabled={send.isPending}
            />
          </label>
        </div>
        <label className="channels-field">
          <span>Body (optional)</span>
          <textarea
            rows={2}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="daemon default test text"
            disabled={send.isPending}
          />
        </label>
        <div className="channels-invoke__actions">
          <button
            type="submit"
            className="channels-btn channels-btn--primary"
            disabled={send.isPending || !surface.trim()}
          >
            <Send size={13} aria-hidden="true" /> {send.isPending ? "Sending…" : "Send test message"}
          </button>
        </div>
      </form>

      {send.isError && (
        <p className="channels-invoke__error" role="alert">
          {formatError(send.error)}
        </p>
      )}

      {result && (
        <div
          className={
            result.delivered ? "channels-test-result channels-test-result--ok" : "channels-test-result channels-test-result--fail"
          }
          role="status"
        >
          <span className={result.delivered ? "badge ok" : "badge bad"}>
            {result.delivered ? "delivered" : "not delivered"}
          </span>
          <span className="channels-catalog__id">{result.surface}</span>
          {result.delivered && result.responseId && <code>responseId: {result.responseId}</code>}
          {!result.delivered && (
            <span className="channels-test-result__error">{result.error || "The daemon reported no error detail."}</span>
          )}
        </div>
      )}
    </section>
  );
}
