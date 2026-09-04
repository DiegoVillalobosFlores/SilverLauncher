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

export interface RegistryMatch {
  vendorId: number;
  productId: number;
  connection: ConnectionPath;
  usagePage?: number;
  usage?: number;
}

export interface RegistryEntry {
  id: string;
  displayName: string;
  vendor: string;
  kind: DeviceKind;
  matches: readonly RegistryMatch[];
  capabilities: ReadonlySet<Feature>;
}

export interface MatchedDescriptor {
  descriptor: HidDescriptor;
  entry: RegistryEntry;
  match: RegistryMatch;
}

export interface LogicalDeviceCandidate {
  entry: RegistryEntry;
  match: RegistryMatch;
  descriptor: HidDescriptor;
  descriptors: readonly HidDescriptor[];
  vendorId: number;
  productId: number;
  serialNumber?: string;
  path?: string;
}

const mouseCapabilities = new Set<Feature>(["dpi-stages", "polling-rate", "key-remap"]);
const keyboardCapabilities = new Set<Feature>(["key-remap", "lighting", "onboard-slots"]);

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
    ],
    capabilities: new Set<Feature>(["dpi-stages", "polling-rate", "key-remap", "lighting"]),
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

function matchScore(match: RegistryMatch): number {
  return (match.usagePage === undefined ? 0 : 1) + (match.usage === undefined ? 0 : 1);
}

export function matchDescriptor(
  descriptor: HidDescriptor,
  registry: readonly RegistryEntry[] = DEVICE_REGISTRY,
): MatchedDescriptor | undefined {
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
      matches.push({ descriptor, entry, match });
    }
  }
  return matches.sort((left, right) => matchScore(right.match) - matchScore(left.match))[0];
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
    const score = matchScore(right.match) - matchScore(left.match);
    if (score !== 0) return score;
    return (left.descriptor.path ?? "").localeCompare(right.descriptor.path ?? "");
  })[0]!;
}

/** Match supported interfaces and collapse interfaces belonging to one unit. */
export function matchDevices(
  descriptors: readonly HidDescriptor[],
  registry: readonly RegistryEntry[] = DEVICE_REGISTRY,
): LogicalDeviceCandidate[] {
  const matchedDescriptors = descriptors.flatMap((descriptor) => {
    const matched = matchDescriptor(descriptor, registry);
    return matched ? [matched] : [];
  });
  const preferredPairs = new Set(
    matchedDescriptors
      .filter(({ match }) => matchScore(match) > 0)
      .map(({ entry, descriptor }) => `${entry.id}:${descriptor.vendorId}:${descriptor.productId}`),
  );
  const groups = new Map<string, MatchedDescriptor[]>();
  for (const matched of matchedDescriptors) {
    const pair = `${matched.entry.id}:${matched.descriptor.vendorId}:${matched.descriptor.productId}`;
    if (preferredPairs.has(pair) && matchScore(matched.match) === 0) continue;
    const key = physicalGroupKey(matched);
    const group = groups.get(key) ?? [];
    group.push(matched);
    groups.set(key, group);
  }

  return [...groups.values()].map((group) => {
    const primary = choosePrimary(group);
    const serial = primary.descriptor.serialNumber?.trim() || undefined;
    return {
      entry: primary.entry,
      match: primary.match,
      descriptor: primary.descriptor,
      descriptors: group.map(({ descriptor }) => descriptor),
      vendorId: primary.descriptor.vendorId,
      productId: primary.descriptor.productId,
      serialNumber: serial,
      path: primary.descriptor.path,
    };
  });
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
