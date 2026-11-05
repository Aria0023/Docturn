import { afterEach, describe, expect, it } from "vitest";
import { boot, closeAll, count, sleep, until, ME, type Harness } from "./client-parity-harness.js";

/**
 * Priority alert sounds, client half (PerfectServe parity #8, module
 * messaging.alertSounds) — the real store.js + api-bridge.js in jsdom with a
 * recording AudioContext. The tone per priority is the SERVER's stored
 * choice; the open app synthesises it (no audio files) when a live message
 * from someone else arrives. Real Chromium playback is measured by
 * scripts/alert-sounds-check.mjs.
 */
afterEach(closeAll);

const PREFS = { stat: "siren", urgent: "chime", routine: "none", sounds: ["siren", "alarm", "chime", "ping", "soft", "none"], defaults: { stat: "siren", urgent: "alarm", routine: "ping" } };
// The frequency of each tone's first note identifies it.
const FIRST_HZ: Record<string, number> = { siren: 960, alarm: 880, chime: 660, ping: 1046, soft: 523 };

function fakeAudio(h: Harness) {
  const played: number[][] = [];
  let current: number[] | null = null;
  class Ctx {
    state = "running"; currentTime = 0; destination = {};
    resume() { this.state = "running"; return Promise.resolve(); }
    createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; }
    createOscillator() {
      return { type: "", frequency: { setValueAtTime(hz: number, at: number) { if (at <= 0.03) { current = [hz]; played.push(current); } else if (current) current.push(hz); } }, connect() {}, start() {}, stop() {} };
    }
  }
  h.w.AudioContext = Ctx;
  return played;
}
async function withSounds(prefs: any = PREFS, modules?: Record<string, boolean>) {
  const pre = { prefs };
  const h = await boot({ modules });
  h.routes.snd = (r) => (r.path === "/api/messaging/alert-sounds" && r.method === "GET" ? { status: 200, body: pre.prefs } : undefined);
  const played = fakeAudio(h);
  await h.w.DT.actions.loadSoundPrefs();
  return { h, played };
}
let seq = 900;
const frame = (h: Harness, priority: string, senderId = 12) =>
  h.sockets[h.sockets.length - 1].emit({ type: "MESSAGE_RECEIVED", message: { id: ++seq, conversationId: 1, senderId, content: "x", priority, createdAt: new Date().toISOString() } });

describe("alert sounds (client)", () => {
  it("reads my choice from the server; sends nothing and stores nothing while the module is off", async () => {
    const { h } = await withSounds();
    expect(h.state().soundPrefs).toMatchObject({ stat: "siren", urgent: "chime", routine: "none" });
    const off = await boot({ modules: { "messaging.alertSounds": false } });
    off.w.DT.set((s: any) => { s.soundPrefs = { ...PREFS }; return s; });
    expect(await off.w.DT.actions.loadSoundPrefs()).toBeNull();
    expect(count(off, "GET", "/api/messaging/alert-sounds")).toBe(0);
    expect(off.state().soundPrefs).toBeNull();
  });

  it("a live message from someone else plays MY tone for its priority; my own messages and 'none' play nothing", async () => {
    const { h, played } = await withSounds();
    frame(h, "stat");
    await sleep(10);
    expect(played.map((p) => p[0])).toEqual([FIRST_HZ.siren]);
    await sleep(1600); // one sound per burst
    frame(h, "urgent");
    await sleep(10);
    expect(played.map((p) => p[0])).toEqual([FIRST_HZ.siren, FIRST_HZ.chime]);
    await sleep(1600);
    frame(h, "routine"); // my routine choice is "none"
    frame(h, "stat", ME.id); // my own message
    await sleep(10);
    expect(played).toHaveLength(2);
  });

  it("a burst of messages plays one sound; do-not-disturb plays none; nothing before the server answered", async () => {
    const { h, played } = await withSounds();
    frame(h, "stat"); frame(h, "stat"); frame(h, "urgent");
    await sleep(10);
    expect(played).toHaveLength(1);
    await sleep(1600);
    h.w.DT.set((s: any) => { s.myPrefs = { ...(s.myPrefs || {}), dnd: true }; return s; });
    frame(h, "stat");
    await sleep(10);
    expect(played).toHaveLength(1);

    const { h: h2, played: p2 } = await withSounds();
    h2.w.DT.set((s: any) => { s.soundPrefs = null; return s; });
    frame(h2, "stat");
    await sleep(10);
    expect(p2).toHaveLength(0);
  });

  it("module switched off: no sound even with a choice loaded", async () => {
    const { h, played } = await withSounds();
    h.modules = { "messaging.alertSounds": false };
    h.w.DT.set((s: any) => { s.modules = { ...(s.modules || {}), "messaging.alertSounds": false }; return s; });
    frame(h, "stat");
    await sleep(10);
    expect(played).toHaveLength(0);
  });

  it("changing one priority is ONE PUT of all three; the screen shows the server's answer; a refusal says why", async () => {
    const { h } = await withSounds();
    h.routes.put = (r) => (r.path === "/api/messaging/alert-sounds" && r.method === "PUT" ? { status: 200, body: { ...PREFS, ...r.body } } : undefined);
    expect(await h.w.DT.actions.setSoundPref("routine", "soft")).toBe(true);
    const puts = h.reqs.filter((r) => r.method === "PUT" && r.path === "/api/messaging/alert-sounds");
    expect(puts.map((p) => p.body)).toEqual([{ stat: "siren", urgent: "chime", routine: "soft" }]);
    expect(h.state().soundPrefs).toMatchObject({ routine: "soft" });

    h.routes.put = (r) => (r.method === "PUT" ? { status: 404, body: { error: "module_disabled", module: "messaging.alertSounds" } } : undefined);
    const before = count(h, "GET", "/api/modules");
    h.modules = { "messaging.alertSounds": false };
    expect(await h.w.DT.actions.setSoundPref("stat", "none")).toBe(false);
    expect(h.state().__toast).toMatchObject({ tone: "rejected", msg: "Alert sounds are switched off for your organization." });
    expect(h.state().soundPrefs).toMatchObject({ stat: "siren" });
    await until(() => count(h, "GET", "/api/modules") > before);
  });

  it("Preview plays the chosen tone", async () => {
    const { h, played } = await withSounds();
    expect(h.w.DT.actions.previewSound("alarm")).toBe(true);
    expect(played.map((p) => p[0])).toEqual([FIRST_HZ.alarm]);
    expect(h.w.DT.actions.previewSound("none")).toBe(false);
  });
});
