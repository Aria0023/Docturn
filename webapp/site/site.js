/* DocTurn public website behaviour. Kept in its own file so the page can be
   served with a policy that refuses any script written into the page itself. */
(function () {
  "use strict";
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var yr = $("[data-year]"); if (yr) yr.textContent = "© " + new Date().getFullYear();

  // The demo is by invitation. Someone who followed a link into the app
  // without one (or with one that has ended) lands here and is told so.
  var demo = (/[?&]demo=(invite|expired)/.exec(window.location.search) || [])[1];
  if (demo) {
    var note = document.createElement("div");
    note.setAttribute("role", "status");
    note.setAttribute("data-demo-notice", demo);
    note.style.cssText = "position:sticky;top:0;z-index:50;padding:12px 18px;text-align:center;font:600 14px/1.45 'Instrument Sans',system-ui,sans-serif;background:#0B7A72;color:#fff";
    note.textContent = demo === "expired"
      ? "That demo link has ended or is no longer valid. Ask us for a new one using the form below."
      : "The DocTurn demo is by invitation. Request access using the form below and we will send you a link.";
    document.body.insertBefore(note, document.body.firstChild);
    try { window.history.replaceState(null, "", window.location.pathname + window.location.hash); } catch (e) {}
  }

  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* Bedside-monitor sweep: the trace is written left to right with an erase gap ahead of the pen. */
  (function monitor() {
    var cv = $("[data-monitor]"); if (!cv || !cv.getContext) return;
    var ctx = cv.getContext("2d"), dpr = Math.min(window.devicePixelRatio || 1, 2), W = 0, H = 0, x = 0, prevY = null, color = "#0A6F6A", visible = true;
    function readColor() { color = getComputedStyle(document.documentElement).getPropertyValue("--signal").trim() || color; }
    function size() { var r = cv.getBoundingClientRect(); W = Math.max(1, Math.round(r.width)); H = Math.max(1, Math.round(r.height)); cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); x = 0; prevY = null; if (reduce) still(); }
    var PERIOD = 230; // px per beat
    function wave(px) {
      var t = (px % PERIOD) / PERIOD, y = 0;
      var g = function (c, w, a) { return a * Math.exp(-Math.pow((t - c) / w, 2)); };
      y += g(.18, .035, .10);              // P
      y -= g(.30, .008, .16);              // Q
      y += g(.32, .010, 1.0);              // R
      y -= g(.345, .010, .32);             // S
      y += g(.55, .06, .22);               // T
      return H * .62 - y * H * .5;
    }
    function still() { ctx.clearRect(0, 0, W, H); ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.beginPath(); for (var i = 0; i <= W; i += 2) { var y = wave(i); i ? ctx.lineTo(i, y) : ctx.moveTo(i, y); } ctx.stroke(); }
    function step() {
      if (!visible) return requestAnimationFrame(step);
      var speed = Math.max(2.2, W / 520);
      for (var k = 0; k < speed; k += 1) {
        ctx.clearRect(x + 1, 0, 26, H);
        var y = wave(x);
        if (prevY !== null) { ctx.strokeStyle = color; ctx.lineWidth = 2.2; ctx.lineCap = "round"; ctx.beginPath(); ctx.moveTo(x - 1, prevY); ctx.lineTo(x, y); ctx.stroke(); }
        prevY = y; x += 1;
        if (x > W) { x = 0; prevY = null; }
      }
      requestAnimationFrame(step);
    }
    readColor(); size();
    window.addEventListener("resize", size);
    try { window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", function () { readColor(); if (reduce) still(); }); } catch (e) {}
    if ("IntersectionObserver" in window) new IntersectionObserver(function (es) { visible = es[0].isIntersecting; }).observe(cv);
    if (!reduce) requestAnimationFrame(step);
  })();

  /* One night on DocTurn: four moments, auto-advancing until the visitor picks one. */
  (function night() {
    var tabs = $("[data-tabs]"); if (!tabs) return;
    var M = [
      { t: "7:02 PM", clock: "7:02", day: "Wednesday evening", n: "Sign-out", sky: "dusk", h: "Hand-off without the phone tag.",
        p: "The day team's open items reach the night team in one place, so nothing lives only in someone's head.",
        a: [{ w: "now", b: "Hand-off notes from the day team are ready." }] },
      { t: "11:40 PM", clock: "11:40", day: "Wednesday night", n: "Admission", sky: "late", h: "Admits land fairly.",
        p: "New admissions reach the right hospitalist quickly and evenly. No one is buried, and no patient waits.",
        a: [{ w: "now", b: "Admission request waiting for you." }, { w: "4h", b: "Hand-off notes from the day team are ready." }] },
      { t: "3:12 AM", clock: "3:12", day: "Thursday", n: "STAT", sky: "night", h: "Urgent means urgent.",
        p: "When something can't wait, DocTurn makes sure the right physician sees it, and doesn't stop until someone does.",
        a: [{ w: "now", b: "New message. Open DocTurn to read.", stat: true }, { w: "3h", b: "Admission request waiting for you." }] },
      { t: "6:55 AM", clock: "6:55", day: "Thursday morning", n: "Morning", sky: "dawn", h: "The whole service, at a glance.",
        p: "Directors start the day knowing workload, coverage and what's still open, and can rebalance with a click.",
        a: [{ w: "now", b: "Your consult request was answered." }, { w: "3h", b: "STAT message acknowledged." }] },
    ];
    var DWELL = 6000, cur = -1, timer = null, auto = !reduce;
    var dev = $("[data-device]"), panel = $("[data-panel]");
    tabs.innerHTML = M.map(function (m, i) {
      return '<button class="tab" role="tab" type="button" id="night-tab-' + i + '" data-i="' + i + '" aria-selected="false"><span class="t">' + m.t + '</span><span class="n">' + m.n + '</span><span class="bar"></span></button>';
    }).join("");
    var btns = tabs.querySelectorAll(".tab");
    tabs.style.setProperty("--dwell", DWELL / 1000 + "s");
    function show(i, fromUser) {
      if (i === cur) return;
      cur = i; var m = M[i];
      btns.forEach(function (b, j) { b.setAttribute("aria-selected", j === i ? "true" : "false"); b.tabIndex = j === i ? 0 : -1; b.classList.remove("playing"); });
      if (auto) { void btns[i].offsetWidth; btns[i].classList.add("playing"); }
      panel.setAttribute("aria-labelledby", "night-tab-" + i);
      panel.classList.remove("swap"); void panel.offsetWidth; panel.classList.add("swap");
      $("[data-panel-title]").textContent = m.h; $("[data-panel-text]").textContent = m.p;
      dev.setAttribute("data-sky", m.sky);
      $("[data-clock]").textContent = m.clock; $("[data-date]").textContent = m.day;
      $("[data-alerts]").innerHTML = m.a.map(function (a, k) {
        return '<div class="alert' + (k === 0 ? " new" : "") + '"><div class="app"><svg><use href="#i-mark"/></svg></div><div><div class="top"><span>DocTurn</span><span>' + a.w + '</span></div>' +
          (a.stat ? '<div class="stat">STAT</div>' : "") + a.b + "</div></div>";
      }).join("");
      clearTimeout(timer);
      if (auto) timer = setTimeout(function () { show((cur + 1) % M.length); }, DWELL);
    }
    tabs.addEventListener("click", function (e) {
      var b = e.target.closest(".tab"); if (!b) return;
      auto = false; clearTimeout(timer); btns.forEach(function (x) { x.classList.remove("playing"); });
      cur = -1; show(Number(b.getAttribute("data-i")), true);
    });
    tabs.addEventListener("keydown", function (e) {
      var d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0; if (!d) return;
      e.preventDefault(); auto = false; clearTimeout(timer); var n = (cur + d + M.length) % M.length; cur = -1; show(n, true); btns[n].focus();
    });
    // Start on the STAT moment so the still page tells the strongest story; play only while on screen.
    show(2);
    if (auto && "IntersectionObserver" in window) {
      clearTimeout(timer); btns[2].classList.remove("playing");
      var started = false;
      new IntersectionObserver(function (es) {
        if (es[0].isIntersecting && auto && !started) { started = true; cur = -1; show(0); }
      }, { threshold: .35 }).observe($("#night"));
    }
  })();

  var CHECK = '<svg><use href="#i-check"/></svg>';
  var INCLUDED = ["HIPAA-compliant messaging and STAT alerts", "Admissions and consults", "Live service oversight", "Single sign-on and audit trail", "Signed BAA, onboarding and support"];
  var plans = [];
  var money = function (cents, cur) {
    try { return new Intl.NumberFormat(undefined, { style: "currency", currency: cur, minimumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100); }
    catch (e) { return (cents / 100).toFixed(2) + " " + cur; }
  };
  var esc = function (s) { return String(s).replace(/[&<>"']/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]; }); };
  var list = function (items) { return "<ul>" + items.map(function (t) { return "<li>" + CHECK + "<span>" + esc(t) + "</span></li>"; }).join("") + "</ul>"; };

  function renderPlans() {
    var box = $("[data-plans]");
    var cards = [];
    cards.push('<div class="plan" data-site-plan="pilot"><h3>Pilot</h3><div class="price" style="font-size:34px">Evaluation</div><div class="per">One service, for a fixed term</div>' +
      list(["Full product for one service", "Start on test data", "Onboarding and check-ins", "Signed BAA before real data"]) +
      '<a class="btn line" href="#buy" data-choose="pilot">Start a pilot</a></div>');
    if (plans.length) {
      plans.forEach(function (p, i) {
        cards.push('<div class="plan' + (i === 0 ? " lead" : "") + '" data-site-plan="' + esc(p.code) + '"><h3>' + esc(p.name) +
          '</h3><div class="price">' + esc(money(p.perSeatPriceCents, p.currency)) + '<small> / clinician / month</small></div><div class="per">Billed monthly for active accounts</div>' +
          list(INCLUDED) + '<a class="btn ' + (i === 0 ? "solid" : "line") + '" href="#buy" data-choose="' + esc(p.code) + '">Purchase ' + esc(p.name) + "</a></div>");
      });
    } else {
      cards.push('<div class="plan lead" data-site-plan="quote"><h3>Hospital</h3><div class="price" style="font-size:34px">Custom quote</div><div class="per">Per clinician, sized to your group</div>' +
        list(INCLUDED) + '<a class="btn solid" href="#buy" data-choose="">Request pricing</a></div>');
    }
    box.innerHTML = cards.join("");
    var sel = $("[data-plan-select]");
    sel.innerHTML = '<option value="pilot">Pilot</option>' + (plans.length
      ? plans.map(function (p) { return '<option value="' + esc(p.code) + '">' + esc(p.name) + ", " + esc(money(p.perSeatPriceCents, p.currency)) + "/mo</option>"; }).join("")
      : '<option value="">Hospital (quote)</option>');
    sel.value = plans.length ? plans[0].code : "";
    $("select[name=term]").value = plans.length ? "annual" : "pilot";
    box.querySelectorAll("[data-choose]").forEach(function (a) {
      a.addEventListener("click", function () {
        var c = a.getAttribute("data-choose");
        sel.value = c;
        var term = $("select[name=term]"); term.value = c === "pilot" ? "pilot" : (term.value === "pilot" ? "annual" : term.value);
        estimate();
      });
    });
    estimate();
  }

  function estimate() {
    var sel = $("[data-plan-select]"), seats = Number($("input[name=seats]").value) || 0, box = $("[data-estimate]");
    var p = plans.filter(function (x) { return x.code === sel.value; })[0];
    if (!p || seats < 1) { box.hidden = true; return; }
    box.hidden = false;
    $("[data-estimate-label]").textContent = "Estimated for " + seats + " clinician" + (seats === 1 ? "" : "s");
    $("[data-estimate-value]").textContent = money(p.perSeatPriceCents * seats, p.currency) + " / month";
  }

  fetch("/api/public/plans", { credentials: "omit" }).then(function (r) { return r.ok ? r.json() : { plans: [] }; })
    .then(function (j) { plans = (j && j.plans) || []; }, function () { plans = []; })
    .then(renderPlans);

  var form = $("[data-buy-form]");
  form.addEventListener("input", function (e) { if (e.target.name === "seats") estimate(); e.target.removeAttribute("aria-invalid"); });
  form.addEventListener("change", function (e) { if (e.target.name === "planCode") estimate(); });

  var LABELS = { organizationName: "hospital or group", contactName: "your name", email: "work email", phone: "phone", seats: "clinician accounts", agreeTerms: "the terms box", term: "term", contactTitle: "title", message: "message" };
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var err = $("[data-buy-error]"), btn = $("[data-buy-submit]");
    err.hidden = true;
    var f = form.elements;
    var body = {
      organizationName: f.organizationName.value.trim(), contactName: f.contactName.value.trim(), contactTitle: f.contactTitle.value.trim(),
      email: f.email.value.trim(), phone: f.phone.value.trim(), seats: Math.floor(Number(f.seats.value)), planCode: f.planCode.value,
      term: f.term.value, message: f.message.value.trim(), agreeTerms: f.agreeTerms.checked, website: f.website.value,
    };
    var bad = [];
    if (body.organizationName.length < 2) bad.push("organizationName");
    if (body.contactName.length < 2) bad.push("contactName");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) bad.push("email");
    if (!(body.seats >= 1 && body.seats <= 100000)) bad.push("seats");
    if (!body.agreeTerms) bad.push("agreeTerms");
    if (bad.length) return showBad(bad);
    btn.disabled = true; btn.textContent = "Sending…";
    fetch("/api/public/purchase-request", { method: "POST", credentials: "omit", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { s: r.status, j: j }; }); })
      .then(function (res) {
        if (res.s === 201) {
          form.innerHTML = '<div class="done" data-buy-done><div class="ok"><svg viewBox="0 0 24 24" width="26" height="26"><use href="#i-check"/></svg></div><h3>Request received</h3><p>' +
            (res.j.reference ? "Your reference is <code>" + esc(res.j.reference) + "</code>. " : "") +
            "We'll email " + esc(body.email) + " with an order form and the BAA. Nothing is charged until both are signed.</p></div>";
          return;
        }
        btn.disabled = false; btn.textContent = "Send order request";
        if (res.s === 400 && res.j.fields) return showBad(res.j.fields);
        err.textContent = res.s === 429 ? "Too many requests from this network. Try again in an hour." : "Your request didn't send. Try again.";
        err.hidden = false;
      }, function () {
        btn.disabled = false; btn.textContent = "Send order request";
        err.textContent = "No connection. Check your network and try again."; err.hidden = false;
      });
  });
  function showBad(fields) {
    var err = $("[data-buy-error]");
    fields.forEach(function (n) { var el = form.elements[n]; if (el && el.setAttribute) el.setAttribute("aria-invalid", "true"); });
    err.textContent = "Check " + fields.map(function (n) { return LABELS[n] || n; }).join(", ") + ".";
    err.hidden = false;
    var first = form.elements[fields[0]]; if (first && first.focus) first.focus();
  }
})();
