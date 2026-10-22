import init, { Session } from "@/lib/quire/pkg/quire_wasm.js";

let booted: Promise<void> | null = null;

export function bootEngine(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (!booted) {
    booted = init().then(() => undefined);
  }
  return booted;
}

export function createSession(): Session {
  return new Session();
}

export type { Session };
