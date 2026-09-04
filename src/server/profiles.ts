import { readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import {
  applicationConfigDirectory,
  ensureDirectory,
  readJsonFile,
  writeJsonFile,
} from "./persistence";
import {
  DEVICE_REGISTRY,
  FEATURES,
  isFeature,
  registryEntryForModel,
  type Feature,
  type RegistryEntry,
} from "./registry";

export interface Profile {
  formatVersion: 1;
  model: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  settings: Record<string, unknown>;
}

export interface InvalidProfile {
  filename: string;
  reason: string;
}

export interface ProfileLoadResult {
  profiles: Profile[];
  invalid: InvalidProfile[];
}

export type ProfileValidation =
  | { valid: true; profile: Profile }
  | { valid: false; reason: string };

export type CollisionMode = "reject" | "replace" | "keep-both";

export class ProfileCollisionError extends Error {
  readonly code = "profile-name-collision";
  readonly existing: Profile;

  constructor(existing: Profile) {
    super(`A profile named "${existing.name}" already exists for ${existing.model}`);
    this.name = "ProfileCollisionError";
    this.existing = existing;
  }
}

export class ProfileValidationError extends Error {
  readonly code = "invalid-profile";

  constructor(reason: string) {
    super(reason);
    this.name = "ProfileValidationError";
  }
}

export function validateProfile(value: unknown): ProfileValidation {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { valid: false, reason: "The profile must be a JSON object" };
  }
  const profile = value as Partial<Profile>;
  if (profile.formatVersion !== 1) {
    return { valid: false, reason: "formatVersion must be 1" };
  }
  if (typeof profile.model !== "string" || !profile.model.trim()) {
    return { valid: false, reason: "model must be a non-empty string" };
  }
  if (typeof profile.name !== "string" || !profile.name.trim()) {
    return { valid: false, reason: "name must be a non-empty string" };
  }
  if (typeof profile.createdAt !== "string" || !profile.createdAt.trim()) {
    return { valid: false, reason: "createdAt must be a non-empty string" };
  }
  if (typeof profile.updatedAt !== "string" || !profile.updatedAt.trim()) {
    return { valid: false, reason: "updatedAt must be a non-empty string" };
  }
  if (!profile.settings || typeof profile.settings !== "object" || Array.isArray(profile.settings)) {
    return { valid: false, reason: "settings must be an object" };
  }
  for (const key of Object.keys(profile.settings)) {
    if (!isFeature(key)) {
      return { valid: false, reason: `settings contains unsupported feature "${key}"` };
    }
  }

  return {
    valid: true,
    profile: {
      formatVersion: 1,
      model: profile.model.trim(),
      name: profile.name.trim(),
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
      settings: { ...profile.settings },
    },
  };
}

export function slugifyProfileName(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "profile";
}

export function createDefaultProfile(model: string, now = new Date()): Profile {
  const timestamp = now.toISOString();
  return {
    formatVersion: 1,
    model,
    name: "Default",
    createdAt: timestamp,
    updatedAt: timestamp,
    settings: {},
  };
}

export interface ProfileStoreOptions {
  rootDir?: string;
  registry?: readonly RegistryEntry[];
  now?: () => Date;
}

export interface SaveProfileResult {
  profile: Profile;
  path: string;
  replaced: boolean;
  renamed: boolean;
}

export class ProfileStore {
  readonly rootDir: string;
  readonly profilesDir: string;
  readonly registry: readonly RegistryEntry[];
  private readonly now: () => Date;
  private readonly profiles = new Map<string, Profile>();
  private readonly profileFiles = new Map<string, string>();
  private invalid: InvalidProfile[] = [];
  private loaded = false;

  constructor(options: ProfileStoreOptions = {}) {
    this.rootDir = options.rootDir ?? applicationConfigDirectory();
    this.profilesDir = join(this.rootDir, "profiles");
    this.registry = options.registry ?? DEVICE_REGISTRY;
    this.now = options.now ?? (() => new Date());
  }

  async load(): Promise<ProfileLoadResult> {
    await ensureDirectory(this.profilesDir);
    this.profiles.clear();
    this.profileFiles.clear();
    this.invalid = [];

    let modelDirectories;
    try {
      modelDirectories = await readdir(this.profilesDir, { withFileTypes: true, encoding: "utf8" });
    } catch (error) {
      this.invalid.push({ filename: this.profilesDir, reason: errorMessage(error) });
      this.loaded = true;
      return { profiles: [], invalid: [...this.invalid] };
    }

    for (const modelDirectory of modelDirectories) {
      if (!modelDirectory.isDirectory()) continue;
      const modelPath = join(this.profilesDir, modelDirectory.name);
      let files;
      try {
        files = await readdir(modelPath, { withFileTypes: true, encoding: "utf8" });
      } catch (error) {
        this.invalid.push({ filename: modelPath, reason: errorMessage(error) });
        continue;
      }
      for (const file of files) {
        if (!file.isFile() || !file.name.endsWith(".json")) continue;
        const path = join(modelPath, file.name);
        try {
          const raw = await readJsonFile<unknown>(path);
          const validation = validateProfile(raw);
          if (!validation.valid) throw new ProfileValidationError(validation.reason);
          if (!registryEntryForModel(validation.profile.model, this.registry)) {
            throw new ProfileValidationError(`unsupported model "${validation.profile.model}"`);
          }
          if (validation.profile.model !== modelDirectory.name) {
            throw new ProfileValidationError("profile model does not match its directory");
          }
          const key = profileKey(validation.profile.model, validation.profile.name);
          if (this.profiles.has(key)) {
            throw new ProfileValidationError("duplicate profile name for this model");
          }
          this.profiles.set(key, validation.profile);
          this.profileFiles.set(key, path);
        } catch (error) {
          this.invalid.push({ filename: basename(path), reason: errorMessage(error) });
        }
      }
    }
    this.loaded = true;
    return { profiles: this.list(), invalid: [...this.invalid] };
  }

  isLoaded(): boolean {
    return this.loaded;
  }

  list(model?: string): Profile[] {
    return [...this.profiles.values()]
      .filter((profile) => !model || profile.model === model)
      .sort((left, right) => left.name.localeCompare(right.name))
      .map(cloneProfile);
  }

  invalidProfiles(): InvalidProfile[] {
    return [...this.invalid];
  }

  get(model: string, name: string): Profile | undefined {
    const profile = this.profiles.get(profileKey(model, name));
    return profile ? cloneProfile(profile) : undefined;
  }

  async save(profile: Profile, collision: CollisionMode = "reject"): Promise<SaveProfileResult> {
    const validation = validateProfile(profile);
    if (!validation.valid) throw new ProfileValidationError(validation.reason);
    if (!registryEntryForModel(validation.profile.model, this.registry)) {
      throw new ProfileValidationError(`unsupported model "${validation.profile.model}"`);
    }

    let toSave = validation.profile;
    let existing = this.get(toSave.model, toSave.name);
    if (existing && collision === "reject") throw new ProfileCollisionError(existing);
    if (existing && collision === "keep-both") {
      const baseName = toSave.name;
      let suffix = 2;
      while (this.get(toSave.model, `${baseName} (${suffix})`)) suffix += 1;
      toSave = { ...toSave, name: `${baseName} (${suffix})` };
      existing = undefined;
    }

    const modelDir = join(this.profilesDir, toSave.model);
    await ensureDirectory(modelDir);
    const key = profileKey(toSave.model, toSave.name);
    const existingPath = this.profileFiles.get(key);
    const path = existingPath ?? await this.availableProfilePath(modelDir, toSave.name, key);
    await writeJsonFile(path, toSave);
    this.profiles.set(key, cloneProfile(toSave));
    this.profileFiles.set(key, path);
    return {
      profile: cloneProfile(toSave),
      path,
      replaced: Boolean(existing),
      renamed: toSave.name !== validation.profile.name,
    };
  }

  async ensureDefault(model: string): Promise<Profile> {
    const existing = this.list(model);
    if (existing.length > 0) {
      return existing.find((profile) => profile.name === "Default") ?? existing[0]!;
    }
    const result = await this.save(createDefaultProfile(model, this.now()), "reject");
    return result.profile;
  }

  profilePath(profile: Pick<Profile, "model" | "name">): string {
    return join(this.profilesDir, profile.model, `${slugifyProfileName(profile.name)}.json`);
  }

  private async availableProfilePath(modelDir: string, name: string, profileKeyToSave: string): Promise<string> {
    const slug = slugifyProfileName(name);
    let suffix = 0;
    while (true) {
      const filename = `${slug}${suffix === 0 ? "" : `-${suffix + 1}`}.json`;
      const path = join(modelDir, filename);
      const ownedByAnotherProfile = [...this.profileFiles.entries()].some(([key, profilePath]) => key !== profileKeyToSave && profilePath === path);
      if (!ownedByAnotherProfile && !(await Bun.file(path).exists())) return path;
      suffix += 1;
    }
  }
}

function profileKey(model: string, name: string): string {
  return `${model}\u0000${name.toLocaleLowerCase()}`;
}

function cloneProfile(profile: Profile): Profile {
  return { ...profile, settings: { ...profile.settings } };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function featureLabels(features: readonly Feature[]): Record<Feature, string> {
  return Object.fromEntries(
    FEATURES.map((feature) => [feature, feature.replaceAll("-", " ")]),
  ) as Record<Feature, string>;
}
