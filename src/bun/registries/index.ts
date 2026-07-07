// /app/registries route handler (docs/ARCHITECTURE.md §5): agent-brain file
// registries under <appHome>/registries/, VIBE.md as a real file, and the
// read-only import bridge from ~/.goodvibes/agent. Registered by
// src/bun/app-routes.ts under the "/app/registries" prefix.
//
// Contract (shared types in src/shared/registries.ts):
//   GET    /app/registries                          {collections}
//   GET    /app/registries/<collection>             {items}
//   POST   /app/registries/<collection>  {item}     {item}   (id/createdAt/updatedAt server-side)
//   GET    /app/registries/<collection>/<id>        {item}
//   PUT    /app/registries/<collection>/<id> {item} {item}
//   DELETE /app/registries/<collection>/<id>        {ok:true}
//   GET    /app/registries/documents/<id>/versions  {versions:[{v,createdAt,content}]}
//   POST   /app/registries/documents/<id>/versions  {content,label?} → appends + updates head
//   GET    /app/registries/vibe                     {content,path,exists}
//   PUT    /app/registries/vibe          {content}  writes the REAL file <appHome>/VIBE.md
//   POST   /app/registries/import/preview {source:"agent"}
//   POST   /app/registries/import/apply   {source,collections:string[]}

import { join } from "node:path";
import { homedir } from "node:os";
import type { AppRouteHandler } from "../app-routes.ts";
import {
  REGISTRY_COLLECTIONS,
  isRegistryCollection,
  type RegistryCollection,
} from "../../shared/registries.ts";
import { RegistryStore } from "./store.ts";
import { appendDocumentVersion, normalizeDocumentOnCreate, readDocumentVersions } from "./documents.ts";
import { readVibe, writeVibe } from "./vibe.ts";
import { applyAgentImport, previewAgentImport } from "./import-bridge.ts";

export interface RegistriesRoutesOptions {
  /** App-owned storage root. Default: $GOODVIBES_APP_HOME or ~/.goodvibes/app */
  appHome?: string;
  /** goodvibes-agent surface root read (READ-ONLY) by the import bridge.
   *  Default: $GOODVIBES_AGENT_HOME/.goodvibes/agent or ~/.goodvibes/agent */
  agentRoot?: string;
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

function errorResponse(status: number, code: string, error: string): Response {
  return json({ error, code }, status);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readBody(req: Request): Promise<Record<string, unknown> | Response> {
  let parsed: unknown;
  try {
    parsed = await req.json();
  } catch {
    return errorResponse(400, "REGISTRY_BAD_JSON", "Request body must be valid JSON");
  }
  if (!isRecord(parsed)) {
    return errorResponse(400, "REGISTRY_BAD_BODY", "Request body must be a JSON object");
  }
  return parsed;
}

export function createRegistriesRoutes(options: RegistriesRoutesOptions = {}): AppRouteHandler {
  const appHome =
    options.appHome ?? process.env.GOODVIBES_APP_HOME ?? join(homedir(), ".goodvibes", "app");
  const agentRoot =
    options.agentRoot ??
    join(process.env.GOODVIBES_AGENT_HOME ?? homedir(), ".goodvibes", "agent");
  const store = new RegistryStore(join(appHome, "registries"));

  return async (req, url) => {
    try {
      const segments = url.pathname
        .slice("/app/registries".length)
        .split("/")
        .filter((part) => part !== "")
        .map(decodeURIComponent);

      // GET /app/registries — collection index (introspection convenience).
      if (segments.length === 0) {
        if (req.method !== "GET") return errorResponse(405, "REGISTRY_METHOD", "Method not allowed");
        return json({ collections: [...REGISTRY_COLLECTIONS] });
      }

      const head = segments[0]!;

      if (head === "vibe" && segments.length === 1) {
        return handleVibe(req, appHome);
      }

      if (head === "import") {
        return handleImport(req, segments, agentRoot, store);
      }

      if (!isRegistryCollection(head)) {
        return errorResponse(404, "REGISTRY_UNKNOWN_COLLECTION", `Unknown registry collection "${head}"`);
      }
      const collection: RegistryCollection = head;

      if (segments.length === 1) return handleCollection(req, store, collection);

      const id = segments[1]!;
      if (segments.length === 2) return handleItem(req, store, collection, id);

      if (collection === "documents" && segments.length === 3 && segments[2] === "versions") {
        return handleDocumentVersions(req, store, id);
      }

      return errorResponse(404, "REGISTRY_NOT_FOUND", "No such registries route");
    } catch (err) {
      console.warn(`[registries] request failed: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
      return errorResponse(500, "REGISTRY_INTERNAL", "Registry operation failed");
    }
  };
}

async function handleCollection(
  req: Request,
  store: RegistryStore,
  collection: RegistryCollection,
): Promise<Response> {
  if (req.method === "GET") {
    return json({ items: await store.list(collection) });
  }
  if (req.method === "POST") {
    const body = await readBody(req);
    if (body instanceof Response) return body;
    if (!isRecord(body.item)) {
      return errorResponse(400, "REGISTRY_BAD_BODY", 'Body must be {item: {...}}');
    }
    const input = collection === "documents" ? normalizeDocumentOnCreate(body.item) : body.item;
    const item = await store.create(collection, input);
    return json({ item }, 201);
  }
  return errorResponse(405, "REGISTRY_METHOD", "Method not allowed");
}

async function handleItem(
  req: Request,
  store: RegistryStore,
  collection: RegistryCollection,
  id: string,
): Promise<Response> {
  if (req.method === "GET") {
    const item = await store.get(collection, id);
    if (item === undefined) return errorResponse(404, "REGISTRY_ITEM_NOT_FOUND", `No ${collection} item "${id}"`);
    return json({ item });
  }
  if (req.method === "PUT") {
    const body = await readBody(req);
    if (body instanceof Response) return body;
    if (!isRecord(body.item)) {
      return errorResponse(400, "REGISTRY_BAD_BODY", 'Body must be {item: {...}}');
    }
    const item = await store.put(collection, id, body.item);
    if (item === undefined) return errorResponse(404, "REGISTRY_ITEM_NOT_FOUND", `No ${collection} item "${id}"`);
    return json({ item });
  }
  if (req.method === "DELETE") {
    const deleted = await store.delete(collection, id);
    if (!deleted) return errorResponse(404, "REGISTRY_ITEM_NOT_FOUND", `No ${collection} item "${id}"`);
    return json({ ok: true });
  }
  return errorResponse(405, "REGISTRY_METHOD", "Method not allowed");
}

async function handleDocumentVersions(req: Request, store: RegistryStore, id: string): Promise<Response> {
  if (req.method === "GET") {
    const item = await store.get("documents", id);
    if (item === undefined) return errorResponse(404, "REGISTRY_ITEM_NOT_FOUND", `No documents item "${id}"`);
    return json({ versions: readDocumentVersions(item) });
  }
  if (req.method === "POST") {
    const body = await readBody(req);
    if (body instanceof Response) return body;
    if (typeof body.content !== "string") {
      return errorResponse(400, "REGISTRY_BAD_BODY", "Body must be {content: string, label?: string}");
    }
    const content = body.content;
    const label = typeof body.label === "string" ? body.label : undefined;
    const result = await store.mutate("documents", (items) => {
      const index = items.findIndex((entry) => entry.id === id);
      const existing = items[index];
      if (index < 0 || existing === undefined) return { items, result: undefined };
      const { item, version } = appendDocumentVersion(existing, content, label);
      const next = [...items];
      next[index] = item;
      return { items: next, result: { item, version } };
    });
    if (result === undefined) return errorResponse(404, "REGISTRY_ITEM_NOT_FOUND", `No documents item "${id}"`);
    return json({ item: result.item, version: result.version }, 201);
  }
  return errorResponse(405, "REGISTRY_METHOD", "Method not allowed");
}

async function handleVibe(req: Request, appHome: string): Promise<Response> {
  if (req.method === "GET") {
    return json(await readVibe(appHome));
  }
  if (req.method === "PUT") {
    const body = await readBody(req);
    if (body instanceof Response) return body;
    if (typeof body.content !== "string") {
      return errorResponse(400, "REGISTRY_BAD_BODY", "Body must be {content: string}");
    }
    return json(await writeVibe(appHome, body.content));
  }
  return errorResponse(405, "REGISTRY_METHOD", "Method not allowed");
}

async function handleImport(
  req: Request,
  segments: string[],
  agentRoot: string,
  store: RegistryStore,
): Promise<Response> {
  const action = segments[1];
  if (segments.length !== 2 || (action !== "preview" && action !== "apply")) {
    return errorResponse(404, "REGISTRY_NOT_FOUND", "No such registries route");
  }
  if (req.method !== "POST") return errorResponse(405, "REGISTRY_METHOD", "Method not allowed");
  const body = await readBody(req);
  if (body instanceof Response) return body;
  if (body.source !== "agent") {
    return errorResponse(400, "REGISTRY_IMPORT_SOURCE", 'Only {source: "agent"} imports are supported');
  }
  if (action === "preview") {
    return json(await previewAgentImport(agentRoot));
  }
  const requestedRaw = Array.isArray(body.collections)
    ? body.collections.filter((entry): entry is string => typeof entry === "string")
    : undefined;
  if (requestedRaw === undefined || requestedRaw.length === 0) {
    return errorResponse(400, "REGISTRY_BAD_BODY", "Body must include collections: string[]");
  }
  const requested: RegistryCollection[] = [];
  for (const name of requestedRaw) {
    if (!isRegistryCollection(name)) {
      return errorResponse(400, "REGISTRY_UNKNOWN_COLLECTION", `Unknown registry collection "${name}"`);
    }
    requested.push(name);
  }
  return json(await applyAgentImport(agentRoot, store, requested));
}
