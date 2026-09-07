import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { parseVectorTile, type ParsedVtile } from "../../../src/components/globe/scene/vectorTiles";
import { createVtileParseClient } from "../../../src/lib/geo/vtileParseClient";
import {
  handleParseRequest,
  type VtileParseMessage,
  type VtileParseRequest,
} from "../../../src/lib/geo/vtileWire";

/**
 * THE CLIENT'S THREE PATHS (T77 lever 11, 2026-09-07j): the worker path (a fake `Worker` that runs
 * the real handler and answers through `structuredClone`, i.e. the postMessage boundary), the
 * inline twin (no `Worker`), and the crash fallback (every in-flight tile re-issued inline, the
 * client inline for the rest of the session, a late worker answer for a re-issued key dropped).
 * Whatever the path, the consumer receives the `ParsedVtile` the in-thread parser would have made.
 */

const FIXTURE = join(__dirname, "fixtures", "ofm-z14-9787-5662-dnipro-central-bridge.pbf");
const TX = 9787;
const TY = 5662;
const KEY = `${TX}/${TY}`;

const fixtureBuffer = (): ArrayBuffer => {
  const b = readFileSync(FIXTURE);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

/** A `Worker` double: queues requests, answers on `flush()` through the REAL handler + a clone. */
class FakeWorker {
  onmessage: ((e: MessageEvent<VtileParseMessage>) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  onmessageerror: ((e: MessageEvent) => void) | null = null;
  readonly queue: VtileParseRequest[] = [];
  terminated = false;
  postMessage(req: VtileParseRequest) {
    if (this.terminated) throw new Error("terminated");
    this.queue.push(structuredClone(req));
  }
  terminate() {
    this.terminated = true;
  }
  /** Answer every queued request in order (or just the first `n`). */
  flush(n = Infinity) {
    while (this.queue.length > 0 && n-- > 0) {
      const req = this.queue.shift() as VtileParseRequest;
      handleParseRequest(req, parseVectorTile, (m) => {
        this.onmessage?.({ data: structuredClone(m) } as MessageEvent<VtileParseMessage>);
      });
    }
  }
  crash(message = "boom") {
    this.onerror?.({ message } as ErrorEvent);
  }
}

const collect = () => {
  const parsed = new Map<string, ParsedVtile>();
  const failed = new Map<string, string>();
  return {
    parsed,
    failed,
    handlers: {
      onParsed: (key: string, p: ParsedVtile) => parsed.set(key, p),
      onFailed: (key: string, message: string) => failed.set(key, message),
    },
  };
};

const expected = parseVectorTile(fixtureBuffer(), TX, TY);

describe("vtileParseClient — the worker path", () => {
  it("spawns lazily on the first post, parses through the worker, seats the identical tile", () => {
    const fake = new FakeWorker();
    const spawn = vi.fn(() => fake as unknown as Worker);
    const c = collect();
    const client = createVtileParseClient(c.handlers, parseVectorTile, { spawn });
    expect(spawn).not.toHaveBeenCalled();
    expect(client.stats().workerLive).toBe(false);

    client.parse(KEY, fixtureBuffer(), TX, TY);
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(client.stats()).toMatchObject({ posted: 1, pending: 1, workerLive: true, workerParsed: 0 });
    expect(c.parsed.size).toBe(0); // nothing seats before the worker answers

    fake.flush();
    expect(c.parsed.get(KEY)).toStrictEqual(expected);
    expect(c.failed.size).toBe(0);
    const s = client.stats();
    expect(s).toMatchObject({ workerParsed: 1, inlineParsed: 0, failed: 0, pending: 0, crashed: false });
    expect(s.seatMs).toBeGreaterThanOrEqual(0);
    expect(s.seatMaxMs).toBeGreaterThanOrEqual(s.seatMs);
    expect(s.workerMaxMs).toBeGreaterThan(0);
  });

  it("the request buffer is NOT transferred — the caller's copy stays intact", () => {
    const fake = new FakeWorker();
    const client = createVtileParseClient(collect().handlers, parseVectorTile, {
      spawn: () => fake as unknown as Worker,
    });
    const buf = fixtureBuffer();
    client.parse(KEY, buf, TX, TY);
    expect(buf.byteLength).toBeGreaterThan(0); // a transferred buffer would read 0 (detached)
  });

  it("a tile the parser rejects seats as `failed` for that key only", () => {
    const fake = new FakeWorker();
    const c = collect();
    const client = createVtileParseClient(c.handlers, parseVectorTile, {
      spawn: () => fake as unknown as Worker,
    });
    client.parse("bad", new Uint8Array([0xff, 0xff, 0xff, 0xff, 0xff]).buffer, 1, 1);
    client.parse(KEY, fixtureBuffer(), TX, TY);
    fake.flush();
    expect(c.failed.has("bad")).toBe(true);
    expect(c.parsed.get(KEY)).toStrictEqual(expected);
    expect(client.stats()).toMatchObject({ failed: 1, workerParsed: 1, pending: 0 });
  });

  it("dispose terminates the worker and drops late answers", () => {
    const fake = new FakeWorker();
    const c = collect();
    const client = createVtileParseClient(c.handlers, parseVectorTile, {
      spawn: () => fake as unknown as Worker,
    });
    client.parse(KEY, fixtureBuffer(), TX, TY);
    client.dispose();
    expect(fake.terminated).toBe(true);
    fake.flush(); // the double still answers — the client must ignore it
    expect(c.parsed.size).toBe(0);
    client.parse("late", fixtureBuffer(), TX, TY); // after dispose: a no-op
    expect(client.stats().posted).toBe(1);
  });
});

describe("vtileParseClient — the inline twin", () => {
  it("with no Worker (spawn → null) it parses on the caller, synchronously, byte-identical", () => {
    const c = collect();
    const client = createVtileParseClient(c.handlers, parseVectorTile, { spawn: () => null });
    client.parse(KEY, fixtureBuffer(), TX, TY);
    expect(c.parsed.get(KEY)).toStrictEqual(expected);
    expect(client.stats()).toMatchObject({
      inlineParsed: 1,
      workerParsed: 0,
      workerLive: false,
      crashed: false,
      pending: 0,
      workerMaxMs: 0,
    });
  });

  it("spawn is tried ONCE — a null spawn is not retried on every tile", () => {
    const spawn = vi.fn(() => null);
    const client = createVtileParseClient(collect().handlers, parseVectorTile, { spawn });
    client.parse("a/1", fixtureBuffer(), TX, TY);
    client.parse("a/2", fixtureBuffer(), TX, TY);
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(client.stats().inlineParsed).toBe(2);
  });
});

describe("vtileParseClient — the crash fallback", () => {
  it("re-issues every in-flight tile inline, in post order, and stays inline afterwards", () => {
    const fake = new FakeWorker();
    const c = collect();
    const order: string[] = [];
    const seatOrder = {
      ...c.handlers,
      onParsed: (k: string, p: ParsedVtile) => {
        order.push(k);
        c.parsed.set(k, p);
      },
    };
    const client2 = createVtileParseClient(seatOrder, parseVectorTile, {
      spawn: () => fake as unknown as Worker,
    });
    client2.parse("t/1", fixtureBuffer(), TX, TY);
    client2.parse("t/2", fixtureBuffer(), TX, TY);
    fake.flush(1); // the worker answers the first, then dies
    expect(order).toEqual(["t/1"]);
    fake.crash("out of memory");
    expect(fake.terminated).toBe(true);
    expect(order).toEqual(["t/1", "t/2"]); // the second was re-issued inline, at once
    expect(c.parsed.get("t/2")).toStrictEqual(expected);
    expect(client2.stats()).toMatchObject({ crashed: true, workerLive: false, workerParsed: 1, inlineParsed: 1, pending: 0 });
    // From here on: inline, no respawn — the dead worker's queue still holds the unanswered
    // second request and never sees the third.
    client2.parse("t/3", fixtureBuffer(), TX, TY);
    expect(order).toEqual(["t/1", "t/2", "t/3"]);
    expect(fake.queue.map((r) => r.key)).toEqual(["t/2"]);
    expect(client2.stats().inlineParsed).toBe(2);
  });

  it("a worker answer arriving AFTER the crash re-issue is dropped (the inline seat won)", () => {
    const fake = new FakeWorker();
    const seats: string[] = [];
    const client = createVtileParseClient(
      { onParsed: (k) => seats.push(k), onFailed: () => undefined },
      parseVectorTile,
      { spawn: () => fake as unknown as Worker },
    );
    client.parse(KEY, fixtureBuffer(), TX, TY);
    fake.crash();
    expect(seats).toEqual([KEY]);
    fake.terminated = false; // simulate the zombie's queued answer still being delivered
    fake.flush();
    expect(seats).toEqual([KEY]); // exactly once
  });

  it("a postMessage throw counts as a crash: the tile still seats, inline", () => {
    const fake = new FakeWorker();
    fake.terminated = true; // postMessage throws
    const c = collect();
    const client = createVtileParseClient(c.handlers, parseVectorTile, {
      spawn: () => fake as unknown as Worker,
    });
    client.parse(KEY, fixtureBuffer(), TX, TY);
    expect(c.parsed.get(KEY)).toStrictEqual(expected);
    expect(client.stats()).toMatchObject({ crashed: true, inlineParsed: 1 });
  });
});
