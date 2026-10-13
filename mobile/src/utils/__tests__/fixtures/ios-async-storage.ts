import { createHash } from 'node:crypto';
import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';

/** Installed AsyncStorage 2.2 RNCAsyncStorage.mm semantics, including failure
 * AFTER mutation of its RAM manifest/cache. Separate real files permit a cold
 * restart without borrowing RAM state. This is an SDK model, not a device run. */
export class IosAsyncStorageModel {
  private manifest: Record<string, string | null>;
  private readonly cache = new Map<string, string>();
  private tail: Promise<void> = Promise.resolve();
  manifestFailures = 0;
  manifestError = 'Failed to write manifest file.';
  fileFailures = 0;
  manifestAttempts = 0;
  readonly removed: string[] = [];
  readonly written: Array<readonly [string, string]> = [];

  constructor(readonly directory: string) {
    this.manifest = this.readManifest();
  }
  private manifestPath() {
    return path.join(this.directory, 'manifest.json');
  }
  private filePath(key: string) {
    return path.join(this.directory, createHash('md5').update(key).digest('hex'));
  }
  private readManifest(): Record<string, string | null> {
    return existsSync(this.manifestPath()) ? JSON.parse(readFileSync(this.manifestPath(), 'utf8')) : {};
  }
  private atomicWrite(filename: string, value: string) {
    writeFileSync(filename + '.tmp', value);
    renameSync(filename + '.tmp', filename);
  }
  private serial<T>(work: () => T | Promise<T>): Promise<T> {
    const result = this.tail.then(work);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
  private writeManifest() {
    this.manifestAttempts++;
    if (this.manifestFailures > 0) {
      this.manifestFailures--;
      throw new Error(this.manifestError);
    }
    this.atomicWrite(this.manifestPath(), JSON.stringify(this.manifest));
  }
  async setItem(key: string, value: string) {
    try {
      await this.multiSet([[key, value]]);
    } catch (errors) {
      throw Array.isArray(errors) ? errors[0] : errors;
    }
  }
  multiSet(pairs: readonly (readonly [string, string])[]): Promise<void> {
    return this.serial(() => {
      let changedManifest = false;
      const errors: Error[] = [];
      for (const [key, value] of pairs) {
        this.written.push([key, value]);
        if (value.length <= 1024) {
          if (this.manifest[key] === null) this.removeBackingFile(key);
          this.manifest[key] = value;
          changedManifest = true; // Even if the inline value did not change.
        } else {
          let failed = false;
          if (this.fileFailures > 0) {
            this.fileFailures--;
            errors.push(new Error('Failed to write value.'));
            failed = true;
          } else this.atomicWrite(this.filePath(key), value);
          // SDK puts the attempted value in cache even when its file write fails.
          this.cache.set(key, value);
          if (!failed && this.manifest[key] !== null) {
            this.manifest[key] = null;
            changedManifest = true;
          }
        }
      }
      if (changedManifest) {
        try {
          this.writeManifest();
        } catch (error) {
          errors.push(error as Error);
        }
      }
      // multiSet's public JS API rejects Error[]; setItem rejects its first item.
      if (errors.length) throw errors;
    });
  }
  getItem(key: string): Promise<string | null> {
    return this.serial(() => {
      const value = this.manifest[key];
      if (value !== null) return value ?? null;
      if (this.cache.has(key)) return this.cache.get(key)!;
      if (existsSync(this.filePath(key))) {
        const raw = readFileSync(this.filePath(key), 'utf8');
        this.cache.set(key, raw);
        return raw;
      }
      delete this.manifest[key]; // SDK does not flush this missing-file cleanup.
      return null;
    });
  }
  getAllKeys(): Promise<string[]> {
    return this.serial(() => Object.keys(this.manifest));
  }
  removeItem(key: string): Promise<void> {
    return this.serial(() => {
      this.removed.push(key);
      if (this.manifest[key] === null) this.removeBackingFile(key);
      if (Object.hasOwn(this.manifest, key)) {
        delete this.manifest[key];
        this.writeManifest();
      }
    });
  }
  removeBackingFile(key: string) {
    if (existsSync(this.filePath(key))) unlinkSync(this.filePath(key));
    this.cache.delete(key);
  }
  /** Independent cold read: files not referenced by disk manifest are invisible. */
  diskValue(key: string): string | null {
    const manifest = this.readManifest();
    if (manifest[key] !== null) return manifest[key] ?? null;
    return existsSync(this.filePath(key)) ? readFileSync(this.filePath(key), 'utf8') : null;
  }
  restart() {
    this.manifest = this.readManifest();
    this.cache.clear();
  }
}
