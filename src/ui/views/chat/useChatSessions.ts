// Session rail data: daemon list (TanStack Query, queryKeys.chatSessions)
// merged over the localStorage warm-start cache and local optimistic
// creations. Mutations: create / rename / close / delete — delete runs the
// webui "proof-of-gone" reconcile: after the verb, refetch the list and only
// treat the session as gone when the daemon stops listing it (delete-means-
// delete; a lying success surfaces as an honest error instead).

import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { gv } from "../../lib/gv.ts";
import { queryKeys } from "../../lib/queries.ts";
import { isSessionActiveError } from "../../lib/errors.ts";
import {
  companionSessionFromDetail,
  companionSessionsFromListResponse,
  extractSessionId,
  mergeCompanionSessions,
  readStoredCompanionSessions,
  writeStoredCompanionSessions,
} from "./companion-chat.ts";

export interface UseChatSessionsReturn {
  /** Merged rail items (daemon truth over warm-start cache), newest first. */
  sessionItems: unknown[];
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => void;
  addLocalSession: (session: unknown) => void;
  updateLocalSession: (sessionId: string, session: unknown) => void;
  /** Drop a session from local caches (session-missing reconcile). */
  dropLocalSession: (sessionId: string) => void;
  createSession: (input?: { title?: string; provider?: string; model?: string; systemPrompt?: string }) => Promise<string>;
  renameSession: (sessionId: string, title: string) => void;
  renameError: unknown;
  closeSession: (sessionId: string) => Promise<void>;
  /** Resolves true when the daemon list confirms the session is gone. */
  deleteSession: (sessionId: string) => Promise<boolean>;
  deletePending: boolean;
}

export interface UseChatSessionsOptions {
  /** Gate the fallback poll below on the caller's own visibility signal
   * (ChatView is a keep-alive view — this hook stays mounted, and React
   * Query's refetchInterval only pauses for document/window visibility, not
   * an ancestor's display:none, so the caller has to say so explicitly;
   * checklist item 18). Defaults to true so other callers are unaffected. */
  pollingEnabled?: boolean;
}

export function useChatSessions(options: UseChatSessionsOptions = {}): UseChatSessionsReturn {
  const { pollingEnabled = true } = options;
  const queryClient = useQueryClient();
  const [localSessions, setLocalSessions] = useState<unknown[]>(() => readStoredCompanionSessions());

  const sessions = useQuery({
    queryKey: queryKeys.chatSessions,
    queryFn: () => gv.chat.sessions.list(),
    // Companion-chat emits NO wire event for external mutations (verified
    // against the live daemon 2026-07-07): sessions created by other surfaces
    // never invalidate. Honest fallback poll, same rationale as fleet — but
    // only while the caller says this is actually visible.
    refetchInterval: pollingEnabled ? 15_000 : false,
  });

  const fetchedSessions = useMemo(() => companionSessionsFromListResponse(sessions.data), [sessions.data]);

  const sessionItems = useMemo(
    () => mergeCompanionSessions(localSessions, fetchedSessions),
    [fetchedSessions, localSessions],
  );

  // Persist the merged list as the next launch's warm start.
  useEffect(() => {
    if (sessions.isSuccess) writeStoredCompanionSessions(sessionItems);
  }, [sessionItems, sessions.isSuccess]);

  const invalidateSessions = useCallback(
    () => queryClient.invalidateQueries({ queryKey: queryKeys.chatSessions }),
    [queryClient],
  );

  const addLocalSession = useCallback((session: unknown) => {
    setLocalSessions((current) => mergeCompanionSessions(current, [session]));
  }, []);

  const updateLocalSession = useCallback((sessionId: string, session: unknown) => {
    setLocalSessions((current) =>
      mergeCompanionSessions(
        current.filter((entry) => extractSessionId(entry) !== sessionId),
        [session],
      ),
    );
  }, []);

  const dropLocalSession = useCallback((sessionId: string) => {
    setLocalSessions((current) => current.filter((entry) => extractSessionId(entry) !== sessionId));
    writeStoredCompanionSessions(readStoredCompanionSessions().filter((entry) => extractSessionId(entry) !== sessionId));
  }, []);

  const createSession = useCallback(
    async (input?: { title?: string; provider?: string; model?: string; systemPrompt?: string }) => {
      const created = await gv.chat.sessions.create({ title: "New Chat", ...input });
      const sessionId = extractSessionId(created);
      const detail = companionSessionFromDetail(created);
      addLocalSession(
        extractSessionId(detail)
          ? detail
          : {
              id: sessionId,
              sessionId,
              kind: "companion-chat",
              title: input?.title ?? "New Chat",
              status: "active",
              createdAt: Date.now(),
              updatedAt: Date.now(),
            },
      );
      await invalidateSessions();
      return sessionId;
    },
    [addLocalSession, invalidateSessions],
  );

  const renameMutation = useMutation({
    mutationFn: ({ sessionId, title }: { sessionId: string; title: string }) =>
      gv.chat.sessions.update(sessionId, { title }),
    onSuccess: async (result, variables) => {
      updateLocalSession(
        variables.sessionId,
        companionSessionFromDetail(result) ?? { sessionId: variables.sessionId, title: variables.title },
      );
      await invalidateSessions();
    },
  });

  const closeSession = useCallback(
    async (sessionId: string) => {
      await gv.chat.sessions.close(sessionId);
      await invalidateSessions();
    },
    [invalidateSessions],
  );

  const deleteMutation = useMutation<boolean, Error, { sessionId: string }>({
    mutationFn: async ({ sessionId }) => {
      try {
        await gv.chat.sessions.delete(sessionId);
      } catch (error) {
        // The daemon requires close-before-delete on an active session.
        if (!isSessionActiveError(error)) throw error instanceof Error ? error : new Error(String(error));
        await gv.chat.sessions.close(sessionId);
        await gv.chat.sessions.delete(sessionId);
      }
      // Proof-of-gone: only believe the delete once the list stops naming it.
      const fresh = await queryClient.fetchQuery({
        queryKey: queryKeys.chatSessions,
        queryFn: () => gv.chat.sessions.list(),
      });
      const stillListed = companionSessionsFromListResponse(fresh).some(
        (session) => extractSessionId(session) === sessionId,
      );
      if (!stillListed) dropLocalSession(sessionId);
      return !stillListed;
    },
  });

  const deleteSession = useCallback(
    (sessionId: string) => deleteMutation.mutateAsync({ sessionId }),
    [deleteMutation],
  );

  return {
    sessionItems,
    isLoading: sessions.isLoading && sessionItems.length === 0,
    isError: sessions.isError,
    error: sessions.error,
    refetch: () => void sessions.refetch(),
    addLocalSession,
    updateLocalSession,
    dropLocalSession,
    createSession,
    renameSession: (sessionId, title) => renameMutation.mutate({ sessionId, title }),
    renameError: renameMutation.error,
    closeSession,
    deleteSession,
    deletePending: deleteMutation.isPending,
  };
}
