import { resolveStorage, type StateStorage } from "./lib/storage";

const EXTERNAL_URL_APPROVALS_STORAGE_KEY = "t3.external-url-approvals.v1";
const MAX_EXTERNAL_URL_APPROVALS = 200;

type StoredExternalUrlApprovals = {
  readonly version: 1;
  readonly urls: readonly string[];
};

export interface ExternalUrlApprovalStore {
  has: (url: string) => boolean;
  approve: (url: string) => void;
  revoke: (url: string) => void;
  clear: () => void;
}

function readUrls(storage: StateStorage): string[] {
  const raw = storage.getItem(EXTERNAL_URL_APPROVALS_STORAGE_KEY);
  if (typeof raw !== "string") return [];
  try {
    const parsed = JSON.parse(raw) as Partial<StoredExternalUrlApprovals>;
    if (parsed.version !== 1 || !Array.isArray(parsed.urls)) return [];
    return parsed.urls.filter((url): url is string => typeof url === "string");
  } catch {
    return [];
  }
}

function writeUrls(storage: StateStorage, urls: readonly string[]): void {
  storage.setItem(
    EXTERNAL_URL_APPROVALS_STORAGE_KEY,
    JSON.stringify({ version: 1, urls } satisfies StoredExternalUrlApprovals),
  );
}

export function createExternalUrlApprovalStore(
  candidate?: Partial<StateStorage> | null,
): ExternalUrlApprovalStore {
  const storage = resolveStorage(candidate);
  return {
    has: (url) => readUrls(storage).includes(url),
    approve: (url) => {
      const urls = readUrls(storage).filter((approved) => approved !== url);
      urls.push(url);
      writeUrls(storage, urls.slice(-MAX_EXTERNAL_URL_APPROVALS));
    },
    revoke: (url) => {
      writeUrls(
        storage,
        readUrls(storage).filter((approved) => approved !== url),
      );
    },
    clear: () => storage.removeItem(EXTERNAL_URL_APPROVALS_STORAGE_KEY),
  };
}

export function defaultExternalUrlApprovalStore(): ExternalUrlApprovalStore {
  return createExternalUrlApprovalStore(
    typeof window !== "undefined" ? window.localStorage : undefined,
  );
}

export function isLoopbackHttpUrl(url: string): boolean {
  const hostname = new URL(url).hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost")) return true;
  if (hostname === "[::1]") return true;
  const octets = hostname.split(".");
  return octets.length === 4 && octets[0] === "127" && octets.every((part) => /^\d+$/.test(part));
}
