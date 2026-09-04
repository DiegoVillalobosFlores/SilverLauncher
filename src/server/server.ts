import index from "../ui/index.html";
import { NodeHidPort, type HidPort } from "./hid";
import { DiscoveryService } from "./discovery";
import { createApiHandler, type HttpDependencies } from "./http";
import { KnownDeviceStore, applicationConfigDirectory } from "./persistence";
import { ProfileStore } from "./profiles";

export interface ServerOptions {
  port?: number;
  preferredPort?: number;
}

export interface ApplicationOptions extends ServerOptions {
  hidPort?: HidPort;
  configDir?: string;
  profileStore?: ProfileStore;
  knownDeviceStore?: KnownDeviceStore;
  discovery?: DiscoveryService;
}

export interface SilverApplication {
  server: ReturnType<typeof Bun.serve>;
  discovery: DiscoveryService;
  profiles: ProfileStore;
  knownDevices: KnownDeviceStore;
  close(): Promise<void>;
}

export async function createHttpServer(
  dependencies: HttpDependencies,
  options: ServerOptions = {},
): Promise<ReturnType<typeof Bun.serve>> {
  const api = createApiHandler(dependencies);
  const preferredPort = options.port ?? options.preferredPort ?? configuredPort();
  const apiRoute = async (request: Request): Promise<Response> =>
    (await api(request)) ?? new Response("Not found", { status: 404 });
  const routes = {
    "/": index,
    "/device/:id": index,
    "/api/devices": { GET: apiRoute },
    "/api/devices/stream": { GET: apiRoute },
    "/api/devices/:id/profile/export": { GET: apiRoute },
    "/api/profiles": { GET: apiRoute },
    "/api/profiles/export/:id": { GET: apiRoute },
    "/api/profiles/import": { POST: apiRoute },
    "/api/profiles/mirror": { POST: apiRoute },
    "/*": index,
  };
  const fetch = () => new Response("Not found", { status: 404 });
  try {
    return Bun.serve({ hostname: "127.0.0.1", port: preferredPort, idleTimeout: 0, routes, fetch });
  } catch (error) {
    if (preferredPort === 0 || !isAddressInUse(error)) throw error;
    const fallback = Bun.serve({ hostname: "127.0.0.1", port: 0, idleTimeout: 0, routes, fetch });
    return fallback;
  }
}

export async function createApplication(options: ApplicationOptions = {}): Promise<SilverApplication> {
  const rootDir = applicationConfigDirectory(options.configDir);
  const knownDevices = options.knownDeviceStore ?? new KnownDeviceStore(rootDir);
  const profiles = options.profileStore ?? new ProfileStore({ rootDir });
  await profiles.load();
  const discovery = options.discovery ?? new DiscoveryService({
    hidPort: options.hidPort ?? new NodeHidPort(),
    knownDevices,
    profileStore: profiles,
  });
  await discovery.start();
  const server = await createHttpServer({ discovery, profiles }, options);
  console.log(`Silver Launcher serving at ${server.url}`);
  return {
    server,
    discovery,
    profiles,
    knownDevices,
    async close() {
      await server.stop(true);
      await discovery.stop();
    },
  };
}

export async function startServer(options: ApplicationOptions = {}): Promise<SilverApplication> {
  return createApplication(options);
}

function configuredPort(): number {
  const value = Number(process.env.PORT ?? 3000);
  return Number.isInteger(value) && value >= 0 && value <= 65_535 ? value : 3000;
}

function isAddressInUse(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: string; message?: string };
  return candidate.code === "EADDRINUSE" || candidate.message?.includes("EADDRINUSE") === true;
}
