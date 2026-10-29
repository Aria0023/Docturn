/* DocTurn web-app UI kit — PWA install banner.
   A dismissible banner that lets a tester install DocTurn to their home screen
   in one tap. On Android / desktop Chrome it drives the captured
   beforeinstallprompt event (stashed on window.__dtInstallEvent in index.html);
   on iOS Safari — which has no such event — it shows Add-to-Home-Screen steps.
   Renders nothing once the app is already installed (standalone display mode)
   or the user dismisses it. */

function dtIsStandalone() {
  return (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || window.navigator.standalone === true;
}
function dtIsIOS() {
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent) && !window.MSStream;
}

function InstallPrompt() {
  const [deferred, setDeferred] = React.useState(window.__dtInstallEvent || null);
  const [dismissed, setDismissed] = React.useState(function () {
    try { return localStorage.getItem("dt_install_dismissed") === "1"; } catch (e) { return false; }
  });
  const [installed, setInstalled] = React.useState(dtIsStandalone());
  const [iosHelp, setIosHelp] = React.useState(false);

  React.useEffect(function () {
    function onAvail() { setDeferred(window.__dtInstallEvent || null); }
    function onInstalled() { setInstalled(true); setDeferred(null); window.__dtInstallEvent = null; }
    window.addEventListener("dt-installable", onAvail);
    window.addEventListener("appinstalled", onInstalled);
    return function () {
      window.removeEventListener("dt-installable", onAvail);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const ios = dtIsIOS();
  // Only surface when the app can actually be installed: a captured prompt
  // (Android/desktop) or iOS Safari (manual add). Never when already installed
  // or after the tester dismisses it.
  const canShow = !installed && !dismissed && (deferred || (ios && !dtIsStandalone()));
  if (!canShow) return null;

  function dismiss() {
    setDismissed(true);
    try { localStorage.setItem("dt_install_dismissed", "1"); } catch (e) {}
  }
  function install() {
    if (deferred) {
      deferred.prompt();
      if (deferred.userChoice) deferred.userChoice.then(function () { setDeferred(null); window.__dtInstallEvent = null; });
    } else if (ios) {
      setIosHelp(true);
    }
  }

  return (
    <React.Fragment>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", background: "var(--primary)", color: "#fff" }}>
        <Icon name="smartphone" size={18} color="#fff" />
        <div style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600 }}>Install DocTurn on your device — one tap for a full-screen app.</div>
        <button onClick={install}
          style={{ flex: "none", padding: "7px 14px", borderRadius: "var(--radius-md)", border: "none", background: "#fff", color: "var(--primary)", fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: "var(--font-sans)" }}>Install</button>
        <button onClick={dismiss} title="Dismiss"
          style={{ flex: "none", width: 30, height: 30, borderRadius: "var(--radius-md)", border: "none", background: "transparent", color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Icon name="x" size={16} color="#fff" />
        </button>
      </div>
      {iosHelp && (
        <Modal title="Install DocTurn" subtitle="Add it to your home screen" icon="smartphone" onClose={() => setIosHelp(false)}
          children={
            <div style={{ fontSize: 13.5, lineHeight: 1.7 }}>
              <p style={{ margin: "0 0 10px" }}>On your iPhone or iPad, in <b>Safari</b>:</p>
              <ol style={{ margin: 0, paddingLeft: 18 }}>
                <li>Tap the <b>Share</b> button (the square with an up-arrow) at the bottom of the screen.</li>
                <li>Scroll down and tap <b>Add to Home Screen</b>.</li>
                <li>Tap <b>Add</b> — DocTurn appears on your home screen like a normal app.</li>
              </ol>
            </div>
          } />
      )}
    </React.Fragment>
  );
}

Object.assign(window, { InstallPrompt });
