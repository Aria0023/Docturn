/* DocTurn web-app UI kit — secure messaging (conversation list + thread).
   Fully store-backed: conversations and threads persist, unread clears when a
   thread is actually on screen, sending goes through api-bridge's outbox
   (Sending… → Delivered → Read from the server's delivery rows, or Not sent
   with Retry / Edit), and the typing indicator is REAL — peers'
   typing_start/stop relayed over the WebSocket (never simulated). Attachments
   open in an in-app viewer built from an authenticated fetch (never a new
   browsing context), and every control whose org module is off is hidden. */

function fmtTime(at) {
  // single source of truth — shared with the store's clock + mobile composer
  if (window.dtFmt && window.dtFmt.hhmm) return window.dtFmt.hhmm(at);
  const d = new Date(at);
  return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
}

// Human-readable byte size for an attachment download chip.
function fmtBytes(n) {
  if (n == null) return "";
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return Math.round(n / 1024) + " KB";
  return (n / 1024 / 1024).toFixed(1) + " MB";
}

// The compose picker rows are themselves buttons, so their "Message" cue is a
// look-alike label, not a nested <button> (invalid HTML; iOS can route the tap
// to either element).
function MessagePill() {
  return (
    <span aria-hidden="true" style={{ display: "inline-flex", alignItems: "center", gap: 7, height: 36, padding: "0 12px", flex: "none", borderRadius: "var(--radius-md)", border: "1px solid var(--border)", background: "#fff", color: "var(--foreground)", fontSize: 13, fontWeight: 500, whiteSpace: "nowrap" }}>
      <Icon name="message-square" size={16} />Message
    </span>
  );
}

// ---- attachments ------------------------------------------------------------
function attachmentUrl(at) { return at.url || ("/api/messaging/attachments/" + at.id); }
function attachmentKind(at) {
  const t = String(at.mimeType || "").split(";")[0].toLowerCase();
  if (at.isImage || t.indexOf("image/") === 0) return "image";
  if (at.isAudio || t.indexOf("audio/") === 0) return "audio";
  if (t.indexOf("video/") === 0) return "video";
  if (t === "application/pdf") return "pdf";
  if (t === "text/plain") return "text";
  return "file";
}
const AUDIO_FORMAT = { "audio/webm": "WebM", "audio/ogg": "Ogg", "audio/mp4": "MP4 (AAC)", "audio/aac": "AAC", "audio/mpeg": "MP3", "audio/wav": "WAV" };
// Hand a Blob to the device as a file — the download path that stays inside
// the app document (no window.open / target=_blank, A.NEE-NEE-1/2). On iOS this
// is the system's download sheet; the bytes were already fetched with the
// app's own session, so no cookie is needed.
function saveBlob(blob, fileName) {
  const u = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = u; link.download = fileName || "attachment"; link.rel = "noopener"; link.style.display = "none";
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(u), 60000);
}
function attachmentError(e) {
  const s = e && e.status;
  if (s === 401) return "Your session has expired — sign in again to open this file.";
  if (s === 403) return "You don't have access to this attachment.";
  if (s === 404) return "This attachment is no longer available.";
  if (s === 0) return "This attachment can't be opened here.";
  return "Couldn't load the attachment — check your connection and try again.";
}

// Full-screen in-app viewer. The bytes come from DT.actions.fetchAttachment
// (this document's credentials) as a blob: URL for images, video, audio and
// text. PDFs are previewed through a same-origin frame — the CSP's frame-src
// 'self' deliberately admits no blob: frames — and only where the browser has
// a built-in PDF viewer; Download always works.
function AttachmentViewer({ at, onClose, actions, isMobile }) {
  const url = attachmentUrl(at);
  const kind = attachmentKind(at);
  const [state, setState] = React.useState("loading"); // loading | ready | error
  const [err, setErr] = React.useState("");
  const [obj, setObj] = React.useState(null); // { url, blob }
  const [text, setText] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [attempt, setAttempt] = React.useState(0);
  const closeRef = React.useRef(null);
  const pdfInline = kind === "pdf" && navigator.pdfViewerEnabled === true;
  React.useEffect(() => {
    let alive = true, made = null;
    setState("loading"); setErr("");
    const fail = (e) => { if (!alive) return; setErr(attachmentError(e)); setState("error"); };
    if (kind === "pdf" || kind === "file") {
      // Access check without pulling the whole file (the route serves Range).
      actions.fetchAttachment(url, { range: "bytes=0-0" }).then(() => { if (alive) setState("ready"); }, fail);
    } else {
      actions.fetchAttachment(url).then((r) => {
        if (!alive) return;
        made = URL.createObjectURL(r.blob);
        setObj({ url: made, blob: r.blob });
        if (kind === "text") r.blob.text().then((t) => { if (alive) { setText(t.slice(0, 200000)); setState("ready"); } }, fail);
        else setState("ready");
      }, fail);
    }
    return () => { alive = false; if (made) URL.revokeObjectURL(made); };
  }, [url, attempt]);
  React.useEffect(() => {
    if (closeRef.current) closeRef.current.focus();
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const download = () => {
    if (obj && obj.blob) { saveBlob(obj.blob, at.fileName); return; }
    setBusy(true);
    actions.fetchAttachment(url).then((r) => { saveBlob(r.blob, at.fileName); setBusy(false); }, (e) => { setBusy(false); setErr(attachmentError(e)); setState("error"); });
  };
  const iconBtn = { width: 44, height: 44, flex: "none", borderRadius: 99, border: "1px solid rgba(255,255,255,.35)", background: "rgba(255,255,255,.08)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" };
  return (
    <div data-attachment-viewer data-kind={kind} data-state={state} role="dialog" aria-modal="true" aria-label={at.fileName || "Attachment"}
      style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(15,23,42,.94)", display: "flex", flexDirection: "column", paddingTop: "var(--sai-top, 0px)", paddingBottom: "var(--sai-bottom, 0px)", paddingLeft: "var(--sai-left, 0px)", paddingRight: "var(--sai-right, 0px)" }}>
      <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 10, padding: isMobile ? "8px 12px" : "12px 18px", color: "#fff" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{at.fileName || "Attachment"}</div>
          <div style={{ fontSize: 12, opacity: .75 }}>{fmtBytes(at.byteSize)}{at.forwarded ? " · forwarded" : ""}</div>
        </div>
        <button type="button" data-attachment-download onClick={download} disabled={busy} aria-label="Download" title="Download" style={iconBtn}>
          <Icon name={busy ? "loader" : "download"} size={20} color="#fff" />
        </button>
        <button type="button" ref={closeRef} onClick={onClose} aria-label="Close" title="Close" style={iconBtn}>
          <Icon name="x" size={22} color="#fff" />
        </button>
      </div>
      <div style={{ flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center", padding: isMobile ? 8 : 20, overflow: "auto" }}>
        {state === "loading" && <div style={{ color: "#fff", fontSize: 14, opacity: .85 }}>Loading…</div>}
        {state === "error" && (
          <div role="alert" style={{ maxWidth: 360, textAlign: "center", color: "#fff" }}>
            <Icon name="alert-triangle" size={28} color="#FCA5A5" />
            <div style={{ fontSize: 15, fontWeight: 600, marginTop: 10, lineHeight: 1.45 }}>{err}</div>
            <button type="button" onClick={() => setAttempt((n) => n + 1)} style={{ marginTop: 14, minHeight: 44, padding: "0 18px", borderRadius: 99, border: "1px solid rgba(255,255,255,.4)", background: "transparent", color: "#fff", fontWeight: 600, fontSize: 14, cursor: "pointer", fontFamily: "inherit" }}>Try again</button>
          </div>
        )}
        {state === "ready" && kind === "image" && obj && <img src={obj.url} alt={at.fileName || "Image attachment"} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", borderRadius: 6, background: "#fff" }} />}
        {state === "ready" && kind === "video" && obj && <video src={obj.url} controls playsInline style={{ maxWidth: "100%", maxHeight: "100%" }} />}
        {state === "ready" && kind === "audio" && obj && <audio src={obj.url} controls style={{ width: "min(420px, 100%)" }} />}
        {state === "ready" && kind === "text" && <pre style={{ margin: 0, alignSelf: "stretch", flex: 1, overflow: "auto", background: "#fff", color: "var(--foreground)", borderRadius: 8, padding: 14, fontSize: 14, lineHeight: 1.5, whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontFamily: "var(--font-mono, ui-monospace, monospace)" }}>{text}</pre>}
        {state === "ready" && kind === "pdf" && pdfInline && <iframe src={url} title={at.fileName || "PDF attachment"} style={{ alignSelf: "stretch", flex: 1, width: "100%", border: "none", borderRadius: 6, background: "#fff" }} />}
        {state === "ready" && (kind === "file" || (kind === "pdf" && !pdfInline)) && (
          <div style={{ maxWidth: 360, textAlign: "center", color: "#fff" }}>
            <Icon name={kind === "pdf" ? "file-text" : "paperclip"} size={34} color="#fff" />
            <div style={{ fontSize: 15, fontWeight: 600, marginTop: 10 }}>No preview for this file on this device.</div>
            <div style={{ fontSize: 13, opacity: .8, marginTop: 4, lineHeight: 1.45 }}>Download it to open it with another app.</div>
            <button type="button" onClick={download} disabled={busy} style={{ marginTop: 14, minHeight: 44, padding: "0 20px", borderRadius: 99, border: "none", background: "#fff", color: "var(--primary)", fontWeight: 700, fontSize: 14, cursor: "pointer", fontFamily: "inherit", display: "inline-flex", alignItems: "center", gap: 7 }}>
              <Icon name="download" size={16} />Download
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// A voice note in the thread (A.NEE-NEE-3). If this device cannot decode the
// clip's container (e.g. a WebM note recorded on Chrome, played on an iPhone)
// it says so up front and offers Download instead of a player that does
// nothing; if playback fails later, the bytes are probed so the reason shown is
// the real one (no access / gone / undecodable).
function VoiceNote({ at, isMobile, actions, fmtDur }) {
  const url = attachmentUrl(at);
  const mime = String(at.mimeType || "").split(";")[0].toLowerCase();
  const canPlay = React.useMemo(() => {
    try { return !mime || document.createElement("audio").canPlayType(mime) !== ""; } catch (e) { return true; }
  }, [mime]);
  const [state, setState] = React.useState(canPlay ? "ready" : "unplayable"); // ready | unplayable | unavailable
  const [why, setWhy] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const onError = () => {
    actions.fetchAttachment(url, { range: "bytes=0-0" }).then(
      () => setState("unplayable"),
      (e) => { if (e && (e.status === 401 || e.status === 403 || e.status === 404)) { setWhy(attachmentError(e)); setState("unavailable"); } else setState("unplayable"); });
  };
  const download = () => {
    setBusy(true);
    actions.fetchAttachment(url).then((r) => { setBusy(false); saveBlob(r.blob, at.fileName || "voice-message"); }, (e) => { setBusy(false); setWhy(attachmentError(e)); setState("unavailable"); });
  };
  const box = { clear: "both", marginTop: 6, display: "flex", alignItems: "center", gap: 9, padding: isMobile ? "9px 12px" : "8px 11px", borderRadius: 12, background: "#fff", border: "1px solid var(--border)", maxWidth: 280, minWidth: 0 };
  if (state === "ready") {
    return (
      <span data-voice-note data-state="ready" style={box}>
        <Icon name="mic" size={16} color="var(--primary)" />
        <audio controls preload="none" src={url} onError={onError} aria-label={"Voice message" + (at.durationMs ? ", " + fmtDur(at.durationMs) : "")} style={{ height: 34, maxWidth: 200, minWidth: 0 }} />
        {at.durationMs ? <span style={{ fontSize: 11, color: "var(--muted-foreground)", whiteSpace: "nowrap" }}>{fmtDur(at.durationMs)}</span> : null}
      </span>
    );
  }
  const fmt = AUDIO_FORMAT[mime] || (mime ? mime.replace(/^audio\//, "").toUpperCase() : "this");
  return (
    <span data-voice-note data-state={state} role="group" aria-label="Voice message" style={Object.assign({}, box, { alignItems: "flex-start", flexDirection: "column", gap: 6, maxWidth: 300 })}>
      <span style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13, fontWeight: 600, color: "var(--foreground)" }}>
        <Icon name="mic-off" size={16} color="var(--muted-foreground)" />
        {state === "unplayable" ? "Can't play this voice note on this device" : "Voice note unavailable"}
        {at.durationMs ? <span style={{ fontWeight: 500, color: "var(--muted-foreground)" }}>· {fmtDur(at.durationMs)}</span> : null}
      </span>
      <span style={{ fontSize: 12, color: "var(--muted-foreground)", lineHeight: 1.4 }}>
        {state === "unplayable" ? "It was recorded as " + fmt + " audio, which this browser can't decode. Download it to play it in another app." : why}
      </span>
      {state === "unplayable" && (
        <button type="button" data-attachment-download onClick={download} disabled={busy}
          style={{ minHeight: 44, padding: "0 14px", borderRadius: 99, border: "1px solid var(--border)", background: "#fff", color: "var(--primary)", fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: "inherit", display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Icon name="download" size={14} />{busy ? "Downloading…" : "Download"}
        </button>
      )}
    </span>
  );
}

// Voice recording container, best first (A.NEE-NEE-3): AAC in MP4 plays on
// every iPhone and desktop browser, so it wins wherever MediaRecorder can
// produce it (Safari; Chromium builds with an AAC encoder). Otherwise WebM/Opus
// (Chromium, Firefox). The bare "audio/mp4" comes after WebM on purpose:
// Chromium answers yes to it but writes Opus-in-MP4, which iOS can't play and
// which would be mislabelled .m4a.
const VOICE_TYPES = ["audio/mp4;codecs=mp4a.40.2", "audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
function voiceTypes() {
  const MR = window.MediaRecorder;
  if (!MR || typeof MR.isTypeSupported !== "function") return [];
  return VOICE_TYPES.filter((t) => { try { return MR.isTypeSupported(t); } catch (e) { return false; } });
}

// Sender-side receipt: [icon, colour, label]. "sending"/"failed" are this
// device's outbox states; the rest come from the server's delivery rows.
const RECEIPT = {
  sending: ["clock", "var(--muted-foreground)", "Sending…"],
  sent: ["check", "var(--muted-foreground)", "Sent"],
  delivered: ["check", "var(--muted-foreground)", "Delivered"],
  read: ["check-check", "var(--status-active)", "Read"],
  failed: ["alert-circle", "var(--destructive)", "Not sent"],
};
// Per-message footer controls (Forward / Recall / Seen by): plain text links on
// desktop, real 44x44 targets on a phone (A.CON-SHO-61, A.CON-MIN-8).
function footBtn(isMobile) {
  return {
    border: "none", background: "transparent", cursor: "pointer", color: "var(--muted-foreground)", fontFamily: "inherit",
    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: isMobile ? 4 : 3, fontWeight: isMobile ? 600 : undefined,
    padding: isMobile ? "0 10px" : 0, marginLeft: isMobile ? 0 : 2,
    minHeight: isMobile ? 44 : undefined, minWidth: isMobile ? 44 : undefined, fontSize: isMobile ? 12.5 : 10.5,
  };
}
function failBtn(isMobile, primary) {
  return {
    display: "inline-flex", alignItems: "center", gap: 5, minHeight: isMobile ? 44 : 30, minWidth: 44, padding: "0 14px",
    borderRadius: 99, cursor: "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: 700,
    border: "1px solid " + (primary ? "var(--destructive)" : "var(--border)"),
    background: primary ? "var(--destructive)" : "#fff", color: primary ? "#fff" : "var(--foreground)",
  };
}

function Messaging() {
  const st = useStore();
  const a = useActions();
  const convos = st.conversations;
  const isMobile = useIsMobile();
  const [active, setActive] = React.useState(st.__activeConvo || (convos[0] && convos[0].id));
  const [draft, setDraft] = React.useState("");
  const [priority, setPriority] = React.useState("routine"); // routine | urgent | stat
  const [pending, setPending] = React.useState([]); // uploaded-but-unsent attachments
  const fileInputRef = React.useRef(null);
  const [q, setQ] = React.useState("");
  const [composing, setComposing] = React.useState(false);
  const [forwarding, setForwarding] = React.useState(null); // message being forwarded, or null
  const [keepPrio, setKeepPrio] = React.useState(false); // forward: keep the original priority (default routine)
  const [tplOpen, setTplOpen] = React.useState(false); // composer template picker
  const [statusFor, setStatusFor] = React.useState(null); // message id whose per-recipient status is expanded
  const [mobileView, setMobileView] = React.useState("list"); // phone: "list" | "thread"
  const [viewing, setViewing] = React.useState(null); // attachment open in the in-app viewer
  // Feature modules: hide a control when the org has switched it off (server
  // enforces; a missing helper means "enabled").
  const modOn = (id) => !(window.DT && window.DT.moduleOn) || window.DT.moduleOn(id);
  const canAttach = modOn("messaging.attachments");
  const prioOn = modOn("messaging.priority");
  const openThread = (id) => { setActive(id); if (isMobile) setMobileView("thread"); };

  // follow a store-initiated conversation switch (e.g. "Message" from another screen)
  React.useEffect(() => { if (st.__activeConvo && st.__activeConvo !== active) setActive(st.__activeConvo); }, [st.__activeConvo]);
  // a different thread starts with an empty attachment tray
  React.useEffect(() => { setPending([]); }, [active]);
  // Priority switched off for the org: nothing but routine can be composed.
  React.useEffect(() => { if (!prioOn && priority !== "routine") setPriority("routine"); }, [prioOn]);
  const conv = convos.find((c) => c.id === active) || convos[0];
  const cid = conv ? conv.id : null;
  // 1:1 peer availability → auto-response banner (DND / covering / off-shift).
  // Only for a TRUE one-to-one: if a covering provider has joined (DND forward
  // adds them), the thread has >1 other participant and is no longer a 1:1, so
  // no peer banner.
  const meId = st.me && st.me.id;
  const peerOthers = conv && !conv.group && !conv.broadcast
    ? (conv.participantIds || []).filter((id) => id !== meId)
    : [];
  const peerId = peerOthers.length === 1 ? peerOthers[0] : null;
  React.useEffect(() => { if (peerId != null && a.loadPeerAvailability) a.loadPeerAvailability(peerId); }, [peerId]);
  const peerAvail = peerId != null ? (st.peerAvail || {})[peerId] : null;

  const list = convos.filter((c) => c.name.toLowerCase().includes(q.toLowerCase()) || (c.role || "").toLowerCase().includes(q.toLowerCase()));

  // On a phone, show exactly one pane at a time (list OR thread/compose).
  const showList = !isMobile || (!composing && mobileView === "list");
  const showThread = !isMobile || composing || mobileView === "thread";

  // ---- open at the newest message (A.CON-SHO-47, A.CON-SHO-66) ------------
  // The thread pane unmounts on a phone whenever the list is shown, and the
  // tapped thread is often already `active`, so no message-count dependency
  // changes when it reopens. Pin (a) whenever the scroller MOUNTS (callback
  // ref), (b) whenever the conversation or the pane changes (a switch between
  // two threads with the same number of messages), (c) on new messages /
  // typing as before, and (d) when late content — an image thumbnail, the
  // keyboard resizing the pane — grows it while the reader is at the bottom.
  const threadRef = React.useRef(null);
  const stickRef = React.useRef(true); // reader is at (or was sent to) the bottom
  const pin = () => { const el = threadRef.current; if (el) el.scrollTop = el.scrollHeight; };
  const setThreadEl = React.useCallback((el) => {
    threadRef.current = el;
    if (el) { stickRef.current = true; el.scrollTop = el.scrollHeight; }
  }, []);
  React.useLayoutEffect(() => { stickRef.current = true; pin(); }, [cid, showThread]);
  React.useLayoutEffect(() => { pin(); }, [conv && conv.messages.length, conv && conv.typing]);
  const onThreadScroll = (e) => { const el = e.currentTarget; stickRef.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 48; };
  const onLateContent = () => { if (stickRef.current) pin(); };
  React.useEffect(() => {
    const el = threadRef.current;
    const vv = window.visualViewport;
    const ro = typeof ResizeObserver !== "undefined" && el ? new ResizeObserver(onLateContent) : null;
    if (ro) ro.observe(el);
    if (vv) vv.addEventListener("resize", onLateContent);
    return () => { if (ro) ro.disconnect(); if (vv) vv.removeEventListener("resize", onLateContent); };
  }, [cid, showThread]);

  // ---- read state: only a thread that is actually ON SCREEN is "read" -------
  // (A.CON-SHO-26). Not the phone's list view, not a backgrounded app — and new
  // messages arriving into the open thread are read too.
  const [docVisible, setDocVisible] = React.useState(() => typeof document === "undefined" || document.visibilityState !== "hidden");
  React.useEffect(() => {
    const on = () => setDocVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);
  const incoming = conv ? conv.messages.filter((m) => !m.me && m.id != null) : [];
  const incomingKey = incoming.length + ":" + (incoming.length ? incoming[incoming.length - 1].id : "");
  const threadOnScreen = !!conv && showThread && !composing && docVisible;
  React.useEffect(() => { if (threadOnScreen) a.openConversation(cid); }, [cid, threadOnScreen, incomingKey]);

  const send = () => {
    if (!conv || (!draft.trim() && pending.length === 0)) return;
    a.sendMessage(cid, draft, prioOn ? priority : "routine", pending);
    setDraft(""); setPriority("routine"); setPending([]);
    stickRef.current = true;
    if (a.setTyping) a.setTyping(cid, false);
  };
  // A "Not sent" message: Retry as-is, Retry as routine (its priority was
  // refused), or Edit — its text, priority and attachments go back into the
  // composer so nothing typed is lost.
  const retryFailed = (m, asRoutine) => { if (a.retryMessage) a.retryMessage(m.localId, { asRoutine: !!asRoutine }); };
  const editFailed = (m) => {
    const d = a.takeFailedMessage && a.takeFailedMessage(m.localId);
    if (!d) return;
    setDraft((cur) => (cur && cur.trim() ? d.text + " " + cur : d.text));
    if (prioOn && d.priority !== "routine") setPriority(d.priority);
    if (canAttach && d.attachments.length) setPending((prev) => d.attachments.filter((x) => !prev.some((p) => p.id === x.id)).concat(prev));
  };
  // Recall my own message while nobody has read it (server enforces unread-only).
  const recall = (m) => {
    if (!a.recallMessage) return;
    if (!window.confirm("Recall this message? It will be removed for everyone in this conversation.")) return;
    a.recallMessage(cid, m.id);
  };
  // Upload each chosen file, appending it to the pending chips as it lands.
  const onPickFiles = (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = ""; // allow re-picking the same file later
    files.forEach((f) => {
      Promise.resolve(a.uploadAttachment && a.uploadAttachment(f))
        .then((res) => { if (res && res.id) setPending((prev) => prev.concat([res])); })
        .catch(() => { if (a.toast) a.toast({ tone: "rejected", title: "Upload failed", msg: f.name }); });
    });
  };
  const removePending = (id) => setPending((prev) => prev.filter((p) => p.id !== id));

  // ---- Voice messages (module: messaging.voice) --------------------------
  // Record audio with the browser MediaRecorder API, then upload it through the
  // SAME encrypted-attachment path as any file. HIPAA notes: audio bytes live in
  // memory only (never localStorage); we never send the clip to any speech-to-
  // text service (no Web Speech API); the mic stream tracks are always stopped.
  const VOICE_MAX_SECS = 180;
  const [recording, setRecording] = React.useState(false);
  const [recSecs, setRecSecs] = React.useState(0);
  const recRef = React.useRef(null);      // MediaRecorder
  const chunksRef = React.useRef([]);
  const streamRef = React.useRef(null);
  const recTimerRef = React.useRef(null);
  const recStartRef = React.useRef(0);
  const recCancelRef = React.useRef(false);
  // Voice notes travel as attachments, so they need both switches.
  const canVoice = canAttach && modOn("messaging.voice") && typeof window.MediaRecorder !== "undefined" &&
    navigator.mediaDevices && navigator.mediaDevices.getUserMedia;

  const stopTracks = () => { if (streamRef.current) { streamRef.current.getTracks().forEach((t) => t.stop()); streamRef.current = null; } };
  const clearRecTimer = () => { if (recTimerRef.current) { clearInterval(recTimerRef.current); recTimerRef.current = null; } };

  const startRec = async () => {
    if (recording || !conv || conv.broadcast) return;
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch (err) { if (a.toast) a.toast({ tone: "rejected", title: "Microphone blocked", msg: "Allow mic access to record a voice message." }); return; }
    // Best container this recorder supports (see VOICE_TYPES): AAC/MP4 where
    // available, else WebM/Opus. A candidate the constructor still refuses is
    // skipped; the browser default is the last resort. The stored mimeType is
    // the container without ";codecs=…" (the server allow-list's form).
    let mr = null, type = "";
    for (const t of voiceTypes().concat([""])) {
      try { mr = t ? new MediaRecorder(stream, { mimeType: t }) : new MediaRecorder(stream); type = t; break; } catch (err) { mr = null; }
    }
    if (!mr) { stream.getTracks().forEach((t) => t.stop()); if (a.toast) a.toast({ tone: "rejected", title: "Recording unsupported", msg: "This browser can't record audio." }); return; }
    streamRef.current = stream; recRef.current = mr; chunksRef.current = []; recCancelRef.current = false;
    mr.ondataavailable = (e) => { if (e.data && e.data.size) chunksRef.current.push(e.data); };
    mr.onstop = () => {
      clearRecTimer(); stopTracks();
      const durationMs = Math.max(0, Date.now() - recStartRef.current);
      const wasCancel = recCancelRef.current; setRecording(false); setRecSecs(0);
      if (wasCancel || !chunksRef.current.length) { chunksRef.current = []; return; }
      const baseType = (mr.mimeType || type || (chunksRef.current[0] && chunksRef.current[0].type) || "audio/webm").split(";")[0].trim().toLowerCase();
      const ext = baseType.indexOf("mp4") >= 0 ? "m4a" : baseType.indexOf("ogg") >= 0 ? "ogg" : "webm";
      const blob = new Blob(chunksRef.current, { type: baseType });
      chunksRef.current = [];
      const file = new File([blob], "voice-" + Date.now() + "." + ext, { type: baseType });
      Promise.resolve(a.uploadAttachment && a.uploadAttachment(file, { durationMs }))
        .then((res) => { if (res && res.id) setPending((prev) => prev.concat([res])); })
        .catch(() => { if (a.toast) a.toast({ tone: "rejected", title: "Upload failed", msg: "Voice message" }); });
    };
    mr.start(); recStartRef.current = Date.now(); setRecording(true); setRecSecs(0);
    recTimerRef.current = setInterval(() => {
      const s = Math.floor((Date.now() - recStartRef.current) / 1000);
      setRecSecs(s);
      if (s >= VOICE_MAX_SECS) stopRec(); // hard cap; server rejects longer anyway
    }, 250);
  };
  const stopRec = () => { const mr = recRef.current; if (mr && mr.state !== "inactive") mr.stop(); };
  const cancelRec = () => { recCancelRef.current = true; stopRec(); };
  React.useEffect(() => () => { clearRecTimer(); stopTracks(); }, []); // cleanup on unmount
  const fmtDur = (ms) => { const s = Math.round((ms || 0) / 1000); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };
  const PRIO = { urgent: { label: "Urgent", color: "#B45309", bg: "#FEF3C7", icon: "alert-triangle" }, stat: { label: "STAT", color: "#B91C1C", bg: "#FEE2E2", icon: "siren" } };
  // Forwarding is SERVER-backed: POST /api/messaging/messages/:id/forward
  // creates the message in the target thread with provenance (original
  // sender + time) and carries attachments by reference. The picker resolves
  // a person to their userId (directory first, then the org-wide people map)
  // or an on-call role to its target id.
  const userIdForPerson = (p) => {
    const d = (st.directory || []).find((x) => x.name === p.name);
    if (d) return d.id;
    const op = Object.values(st.orgPeople || {}).find((x) => x.name === p.name);
    return op ? op.id : null;
  };
  const finishForward = (target) => {
    const fw = forwarding;
    setForwarding(null); setComposing(false); setQ("");
    if (!fw || fw.id == null || !a.forwardMessage) return;
    Promise.resolve(a.forwardMessage(fw.id, target, { keepPriority: keepPrio })).then((m) => {
      if (m && m.conversationId != null) { setActive(m.conversationId); if (isMobile) setMobileView("thread"); }
    });
    setKeepPrio(false);
  };
  const startWith = (p) => {
    if (forwarding) {
      const uid = userIdForPerson(p);
      if (uid == null) { if (a.toast) a.toast({ tone: "rejected", title: "Can't forward", msg: p.name + " isn't a registered user." }); return; }
      finishForward({ participantIds: [uid] });
      return;
    }
    a.startConversation({ name: p.name, specialty: p.specialty, avatar: p.avatar, working: p.working, tint: p.working ? "emerald" : "slate" });
    setComposing(false); setQ(""); if (isMobile) setMobileView("thread");
  };

  // On-call / role addressing: whenever the compose picker opens, refresh the
  // server-resolved list of addressable roles (each already resolved to a real
  // messageable user in our org). Selecting one opens a thread named after the
  // role so it's clear who was addressed.
  const onCallTargets = st.onCallTargets || [];
  React.useEffect(() => { if (composing && a.listOnCallTargets) a.listOnCallTargets(); }, [composing]);
  const ROLE_ICON = { consult_service: "stethoscope", next_hospitalist: "repeat", care_team: "users" };
  const startRole = (t) => {
    if (forwarding) { finishForward({ roleTarget: t.id }); return; }
    if (a.startRoleConversation) a.startRoleConversation(t);
    setComposing(false); setQ(""); if (isMobile) setMobileView("thread");
  };
  // Composer templates (org-wide + mine): loaded when the picker opens.
  const templates = st.templates || [];
  React.useEffect(() => { if (tplOpen && a.listTemplates) a.listTemplates(); }, [tplOpen]);
  const insertTemplate = (t) => {
    setDraft((d) => (d && d.trim() ? d.replace(/\s+$/, "") + " " : "") + t.body);
    if (prioOn && (t.priority === "urgent" || t.priority === "stat")) setPriority(t.priority);
    setTplOpen(false);
  };
  const myRole = st.session && st.session.role;
  const canManageOrgTemplates = myRole === "director" || myRole === "er_director" || myRole === "developer";
  // Availability line above the composer (DND / off shift) — wording per spec:
  // "<Name> is unavailable — covering: <Covering Name>", plus their own away
  // message when they set one.
  const availLine = (() => {
    if (!peerAvail || !modOn("messaging.dnd")) return null;
    if (!peerAvail.dnd && peerAvail.working !== false) return null;
    const nm = peerAvail.displayName || conv.name;
    let text = nm + " is unavailable";
    if (peerAvail.covering) text += " — covering: " + peerAvail.covering.displayName;
    else if (peerAvail.dnd) text += " — do-not-disturb, no covering provider set. STAT messages will still alert them.";
    else text += " — off shift.";
    return { text, away: peerAvail.awayMessage || null, dnd: !!peerAvail.dnd };
  })();
  const rolesShown = onCallTargets.filter((t) => t.label.toLowerCase().includes(q.toLowerCase()));

  // Mirror the Directory exactly: you can start a message with anyone in the
  // provider directory (filtered by the same search box). Picking someone you
  // already have a thread with just reopens it (startConversation dedupes).
  // Full directory of people you can message (same live source as the Directory
  // tab); shown in a large full-panel picker when composing.
  const startable = (st.providers || []).filter((p) =>
    p.name.toLowerCase().includes(q.toLowerCase()) || (p.specialty || "").toLowerCase().includes(q.toLowerCase()));

  return (
    <div style={{ display: "flex", height: isMobile ? "100%" : "calc(100vh - 64px)", width: "100%", minWidth: 0 }}>
      {/* List */}
      {showList && (
      <div style={{ width: isMobile ? "100%" : 312, minWidth: 0, flex: isMobile ? "1 1 auto" : "none", borderRight: isMobile ? "none" : "1px solid var(--border)", background: "#fff", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "16px 16px 12px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <h2 style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>Messages</h2>
            <Button size="icon" variant={composing ? "secondary" : "outline"} icon={composing ? "x" : "pen-square"} onClick={() => { const n = !composing; setComposing(n); if (!n) setForwarding(null); }} />
          </div>
          <Field icon="search" placeholder="Search conversations…" value={q} onChange={setQ} />
        </div>

        <div style={{ overflowY: "auto", flex: 1 }}>
          {list.map((c) => {
            const last = c.messages[c.messages.length - 1];
            return (
              <button key={c.id} onClick={() => openThread(c.id)}
                style={{ width: "100%", display: "flex", gap: 11, padding: isMobile ? "15px 16px" : "12px 16px", border: "none", borderBottom: "1px solid var(--border)", cursor: "pointer", textAlign: "left",
                  background: active === c.id ? "#EFF6FF" : "#fff" }}>
                {/* alignSelf: the row is a stretch flex container; a stretched
                    wrapper is taller than the avatar and would hang the
                    presence dot below the avatar's rim. */}
                <div style={{ position: "relative", flex: "none", alignSelf: "flex-start" }}>
                  <Avatar initials={c.initials} size={isMobile ? 46 : 40} tint={c.tint} />
                  {!c.group && !c.broadcast && <span style={{ position: "absolute", bottom: -1, right: -1, display: "flex", border: "2px solid #fff", borderRadius: 99 }}><StatusDot status={c.presence} /></span>}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: isMobile ? 15.5 : 13.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.name}</span>
                    <span style={{ fontSize: 11, color: "var(--muted-foreground)", flex: "none", marginLeft: 6 }}>{last ? dtFmt.ago(last.at) : ""}</span>
                  </div>
                  <div style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 1 }}>{c.role}</div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 3, gap: 8 }}>
                    <span style={{ fontSize: isMobile ? 14 : 12.5, color: "var(--foreground)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", opacity: .8, display: "flex", alignItems: "center", gap: 5, minWidth: 0 }}>
                      {last && (last.priority === "stat" || last.priority === "urgent") && <span style={{ flex: "none", fontSize: 9.5, fontWeight: 800, padding: "1px 5px", borderRadius: 4, color: "#fff", background: last.priority === "stat" ? "#B91C1C" : "#B45309" }}>{last.priority === "stat" ? "STAT" : "URGENT"}</span>}
                      <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.typing ? "typing…" : (last ? (last.me ? "You: " : "") + last.text : "No messages yet")}</span>
                    </span>
                    {c.unread > 0 && <span style={{ flex: "none", minWidth: 18, height: 18, padding: "0 5px", borderRadius: 99, background: "var(--primary)", color: "#fff", fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{c.unread}</span>}
                  </div>
                </div>
              </button>
            );
          })}
          {list.length === 0 && <div style={{ padding: "18px 16px 6px", fontSize: 12.5, color: "var(--muted-foreground)" }}>No conversations yet — tap the pencil to message anyone in the directory.</div>}
        </div>
      </div>
      )}

      {/* Thread. minWidth 0 + maxWidth 100%: a wide child (the priority row, a
          long word) can no longer widen the pane past the viewport and push
          Send / Templates off-screen on a phone (A.CON-SHO-41, A.NEE-SHO-1). */}
      {showThread && (
      <div data-thread-pane style={{ flex: 1, minWidth: 0, maxWidth: "100%", display: "flex", flexDirection: "column", background: "var(--secondary)", position: "relative" }}>
        {composing && (
          <div style={{ position: "absolute", inset: 0, zIndex: 5, background: "#fff", display: "flex", flexDirection: "column" }}>
            <div style={{ height: 60, flex: "none", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 12, padding: "0 20px" }}>
              <Icon name={forwarding ? "forward" : "pen-square"} size={18} color="var(--primary)" />
              <div style={{ fontSize: 15, fontWeight: 700, flex: 1 }}>{forwarding ? "Forward to…" : "New message"}</div>
              <Button size="sm" variant="ghost" icon="x" onClick={() => { setComposing(false); setForwarding(null); setQ(""); }}>Close</Button>
            </div>
            {forwarding && (
              <div style={{ flex: "none", padding: "10px 20px", borderBottom: "1px solid var(--border)", background: "var(--secondary)", display: "flex", alignItems: "flex-start", gap: 8 }}>
                <Icon name="forward" size={13} color="var(--muted-foreground)" style={{ marginTop: 2, flex: "none" }} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: ".04em" }}>Forwarding</div>
                  <div style={{ fontSize: 12.5, color: "var(--foreground)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 460 }}>{forwarding.text}</div>
                  {(forwarding.attachments || []).length > 0 && <div style={{ fontSize: 11.5, color: "var(--muted-foreground)", marginTop: 2 }}><Icon name="paperclip" size={11} style={{ verticalAlign: "-1px", marginRight: 3 }} />{forwarding.attachments.length} attachment{forwarding.attachments.length === 1 ? "" : "s"} carried along</div>}
                </div>
                {forwarding.priority && forwarding.priority !== "routine" && (
                  <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600, color: PRIO[forwarding.priority] ? PRIO[forwarding.priority].color : "var(--foreground)", cursor: "pointer", flex: "none" }}>
                    <input type="checkbox" checked={keepPrio} onChange={(e) => setKeepPrio(e.target.checked)} />Keep {PRIO[forwarding.priority] ? PRIO[forwarding.priority].label : forwarding.priority}
                  </label>
                )}
              </div>
            )}
            <div style={{ padding: "12px 20px", flex: "none", borderBottom: "1px solid var(--border)" }}>
              <Field icon="search" placeholder="Search the directory by name or specialty…" value={q} onChange={setQ} />
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: "6px 0" }}>
              {rolesShown.length > 0 && (
                <div>
                  <div style={{ padding: "10px 24px 6px", fontSize: 11, fontWeight: 800, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--muted-foreground)" }}>On-call / roles</div>
                  {rolesShown.map((t) => {
                    const existing = convos.some((c) => c.name === t.label);
                    return (
                      <button key={t.id} onClick={() => startRole(t)}
                        onMouseEnter={(e) => e.currentTarget.style.background = "var(--secondary)"} onMouseLeave={(e) => e.currentTarget.style.background = "#fff"}
                        style={{ width: "100%", display: "flex", gap: 13, alignItems: "center", padding: "11px 24px", border: "none", borderBottom: "1px solid var(--border)", cursor: "pointer", textAlign: "left", background: "#fff" }}>
                        <div style={{ flex: "none", width: 40, height: 40, borderRadius: 99, background: "#EFF6FF", display: "flex", alignItems: "center", justifyContent: "center" }}>
                          <Icon name={ROLE_ICON[t.kind] || "user-check"} size={19} color="var(--primary)" />
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 14, fontWeight: 600 }}>{t.label}</div>
                          <div style={{ fontSize: 12.5, color: "var(--muted-foreground)" }}>Resolves to whoever currently holds this role</div>
                        </div>
                        {existing
                          ? <span style={{ fontSize: 12, color: "var(--muted-foreground)" }}>Open thread</span>
                          : <MessagePill />}
                      </button>
                    );
                  })}
                  <div style={{ padding: "10px 24px 6px", fontSize: 11, fontWeight: 800, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--muted-foreground)" }}>Directory</div>
                </div>
              )}
              {startable.length === 0 && rolesShown.length === 0 && <div style={{ padding: 28, textAlign: "center", fontSize: 13, color: "var(--muted-foreground)" }}>No one in the directory matches "{q}".</div>}
              {startable.map((p) => {
                const existing = convos.some((c) => c.name === p.name);
                return (
                  <button key={p.id} onClick={() => startWith(p)}
                    onMouseEnter={(e) => e.currentTarget.style.background = "var(--secondary)"} onMouseLeave={(e) => e.currentTarget.style.background = "#fff"}
                    style={{ width: "100%", display: "flex", gap: 13, alignItems: "center", padding: "11px 24px", border: "none", borderBottom: "1px solid var(--border)", cursor: "pointer", textAlign: "left", background: "#fff" }}>
                    <div style={{ position: "relative", flex: "none" }}>
                      <Avatar initials={p.avatar} size={40} tint={p.working ? "emerald" : "slate"} />
                      <span style={{ position: "absolute", bottom: -1, right: -1, display: "flex", border: "2px solid #fff", borderRadius: 99 }}><StatusDot status={p.working ? "online" : "offline"} pulse={p.working} /></span>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 600 }}>{p.name}</div>
                      <div style={{ fontSize: 12.5, color: "var(--muted-foreground)" }}>{p.specialty}{p.working ? " · on shift" : " · off shift"}</div>
                    </div>
                    {existing
                      ? <span style={{ fontSize: 12, color: "var(--muted-foreground)" }}>Open thread</span>
                      : <MessagePill />}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        {conv ? (<React.Fragment>
        <div style={{ height: 60, flex: "none", background: "#fff", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 12, padding: isMobile ? "0 12px" : "0 20px" }}>
          {isMobile && <button type="button" onClick={() => setMobileView("list")} title="Back" aria-label="Back to conversations" style={{ width: 44, height: 44, marginLeft: -8, borderRadius: "var(--radius-md)", border: "none", background: "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}><Icon name="arrow-left" size={23} /></button>}
          <Avatar initials={conv.initials} size={36} tint={conv.tint} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14.5, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{conv.name}</div>
            <div style={{ fontSize: 12, color: "var(--muted-foreground)", display: "flex", alignItems: "center", gap: 5, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden" }}>
              {conv.patientId != null && <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "1px 8px", borderRadius: 99, fontSize: 10.5, fontWeight: 700, color: "var(--primary)", background: "#EFF6FF", border: "1px solid var(--primary)", marginRight: 6, flex: "none" }}><Icon name="clipboard-list" size={11} />Patient thread</span>}
              {conv.typing ? <span style={{ color: "var(--status-active)", fontWeight: 600 }}>typing…</span>
                : <><StatusDot status={conv.presence} pulse={conv.presence === "online"} /><span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{conv.presence === "online" ? "Online" : conv.role}</span></>}
            </div>
          </div>
          {/* No call button: voice isn't a real capability yet — no fake affordances. */}
          <span data-thread-details style={{ flex: "none", display: "inline-flex" }}>
            <Button size="icon" variant="ghost" icon="info" title="Conversation details" onClick={() => a.toast({ tone: "accepted", title: conv.name, msg: (conv.group ? conv.role : conv.role + " · ") + (conv.messages.length) + " messages." })} />
          </span>
        </div>

        {/* Availability line for a 1:1 peer (DND / off shift + their away message). */}
        {availLine && (
          <div data-availability-line style={{ flex: "none", padding: "9px 16px", display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12.5, lineHeight: 1.4,
            background: availLine.dnd ? "#FEF3C7" : "var(--secondary)", color: availLine.dnd ? "#92400E" : "var(--muted-foreground)", borderBottom: "1px solid " + (availLine.dnd ? "#FCD34D" : "var(--border)") }}>
            <Icon name={availLine.dnd ? "moon" : "clock"} size={14} style={{ flex: "none", marginTop: 2 }} />
            <span style={{ minWidth: 0 }}>
              <span style={{ fontWeight: 600 }}>{availLine.text}</span>
              {availLine.away && <span style={{ display: "block", marginTop: 2, fontStyle: "italic", opacity: .9 }}>“{availLine.away}”</span>}
            </span>
          </div>
        )}

        <div ref={setThreadEl} data-thread-scroll onScroll={onThreadScroll} style={{ flex: 1, minHeight: 0, minWidth: 0, overflowY: "auto", overflowX: "hidden", padding: isMobile ? "14px 12px" : 20, display: "flex", flexDirection: "column", gap: isMobile ? 10 : 12 }}>
          <div style={{ textAlign: "center", fontSize: 11.5, color: "var(--muted-foreground)" }}>
            <span style={{ background: "#fff", padding: "3px 12px", borderRadius: 99, border: "1px solid var(--border)" }}>
              <Icon name="lock" size={11} style={{ marginRight: 4, verticalAlign: "-1px" }} />Encrypted in transit · access audited
            </span>
          </div>
          {conv.messages.map((m, i) => {
            const prio = PRIO[m.priority];
            const rc = m.me ? RECEIPT[m.receipt] : null;
            const canForward = !conv.broadcast && m.id != null && (m.text || (m.attachments || []).length > 0) && modOn("messaging.forwarding");
            const canRecall = m.me && m.id != null && !conv.broadcast && modOn("messaging.recall") && m.receipt !== "read" && !(m.ackCount > 0);
            const seenBy = conv.group && m.id != null && (m.deliveries || []).length > 0;
            return (
            <div key={m.id != null ? "m" + m.id : (m.localId || "i" + i)} data-message data-message-id={m.id != null ? m.id : undefined} data-local={m.local ? "" : undefined}
              style={{ display: "flex", justifyContent: m.me ? "flex-end" : "flex-start", minWidth: 0 }}>
              <div style={{ maxWidth: isMobile ? "82%" : "62%", minWidth: 0 }}>
                {prio && (
                  <div style={{ display: "inline-flex", alignItems: "center", gap: 4, marginBottom: 4, padding: "2px 8px", borderRadius: 99, fontSize: 10.5, fontWeight: 800, letterSpacing: ".03em", color: prio.color, background: prio.bg, border: "1px solid " + prio.color + "55", float: m.me ? "right" : "left" }}>
                    <Icon name={prio.icon} size={11} />{prio.label}
                  </div>
                )}
                {/* Provenance of a forwarded message (server-stamped, never editable). */}
                {m.forwardedFrom && (
                  <div data-forwarded-from style={{ clear: "both", display: "flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 600, color: "var(--muted-foreground)", marginBottom: 3, justifyContent: m.me ? "flex-end" : "flex-start" }}>
                    <Icon name="forward" size={11} />Forwarded from {m.forwardedFrom.senderName || "unknown"} · {m.forwardedFrom.sentAt ? dtFmt.ago(new Date(m.forwardedFrom.sentAt).getTime()) : ""}
                  </div>
                )}
                {m.text && (
                <div style={{ clear: "both", whiteSpace: "pre-wrap", overflowWrap: "anywhere", padding: isMobile ? "10px 14px" : "9px 13px", borderRadius: isMobile ? 16 : 14, fontSize: isMobile ? 15.5 : 13.5, lineHeight: 1.45,
                  background: m.me ? (m.receipt === "failed" ? "#FEF2F2" : "var(--primary)") : "#fff", color: m.me ? (m.receipt === "failed" ? "#7F1D1D" : "#fff") : "var(--foreground)",
                  opacity: m.receipt === "sending" ? .75 : 1,
                  border: m.me ? (m.receipt === "failed" ? "1px solid #FCA5A5" : "none") : (prio ? "1px solid " + prio.color + "88" : "1px solid var(--border)"),
                  borderBottomRightRadius: m.me ? 4 : 14, borderBottomLeftRadius: m.me ? 14 : 4 }}>{m.text}</div>
                )}
                {/* Attachments open IN the app (A.NEE-NEE-1/2): thumbnails and
                    chips are buttons for the in-app viewer, which fetches the
                    bytes with this document's session — never window.open or
                    target=_blank. Every fetch is access-checked + audited
                    server-side. An unsent message lists its files by name only. */}
                {(m.attachments || []).map((at) => {
                  const kind = attachmentKind(at);
                  if (m.local) return (
                    <span key={at.id} style={{ clear: "both", marginTop: 6, display: "flex", alignItems: "center", gap: 7, padding: "7px 11px", borderRadius: 12, background: "#fff", border: "1px solid var(--border)", fontSize: 13, color: "var(--foreground)", maxWidth: 260, minWidth: 0 }}>
                      <Icon name={kind === "audio" ? "mic" : "paperclip"} size={14} color="var(--muted-foreground)" />
                      <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{kind === "audio" ? "Voice message" : (at.fileName || "Attachment")}</span>
                    </span>
                  );
                  if (kind === "audio") return <VoiceNote key={at.id} at={at} isMobile={isMobile} actions={a} fmtDur={fmtDur} />;
                  if (kind === "image") return (
                    <button key={at.id} type="button" data-attachment-open data-kind="image" onClick={() => setViewing(at)} aria-label={"Open image " + (at.fileName || "")}
                      style={{ clear: "both", display: "block", marginTop: 6, padding: 0, border: "none", background: "transparent", cursor: "pointer", maxWidth: "100%" }}>
                      <img src={attachmentUrl(at)} alt={at.fileName} onLoad={onLateContent}
                        style={{ maxWidth: "min(220px, 100%)", maxHeight: 220, borderRadius: 10, display: "block", border: "1px solid var(--border)" }} />
                    </button>
                  );
                  return (
                    <button key={at.id} type="button" data-attachment-open data-kind={kind} onClick={() => setViewing(at)} aria-label={"Open " + (at.fileName || "attachment")}
                      style={{ clear: "both", marginTop: 6, display: "flex", alignItems: "center", gap: 9, padding: isMobile ? "11px 13px" : "9px 12px", borderRadius: 12, textAlign: "left", fontFamily: "inherit", cursor: "pointer",
                        background: "#fff", border: "1px solid var(--border)", color: "var(--foreground)", maxWidth: 260, minWidth: 0, width: "100%" }}>
                      <Icon name={kind === "pdf" || kind === "text" ? "file-text" : "paperclip"} size={16} color="var(--muted-foreground)" />
                      <span style={{ minWidth: 0 }}>
                        <span style={{ display: "block", fontSize: isMobile ? 14 : 12.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{at.fileName}</span>
                        <span style={{ display: "block", fontSize: 11, color: "var(--muted-foreground)" }}>{fmtBytes(at.byteSize)}</span>
                      </span>
                    </button>
                  );
                })}
                {/* Recipient: acknowledge an unacked STAT/urgent message. A full
                    44px target on phones, set apart from the footer controls
                    below it (A.CON-MIN-8). */}
                {!m.me && prio && !m.ackedByMe && m.id != null && (
                  <button type="button" data-ack onClick={() => a.acknowledgeMessage(conv.id, m.id)}
                    style={{ clear: "both", marginTop: isMobile ? 8 : 5, marginBottom: isMobile ? 6 : 0, display: "inline-flex", alignItems: "center", gap: 6, minHeight: isMobile ? 44 : undefined, padding: isMobile ? "0 20px" : "4px 12px", borderRadius: 99, cursor: "pointer", fontSize: isMobile ? 14 : 12, fontWeight: 700, fontFamily: "inherit", color: "#fff", background: prio.color, border: "none" }}>
                    <Icon name="check" size={isMobile ? 15 : 12} />Acknowledge
                  </button>
                )}
                {/* A message this device could not send: why, and what to do. */}
                {m.local && m.receipt === "failed" && (
                  <div data-failed-actions style={{ clear: "both", marginTop: 4, display: "flex", flexDirection: "column", alignItems: m.me ? "flex-end" : "flex-start", gap: 2 }}>
                    <span role="alert" style={{ fontSize: 12, color: "var(--destructive)", fontWeight: 600, textAlign: "right" }}>{(m.failReason && m.failReason.text) || "Not sent."}</span>
                    <span style={{ display: "flex", flexWrap: "wrap", gap: 6, justifyContent: "flex-end" }}>
                      <button type="button" data-retry onClick={() => retryFailed(m, false)} style={failBtn(isMobile, true)}><Icon name="rotate-ccw" size={13} />Retry</button>
                      {m.failReason && m.failReason.code === "priority_disabled" && (
                        <button type="button" data-send-routine onClick={() => retryFailed(m, true)} style={failBtn(isMobile, false)}>Send as routine</button>
                      )}
                      <button type="button" data-edit-failed onClick={() => editFailed(m)} style={failBtn(isMobile, false)}><Icon name="pencil" size={13} />Edit</button>
                    </span>
                  </div>
                )}
                <div data-message-footer style={{ clear: "both", fontSize: 10.5, color: "var(--muted-foreground)", marginTop: 3, display: "flex", flexWrap: "wrap", columnGap: isMobile ? 2 : 4, rowGap: 0, justifyContent: m.me ? "flex-end" : "flex-start", alignItems: "center" }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4, minHeight: isMobile ? 24 : undefined }}>
                    {fmtTime(m.at)}
                    {/* Sender's receipt — from the server's delivery rows, or this
                        device's own Sending… / Not sent (A.CON-SHO-26). */}
                    {rc && (
                      <span data-receipt={m.receipt} title={rc[2]} aria-label={rc[2]} role="img" style={{ display: "inline-flex", alignItems: "center", gap: 3, color: rc[1], fontWeight: 600 }}>
                        <Icon name={rc[0]} size={12} color={rc[1]} />{(m.receipt === "failed" || m.receipt === "sending") ? rc[2] : null}
                      </span>
                    )}
                    {/* Sender: ack status for a STAT/urgent the server stored. */}
                    {m.me && prio && !m.local && (m.ackCount > 0
                      ? <span style={{ color: "var(--status-active)", fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 3 }}><Icon name="check-check" size={12} />Acknowledged</span>
                      : <span style={{ color: prio.color, fontWeight: 600 }}>Awaiting ack…</span>)}
                    {!m.me && m.ackedByMe && prio && <span style={{ color: "var(--status-active)", fontWeight: 600 }}>✓ You acknowledged</span>}
                  </span>
                  {/* Group threads: per-recipient status, tap to expand. */}
                  {seenBy && (
                    <button type="button" data-recipient-status onClick={() => setStatusFor(statusFor === m.id ? null : m.id)} title="Who has seen this"
                      style={Object.assign(footBtn(isMobile), { textDecoration: "underline dotted" })}>
                      Seen by {m.deliveries.filter((d) => d.readAt).length}{prio ? " · Acked by " + m.deliveries.filter((d) => d.acknowledgedAt).length : ""} of {m.deliveries.length}
                    </button>
                  )}
                  {/* Forward this message to another person or on-call role (server-backed). */}
                  {canForward && (
                    <button type="button" data-forward onClick={() => { setForwarding(m); setKeepPrio(false); setComposing(true); setQ(""); }} title="Forward" aria-label="Forward message" style={footBtn(isMobile)}>
                      <Icon name="forward" size={isMobile ? 14 : 12} />Forward
                    </button>
                  )}
                  {/* Recall my own message while it is still unread (A.CON-SHO-25). */}
                  {canRecall && (
                    <button type="button" data-recall onClick={() => recall(m)} title="Recall (unsend) — only while unread" aria-label="Recall message" style={footBtn(isMobile)}>
                      <Icon name="undo-2" size={isMobile ? 14 : 12} />Recall
                    </button>
                  )}
                </div>
                {statusFor === m.id && (m.deliveries || []).length > 0 && (
                  <div data-recipient-status-list style={{ clear: "both", marginTop: 4, padding: "8px 10px", borderRadius: 10, background: "#fff", border: "1px solid var(--border)", fontSize: 11.5, display: "flex", flexDirection: "column", gap: 4 }}>
                    {m.deliveries.map((d) => {
                      const S = { acknowledged: ["check-check", "var(--status-active)", "Acknowledged"], read: ["check-check", "var(--status-active)", "Read"], delivered: ["check", "var(--muted-foreground)", "Delivered"], sent: ["clock", "var(--muted-foreground)", "Sent"] }[d.status] || ["clock", "var(--muted-foreground)", d.status];
                      const at = d.acknowledgedAt || d.readAt || d.deliveredAt;
                      return (
                        <div key={d.userId} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <Icon name={S[0]} size={12} color={S[1]} />
                          <span style={{ flex: 1, fontWeight: 600, color: "var(--foreground)" }}>{d.displayName || ("User " + d.userId)}</span>
                          <span style={{ color: S[1], fontWeight: 600 }}>{S[2]}</span>
                          {at && <span style={{ color: "var(--muted-foreground)" }}>{fmtTime(new Date(at).getTime())}</span>}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
            );
          })}
          {conv.typing && (
            <div style={{ display: "flex", justifyContent: "flex-start" }}>
              <div style={{ padding: "11px 15px", borderRadius: 14, borderBottomLeftRadius: 4, background: "#fff", border: "1px solid var(--border)", display: "flex", gap: 4 }}>
                {[0, 1, 2].map((d) => <span key={d} style={{ width: 6, height: 6, borderRadius: 99, background: "var(--muted-foreground)", animation: "dt-pulse 1.2s infinite", animationDelay: d * 0.18 + "s" }} />)}
              </div>
            </div>
          )}
        </div>

        {/* Pending attachments (uploaded, not yet sent) — removable chips shown
            above the Priority row. Synthetic-data pilot only: no PHI in filenames. */}
        {!conv.broadcast && pending.length > 0 && (
          <div style={{ flex: "none", padding: isMobile ? "8px 12px 0" : "8px 16px 0", background: "#fff", display: "flex", gap: 6, flexWrap: "wrap", minWidth: 0 }}>
            {pending.map((p) => (
              <span key={p.id} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: isMobile ? "0 4px 0 10px" : "5px 9px", borderRadius: 99, fontSize: isMobile ? 13 : 12, fontWeight: 500, color: "var(--foreground)", background: "var(--secondary)", border: "1px solid var(--border)", maxWidth: "100%", minWidth: 0 }}>
                <Icon name={p.isAudio ? "mic" : "paperclip"} size={13} color="var(--muted-foreground)" />
                <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>{p.isAudio ? ("Voice message" + (p.durationMs ? " · " + fmtDur(p.durationMs) : "")) : p.fileName}</span>
                <button type="button" onClick={() => removePending(p.id)} title="Remove" aria-label={"Remove " + (p.isAudio ? "voice message" : p.fileName)} style={{ border: "none", background: "transparent", cursor: "pointer", color: "var(--muted-foreground)", padding: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", minWidth: isMobile ? 40 : undefined, minHeight: isMobile ? 40 : undefined, flex: "none" }}><Icon name="x" size={isMobile ? 15 : 13} /></button>
              </span>
            ))}
          </div>
        )}
        {/* Template picker (search, insert into the draft, preselect priority)
            with a small manage view — anchored above the composer. */}
        {tplOpen && !conv.broadcast && modOn("messaging.templates") && (
          <TemplatePicker templates={templates} onPick={insertTemplate} onClose={() => setTplOpen(false)} canManageOrg={canManageOrgTemplates} actions={a} isMobile={isMobile} />
        )}
        {/* Priority chips + Templates. Each control appears only while its org
            module is on (A.CON-SHO-40). The row WRAPS instead of widening the
            pane, so on a 375px phone nothing is pushed off-screen (A.CON-SHO-41);
            the "Priority" caption is for screen readers there. */}
        {!conv.broadcast && (prioOn || modOn("messaging.templates")) && (
          <div data-priority-row style={{ flex: "none", padding: isMobile ? "8px 12px 0" : "8px 16px 0", background: "#fff", display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", minWidth: 0 }}>
            {prioOn && (
              <div role="radiogroup" aria-label="Priority" style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", minWidth: 0 }}>
                <span aria-hidden="true" style={isMobile ? { position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" } : { fontSize: 11.5, color: "var(--muted-foreground)", marginRight: 2 }}>Priority</span>
                {[["routine", "Routine", "var(--muted-foreground)"], ["urgent", "Urgent", "#B45309"], ["stat", "STAT", "#B91C1C"]].map(([id, label, color]) => (
                  <button key={id} type="button" role="radio" aria-checked={priority === id} onClick={() => setPriority(id)}
                    style={{ minHeight: isMobile ? 44 : undefined, padding: isMobile ? "0 10px" : "3px 11px", borderRadius: 99, cursor: "pointer", fontSize: isMobile ? 13 : 11.5, fontWeight: 700, fontFamily: "inherit", whiteSpace: "nowrap",
                      color: priority === id ? "#fff" : color, background: priority === id ? color : "transparent",
                      border: "1px solid " + (priority === id ? color : "var(--border)") }}>{label}</button>
                ))}
              </div>
            )}
            {modOn("messaging.templates") && (
              <button type="button" data-templates onClick={() => setTplOpen(!tplOpen)} title="Insert a message template" aria-expanded={tplOpen}
                style={{ marginLeft: "auto", minHeight: isMobile ? 44 : undefined, padding: isMobile ? "0 10px" : "3px 11px", borderRadius: 99, cursor: "pointer", fontSize: isMobile ? 13 : 11.5, fontWeight: 700, fontFamily: "inherit", display: "inline-flex", alignItems: "center", gap: 5, whiteSpace: "nowrap", flex: "none",
                  color: tplOpen ? "#fff" : "var(--primary)", background: tplOpen ? "var(--primary)" : "transparent", border: "1px solid " + (tplOpen ? "var(--primary)" : "var(--border)") }}>
                <Icon name="file-text" size={12} />Templates
              </button>
            )}
          </div>
        )}
        {/* No safe-area term here: the mobile shell's <main> already reserves the
            tab bar height + home-indicator inset (index.html), so adding it again
            left a blank band above the tab bar (A.CON-SHO-45/46/60). */}
        <div data-composer style={{ flex: "none", padding: isMobile ? "10px 12px" : 16, background: "#fff", borderTop: "1px solid var(--border)", display: "flex", gap: isMobile ? 8 : 10, alignItems: "center", minWidth: 0 }}>
          {/* Attachments module off: no paperclip and no file input at all (A.CON-SHO-40). */}
          {canAttach && <input ref={fileInputRef} type="file" multiple accept="image/*,application/pdf,video/mp4" onChange={onPickFiles} style={{ display: "none" }} />}
          {recording ? (
            <React.Fragment>
              <button type="button" onClick={cancelRec} title="Discard recording"
                style={{ width: isMobile ? 46 : 40, height: isMobile ? 46 : 40, flex: "none", borderRadius: 99, border: "1px solid var(--border)", background: "#fff", color: "var(--muted-foreground)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
                <Icon name="trash-2" size={isMobile ? 19 : 17} />
              </button>
              <div style={{ flex: 1, minWidth: 0, height: isMobile ? 46 : 40, borderRadius: isMobile ? 23 : "var(--radius-md)", border: "1.5px solid #B91C1C", background: "#FEF2F2", display: "flex", alignItems: "center", gap: 9, padding: "0 16px", color: "#B91C1C", fontWeight: 600, fontSize: isMobile ? 15 : 13, whiteSpace: "nowrap", overflow: "hidden" }}>
                <span style={{ width: 10, height: 10, flex: "none", borderRadius: 99, background: "#B91C1C", animation: "dt-blink 1s ease-in-out infinite" }} />
                Recording… {fmtDur(recSecs * 1000)} <span style={{ color: "var(--muted-foreground)", fontWeight: 500 }}>/ {fmtDur(VOICE_MAX_SECS * 1000)}</span>
              </div>
              <button type="button" onClick={stopRec} title="Stop & attach" style={{ width: isMobile ? 46 : 40, height: isMobile ? 46 : 40, flex: "none", borderRadius: 99, border: "none", background: "var(--primary)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}><Icon name="check" size={isMobile ? 22 : 19} color="#fff" /></button>
            </React.Fragment>
          ) : (
            <React.Fragment>
              {canAttach && (
                <button type="button" onClick={() => fileInputRef.current && fileInputRef.current.click()} title="Attach a file" disabled={conv.broadcast}
                  style={{ width: isMobile ? 46 : 40, height: isMobile ? 46 : 40, flex: "none", borderRadius: 99, border: "1px solid var(--border)", background: "#fff", color: "var(--muted-foreground)", display: "flex", alignItems: "center", justifyContent: "center", cursor: conv.broadcast ? "default" : "pointer" }}>
                  <Icon name="paperclip" size={isMobile ? 20 : 18} />
                </button>
              )}
              {canVoice && (
                <button type="button" onClick={startRec} title="Record a voice message" disabled={conv.broadcast}
                  style={{ width: isMobile ? 46 : 40, height: isMobile ? 46 : 40, flex: "none", borderRadius: 99, border: "1px solid var(--border)", background: "#fff", color: "var(--muted-foreground)", display: "flex", alignItems: "center", justifyContent: "center", cursor: conv.broadcast ? "default" : "pointer" }}>
                  <Icon name="mic" size={isMobile ? 20 : 18} />
                </button>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <input value={draft} onChange={(e) => { setDraft(e.target.value); if (a.setTyping) a.setTyping(conv.id, !!e.target.value); }} onKeyDown={(e) => e.key === "Enter" && send()} enterKeyHint="send" autoCapitalize="sentences" aria-label="Message"
                  onFocus={() => { stickRef.current = true; setTimeout(onLateContent, 350); }}
                  placeholder={conv.broadcast ? "Replies disabled for broadcasts" : (priority === "stat" ? "Type a STAT message…" : priority === "urgent" ? "Type an urgent message…" : "Type a secure message…")} disabled={conv.broadcast}
                  style={{ width: "100%", minWidth: 0, height: isMobile ? 46 : 40, border: (priority === "stat" ? "2px solid #B91C1C" : priority === "urgent" ? "2px solid #B45309" : "1.5px solid #94A3B8"), borderRadius: isMobile ? 23 : "var(--radius-md)", padding: isMobile ? "0 16px" : "0 14px", fontSize: isMobile ? 16 : 14, fontFamily: "inherit", outline: "none", boxSizing: "border-box", background: conv.broadcast ? "var(--secondary)" : "#F1F5F9" }} />
              </div>
              {isMobile ? <button type="button" onClick={send} title="Send" aria-label="Send" disabled={conv.broadcast} style={{ width: 46, height: 46, flex: "none", borderRadius: 99, border: "none", background: draft.trim() || pending.length ? "var(--primary)" : "#93C5FD", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}><Icon name="send" size={20} color="#fff" /></button> : <Button icon="send" title="Send" onClick={send}>Send</Button>}
            </React.Fragment>
          )}
        </div>
        </React.Fragment>) : (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "var(--muted-foreground)", gap: 8 }}>
            <Icon name="message-square" size={30} color="var(--muted-foreground)" />
            <div style={{ fontSize: 14, fontWeight: 600 }}>No conversation selected</div>
            <div style={{ fontSize: 12.5 }}>Tap the pencil to message anyone in the directory.</div>
          </div>
        )}
      </div>
      )}
      {viewing && <AttachmentViewer at={viewing} onClose={() => setViewing(null)} actions={a} isMobile={isMobile} />}
    </div>
  );
}

// Composer template picker: search + insert; "Manage" flips to a small
// add/edit/delete view. Org-wide templates are editable only by directors /
// ER directors / developers (server-enforced; the UI mirrors `canEdit`).
function TemplatePicker({ templates, onPick, onClose, canManageOrg, actions, isMobile }) {
  const [q, setQ] = React.useState("");
  const [manage, setManage] = React.useState(false);
  const [editing, setEditing] = React.useState(null); // null | "new" | template id
  const [form, setForm] = React.useState({ title: "", body: "", priority: "routine", scope: "mine" });
  const PR = { routine: ["Routine", "var(--muted-foreground)"], urgent: ["Urgent", "#B45309"], stat: ["STAT", "#B91C1C"] };
  const shown = (templates || []).filter((t) => !q || (t.title + " " + t.body).toLowerCase().includes(q.toLowerCase()));
  const startNew = () => { setForm({ title: "", body: "", priority: "routine", scope: "mine" }); setEditing("new"); };
  const startEdit = (t) => { setForm({ title: t.title, body: t.body, priority: t.priority || "routine", scope: t.scope }); setEditing(t.id); };
  const save = () => {
    if (!form.title.trim() || !form.body.trim()) { if (actions.toast) actions.toast({ tone: "rejected", title: "Title and text required", msg: "" }); return; }
    const p = editing === "new"
      ? actions.createTemplate({ title: form.title.trim(), body: form.body.trim(), priority: form.priority, scope: form.scope })
      : actions.updateTemplate(editing, { title: form.title.trim(), body: form.body.trim(), priority: form.priority });
    Promise.resolve(p).then(() => setEditing(null));
  };
  const remove = (t) => { if (window.confirm('Delete template "' + t.title + '"?')) actions.deleteTemplate(t.id); };
  const pill = (pr) => <span style={{ fontSize: 9.5, fontWeight: 800, padding: "1px 6px", borderRadius: 4, color: PR[pr] ? PR[pr][1] : "var(--muted-foreground)", border: "1px solid " + (PR[pr] ? PR[pr][1] : "var(--border)") + "66", flex: "none" }}>{PR[pr] ? PR[pr][0] : pr}</span>;
  return (
    <div data-template-picker style={{ flex: "none", margin: isMobile ? "0 8px" : "0 16px", marginBottom: 6, background: "#fff", border: "1px solid var(--border)", borderRadius: 12, boxShadow: "var(--shadow-lg)", display: "flex", flexDirection: "column", maxHeight: 320, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderBottom: "1px solid var(--border)" }}>
        <Icon name="file-text" size={14} color="var(--primary)" />
        <span style={{ fontSize: 13, fontWeight: 700, flex: 1 }}>{manage ? "Manage templates" : "Templates"}</span>
        {!manage && <Button size="sm" variant="ghost" icon="settings-2" onClick={() => setManage(true)}>Manage</Button>}
        {manage && <Button size="sm" variant="ghost" icon="arrow-left" onClick={() => { setManage(false); setEditing(null); }}>Back</Button>}
        <Button size="sm" variant="ghost" icon="x" onClick={onClose} />
      </div>
      {!manage && (
        <React.Fragment>
          <div style={{ padding: "8px 10px 4px" }}><Field icon="search" placeholder="Search templates…" value={q} onChange={setQ} /></div>
          <div style={{ overflowY: "auto", padding: "4px 6px 8px", display: "flex", flexDirection: "column", gap: 2 }}>
            {shown.length === 0 && <div style={{ padding: 14, textAlign: "center", fontSize: 12.5, color: "var(--muted-foreground)" }}>{(templates || []).length ? "No template matches." : "No templates yet — add one under Manage."}</div>}
            {shown.map((t) => (
              <button key={t.id} data-template-item onClick={() => onPick(t)}
                onMouseEnter={(e) => e.currentTarget.style.background = "var(--secondary)"} onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left", padding: "7px 8px", borderRadius: 8, border: "none", background: "transparent", cursor: "pointer", fontFamily: "inherit" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>{t.title}{t.scope === "org" && <span style={{ fontSize: 9.5, fontWeight: 700, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: ".04em" }}>org</span>}</div>
                  <div style={{ fontSize: 11.5, color: "var(--muted-foreground)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.body}</div>
                </div>
                {pill(t.priority || "routine")}
              </button>
            ))}
          </div>
        </React.Fragment>
      )}
      {manage && editing == null && (
        <div style={{ overflowY: "auto", padding: "6px 8px 8px", display: "flex", flexDirection: "column", gap: 2 }}>
          <Button size="sm" variant="outline" icon="plus" onClick={startNew}>New template</Button>
          {(templates || []).map((t) => (
            <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 4px", borderBottom: "1px solid var(--border)" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600 }}>{t.title} <span style={{ fontSize: 10, color: "var(--muted-foreground)", fontWeight: 600 }}>· {t.scope === "org" ? "organization" : "mine"}</span></div>
                <div style={{ fontSize: 11.5, color: "var(--muted-foreground)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.body}</div>
              </div>
              {pill(t.priority || "routine")}
              {t.canEdit && <Button size="sm" variant="ghost" icon="pencil" onClick={() => startEdit(t)} />}
              {t.canEdit && <Button size="sm" variant="ghost" icon="trash-2" onClick={() => remove(t)} />}
            </div>
          ))}
        </div>
      )}
      {manage && editing != null && (
        <div style={{ overflowY: "auto", padding: "8px 10px 10px", display: "flex", flexDirection: "column", gap: 8 }}>
          <Field label="Title" value={form.title} onChange={(v) => setForm({ ...form, title: v })} placeholder="Short name shown in the picker" />
          <Field label="Message" textarea rows={2} value={form.body} onChange={(v) => setForm({ ...form, body: v })} placeholder="Use {room} as a placeholder. No PHI." />
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: 11.5, color: "var(--muted-foreground)" }}>Priority</span>
            {Object.keys(PR).map((id) => (
              <button key={id} onClick={() => setForm({ ...form, priority: id })}
                style={{ padding: "3px 10px", borderRadius: 99, cursor: "pointer", fontSize: 11.5, fontWeight: 700, fontFamily: "inherit", color: form.priority === id ? "#fff" : PR[id][1], background: form.priority === id ? PR[id][1] : "transparent", border: "1px solid " + (form.priority === id ? PR[id][1] : "var(--border)") }}>{PR[id][0]}</button>
            ))}
            {editing === "new" && canManageOrg && (
              <label style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, fontWeight: 600, cursor: "pointer" }}>
                <input type="checkbox" checked={form.scope === "org"} onChange={(e) => setForm({ ...form, scope: e.target.checked ? "org" : "mine" })} />Organization-wide
              </label>
            )}
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Button size="sm" variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button size="sm" icon="check" onClick={save}>{editing === "new" ? "Add template" : "Save"}</Button>
          </div>
        </div>
      )}
    </div>
  );
}

// Away message field for the Do-not-disturb modal (AppShell): what senders see
// on the availability line while you're DND / off shift. Saves on blur/Enter
// via the "awayMessage" user preference.
function DndAwayMessageField() {
  const st = useStore();
  const a = useActions();
  const saved = (st.myPrefs && st.myPrefs.awayMessage) || "";
  const [val, setVal] = React.useState(saved);
  React.useEffect(() => { setVal(saved); }, [saved]);
  const commit = () => { if (val.trim() !== saved.trim() && a.setAwayMessage) a.setAwayMessage(val); };
  return (
    <div data-away-message onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") commit(); }}>
      <Field label="Away message (optional)" icon="message-circle" value={val} onChange={setVal} placeholder="e.g. In clinic until 3pm — page my cover for anything urgent" help="Shown to anyone who messages you while you're unavailable." />
    </div>
  );
}

Object.assign(window, { Messaging, TemplatePicker, DndAwayMessageField });
