import {
  ProfileCollisionError,
  ProfileStore,
  ProfileValidationError,
  validateProfile,
  type CollisionMode,
  type Profile,
} from "./profiles";
import {
  registryEntryForModel,
  isFeature,
  type Feature,
  type RegistryEntry,
} from "./registry";
import { DiscoveryService, type DeviceState, type DiscoverySnapshot } from "./discovery";

export interface HttpDependencies {
  discovery: DiscoveryService;
  profiles: ProfileStore;
  registry?: readonly RegistryEntry[];
}

export interface MirrorTargetReport {
  id: string;
  deviceName?: string;
  included: boolean;
  connected: boolean;
  supported: Feature[];
  dropped: Feature[];
  reason?: string;
}

export interface MirrorReport {
  sourceId: string;
  sourceProfile: string;
  requiresConfirmation: boolean;
  confirmed: boolean;
  targets: MirrorTargetReport[];
}

export function createApiHandler(dependencies: HttpDependencies): (request: Request) => Promise<Response | undefined> {
  const registry = dependencies.registry ?? dependencies.discovery.registry;
  return async (request) => {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return undefined;

    try {
      if (request.method === "GET" && url.pathname === "/api/devices") {
        return json(dependencies.discovery.getSnapshot());
      }
      if (request.method === "GET" && url.pathname === "/api/devices/stream") {
        return createSseResponse(request, dependencies.discovery);
      }
      if (request.method === "GET" && url.pathname === "/api/profiles") {
        return json({ profiles: dependencies.profiles.list(), invalid: dependencies.profiles.invalidProfiles() });
      }
      if (request.method === "GET" && url.pathname.startsWith("/api/profiles/export/")) {
        const id = decodePathPart(url.pathname.slice("/api/profiles/export/".length));
        return exportProfile(id, dependencies);
      }
      if (request.method === "GET" && url.pathname.endsWith("/profile/export")) {
        const prefix = "/api/devices/";
        if (url.pathname.startsWith(prefix)) {
          const id = decodePathPart(url.pathname.slice(prefix.length, -"/profile/export".length));
          return exportProfile(id, dependencies);
        }
      }
      if (request.method === "POST" && url.pathname === "/api/profiles/import") {
        return await importProfile(request, dependencies, registry);
      }
      if (request.method === "POST" && url.pathname === "/api/profiles/mirror") {
        return await mirrorProfiles(request, dependencies);
      }
      return json({ error: "Not found" }, 404);
    } catch (error) {
      return json({ error: errorMessage(error) }, 500);
    }
  };
}

async function exportProfile(id: string, dependencies: HttpDependencies): Promise<Response> {
  const device = dependencies.discovery.getSnapshot().devices.find((candidate) => candidate.id === id);
  if (!device) return json({ error: "Device not found" }, 404);
  if (!device.profileName) return json({ error: "This device has no active profile" }, 404);
  const profile = dependencies.profiles.get(device.model, device.profileName);
  if (!profile) return json({ error: "This device has no active profile" }, 404);
  const filename = `${slugifyFilename(profile.name)}.json`;
  return new Response(`${JSON.stringify(profile, null, 2)}\n`, {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}

async function importProfile(
  request: Request,
  dependencies: HttpDependencies,
  registry: readonly RegistryEntry[],
): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "The uploaded file is not valid JSON" }, 400);
  }
  const wrapper = isRecord(body) && "profile" in body ? body : undefined;
  const rawProfile = wrapper?.profile ?? body;
  const validation = validateProfile(rawProfile);
  if (!validation.valid) return json({ error: validation.reason }, 400);
  if (!registryEntryForModel(validation.profile.model, registry)) {
    return json({ error: `Unsupported model "${validation.profile.model}"` }, 400);
  }

  const requestedCollision = wrapper && typeof wrapper.collision === "string" ? wrapper.collision : undefined;
  const collision = isCollisionMode(requestedCollision) ? requestedCollision : "reject";
  try {
    const result = await dependencies.profiles.save(validation.profile, collision);
    return json({ imported: result.profile, replaced: result.replaced, renamed: result.renamed }, 201);
  } catch (error) {
    if (error instanceof ProfileCollisionError) {
      return json({
        error: error.message,
        code: error.code,
        existing: error.existing,
        options: ["replace", "keep-both"],
      }, 409);
    }
    if (error instanceof ProfileValidationError) return json({ error: error.message }, 400);
    throw error;
  }
}

async function mirrorProfiles(request: Request, dependencies: HttpDependencies): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "The mirror request must be valid JSON" }, 400);
  }
  if (!isRecord(body) || typeof body.sourceId !== "string" || !Array.isArray(body.targetIds)) {
    return json({ error: "sourceId and targetIds are required" }, 400);
  }
  const sourceId = body.sourceId;
  const targetIds = body.targetIds.filter((value): value is string => typeof value === "string");
  const confirm = body.confirm === true;
  const snapshot = dependencies.discovery.getSnapshot();
  const source = snapshot.devices.find((device) => device.id === sourceId);
  if (!source) return json({ error: "Source device not found" }, 404);
  if (!source.profileName) return json({ error: "Source device has no active profile" }, 400);
  const sourceProfile = dependencies.profiles.get(source.model, source.profileName);
  if (!sourceProfile) return json({ error: "Source device has no active profile" }, 400);

  const sourceFeatures = Object.keys(sourceProfile.settings).filter(isFeature);
  const targets: MirrorTargetReport[] = [];
  const targetDevices: DeviceState[] = [];
  for (const targetId of targetIds) {
    const target = snapshot.devices.find((device) => device.id === targetId);
    if (!target) {
      targets.push({ id: targetId, included: false, connected: false, supported: [], dropped: [], reason: "Device not found" });
      continue;
    }
    if (target.id === source.id) {
      targets.push({ id: target.id, deviceName: target.displayName, included: false, connected: target.connection === "connected", supported: [], dropped: [], reason: "The source cannot be its own target" });
      continue;
    }
    const supported = sourceFeatures.filter((feature) => target.capabilities.includes(feature));
    const dropped = sourceFeatures.filter((feature) => !target.capabilities.includes(feature));
    if (supported.length === 0) {
      targets.push({ id: target.id, deviceName: target.displayName, included: false, connected: target.connection === "connected", supported, dropped, reason: "No shared configurable features" });
      continue;
    }
    targets.push({ id: target.id, deviceName: target.displayName, included: true, connected: target.connection === "connected", supported, dropped });
    targetDevices.push(target);
  }

  const report: MirrorReport = {
    sourceId,
    sourceProfile: sourceProfile.name,
    requiresConfirmation: targetDevices.length > 0 && !confirm,
    confirmed: confirm,
    targets,
  };
  if (!confirm) return json(report);

  for (const target of targetDevices) {
    const targetProfileName = target.profileName;
    if (!targetProfileName) continue;
    const current = dependencies.profiles.get(target.model, targetProfileName);
    if (!current) continue;
    const supported = targets.find((candidate) => candidate.id === target.id)?.supported ?? [];
    const settings: Record<string, unknown> = {};
    for (const feature of supported) {
      settings[feature] = sourceProfile.settings[feature];
    }
    await dependencies.profiles.save({
      ...current,
      updatedAt: new Date().toISOString(),
      settings,
    }, "replace");
  }
  return json(report);
}

export function createSseResponse(request: Request, discovery: DiscoveryService): Response {
  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let controllerRef: ReadableStreamDefaultController<Uint8Array> | undefined;
  let closed = false;
  const cleanup = () => {
    if (closed) return;
    closed = true;
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = undefined;
    unsubscribe?.();
    unsubscribe = undefined;
    try {
      controllerRef?.close();
    } catch {
      // The browser may have already cancelled the stream.
    }
  };
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controllerRef = controller;
      const send = (snapshot: DiscoverySnapshot) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(snapshot)}\n\n`));
        } catch {
          cleanup();
        }
      };
      send(discovery.getSnapshot());
      unsubscribe = discovery.subscribe(send);
      heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(": keep-alive\n\n"));
        } catch {
          cleanup();
        }
      }, 5_000);
      if (request.signal.aborted) cleanup();
      else request.signal.addEventListener("abort", cleanup, { once: true });
    },
    cancel() {
      closed = true;
      if (heartbeat) clearInterval(heartbeat);
      heartbeat = undefined;
      unsubscribe?.();
      unsubscribe = undefined;
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-store",
      connection: "keep-alive",
    },
  });
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isCollisionMode(value: unknown): value is CollisionMode {
  return value === "reject" || value === "replace" || value === "keep-both";
}

function decodePathPart(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function slugifyFilename(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "profile";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
