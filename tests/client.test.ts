import { describe, expect, it } from "vitest";
import {
  BAD_TOKEN,
  EpitreeClient,
  EpitreeError,
  NO_TOKEN,
  OFFLINE,
  type HttpRequest,
  type HttpResponse,
} from "../src/client";

function clientAnswering(response: HttpResponse | Error, token: string | null = "ept_secret") {
  const sent: HttpRequest[] = [];
  const client = new EpitreeClient(
    async (request) => {
      sent.push(request);
      if (response instanceof Error) throw response;
      return response;
    },
    () => "https://epitree.test/",
    () => token,
  );
  return { client, sent };
}

async function errorOf(promise: Promise<unknown>): Promise<EpitreeError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof EpitreeError) return err;
    throw err;
  }
  throw new Error("expected an EpitreeError");
}

describe("EpitreeClient requests", () => {
  it("posts notes as JSON with the token, to the server without a double slash", async () => {
    const { client, sent } = clientAnswering({ status: 200, headers: {}, json: { results: [] } });

    await client.importNotes([]);

    expect(sent[0]).toEqual({
      url: "https://epitree.test/api/v1/integrations/obsidian/notes",
      method: "POST",
      headers: {
        Authorization: "Bearer ept_secret",
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ notes: [] }),
    });
  });

  it("asks for status with a GET and no body", async () => {
    const { client, sent } = clientAnswering({ status: 200, headers: {}, json: { notes: 3 } });

    expect(await client.status()).toEqual({ notes: 3 });
    expect(sent[0].method).toBe("GET");
    expect(sent[0].url).toBe("https://epitree.test/api/v1/integrations/obsidian/status");
    expect(sent[0].body).toBeUndefined();
    expect(sent[0].headers["Content-Type"]).toBeUndefined();
  });

  it("previews at its own address", async () => {
    const { client, sent } = clientAnswering({ status: 200, headers: {}, json: {} });
    await client.preview([]);
    expect(sent[0].url).toBe("https://epitree.test/api/v1/integrations/obsidian/notes/preview");
  });
});

describe("EpitreeClient errors", () => {
  it("never calls out without a token", async () => {
    const { client, sent } = clientAnswering({ status: 200, headers: {}, json: {} }, null);

    const err = await errorOf(client.status());

    expect(err.message).toBe(NO_TOKEN);
    expect(sent).toEqual([]);
  });

  it("says where to make a new token when Epitree refuses this one", async () => {
    const err = await errorOf(clientAnswering({ status: 401, headers: {}, json: { detail: "x" } }).client.status());
    expect([err.status, err.message]).toEqual([401, BAD_TOKEN]);
  });

  it("passes Epitree's own sentence on", async () => {
    const response = { status: 403, headers: {}, json: { detail: "This access token can't be used for that." } };
    const err = await errorOf(clientAnswering(response).client.status());
    expect(err.message).toBe("This access token can't be used for that.");
  });

  it("reads the message out of a plan-limit refusal", async () => {
    const response = { status: 403, headers: {}, json: { detail: { error: "plan_limit_reached", message: "No more this month." } } };
    const err = await errorOf(clientAnswering(response).client.status());
    expect(err.message).toBe("No more this month.");
  });

  it("falls back to the status when the answer has no sentence in it", async () => {
    const response = { status: 422, headers: {}, json: { detail: [{ msg: "field required" }] } };
    const err = await errorOf(clientAnswering(response).client.status());
    expect(err.status).toBe(422);
    expect(err.message).toContain("(422)");
  });

  it("knows how long to wait after too many requests", async () => {
    const told = await errorOf(clientAnswering({ status: 429, headers: { "Retry-After": "12" }, json: null }).client.status());
    const untold = await errorOf(clientAnswering({ status: 429, headers: {}, json: null }).client.status());
    const garbled = await errorOf(clientAnswering({ status: 429, headers: { "retry-after": "soon" }, json: null }).client.status());
    expect([told.retryAfter, untold.retryAfter, garbled.retryAfter]).toEqual([12, 60, 60]);
  });

  it("says the connection failed when the request never arrives", async () => {
    const err = await errorOf(clientAnswering(new Error("ECONNREFUSED")).client.status());
    expect([err.status, err.message]).toEqual([0, OFFLINE]);
  });
});
