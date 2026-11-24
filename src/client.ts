/**
 * Talking to Epitree. The HTTP call is passed in: Obsidian's requestUrl in the
 * plugin (it isn't held to CORS, and works on mobile), a fake in tests.
 */
import type { ImportResponse, NoteIn, PreviewResponse, StatusResponse } from "./types";

export interface HttpRequest {
  url: string;
  method: "GET" | "POST";
  headers: Record<string, string>;
  body?: string;
}

export interface HttpResponse {
  status: number;
  json: unknown;
  headers: Record<string, string>;
}

export type Http = (request: HttpRequest) => Promise<HttpResponse>;

export class EpitreeError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Seconds to wait, for a 429. */
    readonly retryAfter?: number,
  ) {
    super(message);
    this.name = "EpitreeError";
  }
}

export const NO_TOKEN =
  "Add your Epitree access token first: Settings → Epitree. You create one in Epitree under Settings → Connected apps.";
export const BAD_TOKEN =
  "Epitree didn't accept the access token. Create a new one in Epitree under Settings → Connected apps.";
export const OFFLINE = "Couldn't reach Epitree. Check your connection and try again.";

function detailOf(json: unknown): string | null {
  const detail = (json as { detail?: unknown } | null)?.detail;
  if (typeof detail === "string") return detail;
  if (detail && typeof detail === "object" && typeof (detail as { message?: unknown }).message === "string") {
    return (detail as { message: string }).message;
  }
  return null;
}

export class EpitreeClient {
  constructor(
    private readonly http: Http,
    private readonly serverUrl: () => string,
    private readonly token: () => string | null,
  ) {}

  private async call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const token = this.token();
    if (!token) throw new EpitreeError(NO_TOKEN, 0);
    let response: HttpResponse;
    try {
      response = await this.http({
        url: `${this.serverUrl().replace(/\/+$/, "")}${path}`,
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new EpitreeError(OFFLINE, 0);
    }
    if (response.status >= 200 && response.status < 300) return response.json as T;
    if (response.status === 401) throw new EpitreeError(BAD_TOKEN, 401);
    const retry = Number(response.headers["retry-after"] ?? response.headers["Retry-After"]);
    throw new EpitreeError(
      detailOf(response.json) ?? `Epitree answered with an error (${response.status}). Try again later.`,
      response.status,
      response.status === 429 ? (Number.isFinite(retry) && retry > 0 ? retry : 60) : undefined,
    );
  }

  preview(notes: NoteIn[]): Promise<PreviewResponse> {
    return this.call("POST", "/api/v1/integrations/obsidian/notes/preview", { notes });
  }

  importNotes(notes: NoteIn[]): Promise<ImportResponse> {
    return this.call("POST", "/api/v1/integrations/obsidian/notes", { notes });
  }

  status(): Promise<StatusResponse> {
    return this.call("GET", "/api/v1/integrations/obsidian/status");
  }
}
