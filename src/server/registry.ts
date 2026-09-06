import type { HidDescriptor } from "./hid";

export const FEATURES = [
  "dpi-stages",
  "polling-rate",
  "key-remap",
  "macros",
  "lighting",
  "onboard-slots",
] as const;

export type Feature = (typeof FEATURES)[number];
export type DeviceKind = "keyboard" | "mouse";
export type ConnectionPath = "usb" | "dongle";

/**
 * What a matched HID interface is for: naming the attached unit, or carrying
 * configuration commands to it. A device can expose one interface per role.
 */
export type EndpointRole = "identify" | "control";

export interface RegistryMatch {
  vendorId: number;
  productId: number;
  connection: ConnectionPath;
  usagePage?: number;
  usage?: number;
  /** Defaults to "identify" so a match that predates roles keeps its meaning. */
  role?: EndpointRole;
}

export interface LightingZone {
  /** The index the device's protocol uses for this zone. */
  id: number;
  name: string;
}

export interface LightingEffect {
  /** The opaque mode byte this effect is carried as. */
  id: number;
  name: string;
}

export interface LightingDescriptor {
  zones: readonly LightingZone[];
  brightness: { min: number; max: number };
  effects: readonly LightingEffect[];
}

export interface RegistryEntry {
  id: string;
  displayName: string;
  vendor: string;
  kind: DeviceKind;
  matches: readonly RegistryMatch[];
  capabilities: ReadonlySet<Feature>;
  /** Required when the entry declares the "lighting" capability. */
  lighting?: LightingDescriptor;
}

export interface MatchedDescriptor {
  descriptor: HidDescriptor;
  entry: RegistryEntry;
  match: RegistryMatch;
  role: EndpointRole;
}

export interface DeviceEndpoint {
  role: EndpointRole;
  path: string;
  usagePage?: number;
  usage?: number;
  reportId?: number;
}

export type DeviceEndpoints = Partial<Record<EndpointRole, DeviceEndpoint>>;

export interface LogicalDeviceCandidate {
  entry: RegistryEntry;
  match: RegistryMatch;
  descriptor: HidDescriptor;
  descriptors: readonly HidDescriptor[];
  vendorId: number;
  productId: number;
  serialNumber?: string;
  endpoints: DeviceEndpoints;
}

const mouseCapabilities = new Set<Feature>(["dpi-stages", "polling-rate", "key-remap"]);
// The Lofree Hyzen's lighting protocol is unprobed, so the entry cannot state
// what its lighting offers and therefore does not claim the capability.
const keyboardCapabilities = new Set<Feature>(["key-remap", "onboard-slots"]);

// Only led index 0 is a real zone on the Harpe II ACE: indices 1-3 answer with
// constant out-of-range values (mode=2 bright=50, mode=255 bright=240) rather
// than with zone state. Effects are limited to the one mode observed applying.
const harpeLighting: LightingDescriptor = {
  zones: [{ id: 0, name: "Logo" }],
  brightness: { min: 0, max: 4 },
  effects: [{ id: 0, name: "Static" }],
};

// Product IDs are the IDs observed on the supported hardware. The additional
// wired IDs cover the documented wired variants of the same model.
export const DEVICE_REGISTRY: readonly RegistryEntry[] = [
  {
    id: "keychron-m6",
    displayName: "Keychron M6",
    vendor: "Keychron",
    kind: "mouse",
    matches: [
      { vendorId: 0x3434, productId: 0xd028, connection: "dongle", usagePage: 0x01, usage: 0x02 },
      { vendorId: 0x3434, productId: 0xd028, connection: "dongle" },
      { vendorId: 0x3434, productId: 0xd03f, connection: "usb", usagePage: 0x01, usage: 0x02 },
      { vendorId: 0x3434, productId: 0xd03f, connection: "usb" },
      { vendorId: 0x3434, productId: 0xd049, connection: "usb", usagePage: 0x01, usage: 0x02 },
      { vendorId: 0x3434, productId: 0xd049, connection: "usb" },
    ],
    capabilities: mouseCapabilities,
  },
  {
    id: "asus-rog-harpe-ii-ace",
    displayName: "ASUS ROG Harpe II ACE",
    vendor: "ASUS",
    kind: "mouse",
    matches: [
      { vendorId: 0x0b05, productId: 0x1c69, connection: "usb", usagePage: 0x01, usage: 0x02 },
      { vendorId: 0x0b05, productId: 0x1c69, connection: "usb" },
      { vendorId: 0x0b05, productId: 0x1ad0, connection: "dongle", usagePage: 0x01, usage: 0x02 },
      { vendorId: 0x0b05, productId: 0x1ad0, connection: "dongle" },
      // The three vendor collections share one path; which of them hidapi
      // reports for that path is a backend behaviour, so all three are matched.
      ...([0x1c69, 0x1ad0] as const).flatMap((productId) =>
        ([0xff02, 0xff00, 0xff01] as const).map((usagePage) => ({
          vendorId: 0x0b05,
          productId,
          connection: (productId === 0x1c69 ? "usb" : "dongle") as ConnectionPath,
          usagePage,
          usage: 0x01,
          role: "control" as const,
        })),
      ),
    ],
    capabilities: new Set<Feature>(["dpi-stages", "polling-rate", "key-remap", "lighting"]),
    lighting: harpeLighting,
  },
  {
    id: "lofree-hyzen",
    displayName: "Lofree Hyzen",
    vendor: "Lofree",
    kind: "keyboard",
    matches: [
      { vendorId: 0x388d, productId: 0x0024, connection: "usb", usagePage: 0x01, usage: 0x06 },
      { vendorId: 0x388d, productId: 0x0024, connection: "usb" },
    ],
    capabilities: keyboardCapabilities,
  },
];

export function isFeature(value: unknown): value is Feature {
  return typeof value === "string" && (FEATURES as readonly string[]).includes(value);
}

export function matchRole(match: RegistryMatch): EndpointRole {
  return match.role ?? "identify";
}

/**
 * A declared feature has to state its shape. Lighting is the first feature
 * whose interface is derived from a descriptor rather than from the flag.
 */
export function registryProblems(registry: readonly RegistryEntry[] = DEVICE_REGISTRY): string[] {
  const problems: string[] = [];
  for (const entry of registry) {
    if (entry.capabilities.has("lighting") && !entry.lighting) {
      problems.push(`${entry.id} declares lighting without a lighting descriptor`);
    }
    if (entry.lighting && entry.lighting.zones.length === 0) {
      problems.push(`${entry.id} declares a lighting descriptor with no zones`);
    }
    if (entry.lighting && entry.lighting.brightness.min > entry.lighting.brightness.max) {
      problems.push(`${entry.id} declares an empty lighting brightness range`);
    }
  }
  return problems;
}

/** Throws when the registry declares a feature it cannot describe. */
export function assertRegistryIsWellFormed(registry: readonly RegistryEntry[] = DEVICE_REGISTRY): void {
  const problems = registryProblems(registry);
  if (problems.length > 0) {
    throw new Error(`The device registry is not well formed: ${problems.join("; ")}`);
  }
}

assertRegistryIsWellFormed();

function matchScore(match: RegistryMatch): number {
  return (match.usagePage === undefined ? 0 : 1) + (match.usage === undefined ? 0 : 1);
}

function candidateMatches(
  descriptor: HidDescriptor,
  registry: readonly RegistryEntry[],
): MatchedDescriptor[] {
  const matches: MatchedDescriptor[] = [];
  for (const entry of registry) {
    for (const match of entry.matches) {
      if (match.vendorId !== descriptor.vendorId || match.productId !== descriptor.productId) {
        continue;
      }
      if (match.usagePage !== undefined && match.usagePage !== descriptor.usagePage) {
        continue;
      }
      if (match.usage !== undefined && match.usage !== descriptor.usage) {
        continue;
      }
      matches.push({ descriptor, entry, match, role: matchRole(match) });
    }
  }
  return matches;
}

function byDescendingScore(left: MatchedDescriptor, right: MatchedDescriptor): number {
  return matchScore(right.match) - matchScore(left.match);
}

export function matchDescriptor(
  descriptor: HidDescriptor,
  registry: readonly RegistryEntry[] = DEVICE_REGISTRY,
): MatchedDescriptor | undefined {
  return candidateMatches(descriptor, registry).sort(byDescendingScore)[0];
}

/**
 * The best match this descriptor has for each role. Scoring picks between rules
 * of the same role only: a vendor interface is not discarded because the input
 * interface of the same device is matched more specifically.
 */
export function matchDescriptorRoles(
  descriptor: HidDescriptor,
  registry: readonly RegistryEntry[] = DEVICE_REGISTRY,
): MatchedDescriptor[] {
  const byRole = new Map<string, MatchedDescriptor>();
  for (const matched of candidateMatches(descriptor, registry).sort(byDescendingScore)) {
    const key = `${matched.entry.id}:${matched.role}`;
    if (!byRole.has(key)) byRole.set(key, matched);
  }
  return [...byRole.values()];
}

function physicalGroupKey(matched: MatchedDescriptor): string {
  const { descriptor, entry } = matched;
  const serial = descriptor.serialNumber?.trim();
  if (serial) {
    return `serial:${entry.id}:${descriptor.vendorId}:${descriptor.productId}:${serial}`;
  }
  if (descriptor.physicalPath) {
    return `physical:${entry.id}:${descriptor.physicalPath}`;
  }
  // node-hid reports the same path for the collections of most devices. A
  // backend that can provide a better physical path can use physicalPath above.
  return `path:${entry.id}:${descriptor.vendorId}:${descriptor.productId}:${descriptor.path ?? "unknown"}`;
}

function choosePrimary(matches: readonly MatchedDescriptor[]): MatchedDescriptor {
  return [...matches].sort((left, right) => {
    const score = byDescendingScore(left, right);
    if (score !== 0) return score;
    return (left.descriptor.path ?? "").localeCompare(right.descriptor.path ?? "");
  })[0]!;
}

function endpointFor(matched: MatchedDescriptor): DeviceEndpoint | undefined {
  if (!matched.descriptor.path) return undefined;
  return {
    role: matched.role,
    path: matched.descriptor.path,
    usagePage: matched.descriptor.usagePage,
    usage: matched.descriptor.usage,
    reportId: matched.descriptor.reportId,
  };
}

/** Match supported interfaces and collapse interfaces belonging to one unit. */
export function matchDevices(
  descriptors: readonly HidDescriptor[],
  registry: readonly RegistryEntry[] = DEVICE_REGISTRY,
): LogicalDeviceCandidate[] {
  const matchedDescriptors = descriptors.flatMap((descriptor) => matchDescriptorRoles(descriptor, registry));
  // A catch-all rule exists so a device is still found when its collections are
  // reported without usage information. Once a specific rule has matched for a
  // role, the catch-all matches of that role stop contributing.
  const preferredPairs = new Set(
    matchedDescriptors
      .filter(({ match }) => matchScore(match) > 0)
      .map(({ entry, descriptor, role }) => `${entry.id}:${descriptor.vendorId}:${descriptor.productId}:${role}`),
  );
  const groups = new Map<string, MatchedDescriptor[]>();
  for (const matched of matchedDescriptors) {
    const pair = `${matched.entry.id}:${matched.descriptor.vendorId}:${matched.descriptor.productId}:${matched.role}`;
    if (preferredPairs.has(pair) && matchScore(matched.match) === 0) continue;
    const key = physicalGroupKey(matched);
    const group = groups.get(key) ?? [];
    group.push(matched);
    groups.set(key, group);
  }

  return [...groups.values()].map((group) => {
    const identifying = group.filter(({ role }) => role === "identify");
    const controlling = group.filter(({ role }) => role === "control");
    const primary = choosePrimary(identifying.length > 0 ? identifying : group);
    const serial = primary.descriptor.serialNumber?.trim() || undefined;
    const endpoints: DeviceEndpoints = {};
    if (identifying.length > 0) endpoints.identify = endpointFor(choosePrimary(identifying));
    if (controlling.length > 0) endpoints.control = endpointFor(choosePrimary(controlling));
    if (!endpoints.identify) delete endpoints.identify;
    if (!endpoints.control) delete endpoints.control;
    const seen = new Set<HidDescriptor>();
    const uniqueDescriptors = group.flatMap(({ descriptor }) => {
      if (seen.has(descriptor)) return [];
      seen.add(descriptor);
      return [descriptor];
    });
    return {
      entry: primary.entry,
      match: primary.match,
      descriptor: primary.descriptor,
      descriptors: uniqueDescriptors,
      vendorId: primary.descriptor.vendorId,
      productId: primary.descriptor.productId,
      serialNumber: serial,
      endpoints,
    };
  });
}

/** The path a candidate is addressed by when a specific role is not required. */
export function candidatePath(candidate: LogicalDeviceCandidate): string | undefined {
  return candidate.endpoints.identify?.path ?? candidate.endpoints.control?.path;
}

export function registryEntryForModel(
  model: string,
  registry: readonly RegistryEntry[] = DEVICE_REGISTRY,
): RegistryEntry | undefined {
  return registry.find((entry) => entry.id === model);
}

export function capabilitiesFor(entry: RegistryEntry): Feature[] {
  return FEATURES.filter((feature) => entry.capabilities.has(feature));
}
