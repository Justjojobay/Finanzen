/* Automatische Aktienkurse über deinen Cloudflare Worker */
"use strict";
(function () {
  const URL_KEY = "finanzKursUrl", ZEIT_KEY = "finanzKursZeit";
  const SPERRE_MIN = 15;   // höchstens alle 15 Minuten automatisch laden
  let laeuft = false;

  const kursUrl = () => (localStorage.getItem(URL_KEY) || "").trim();
  const letzteZeit = () => +localStorage.getItem(ZEIT_KEY) || 0;
  const tickerListe = () => [...new Set(S.depot.map(p => p.ticker).filter(t => t && !t.startsWith("DEMO")))];

  function zuletztText() {
    const z = letzteZeit();
    if (!z) return "noch nie";
    const d = new Date(z), tag = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    return (tag === heute() ? "heute" : datumDE(tag)) + ` um ${pad(d.getHours())}:${pad(d.getMinutes())} Uhr`;
  }

  async function ladeKurse({erzwingen = false, laut = false} = {}) {
    const basis = kursUrl(), ticker = tickerListe();
    if (!basis) { if (laut) toast("Bitte zuerst unter ⚙️ die Worker-Adresse eintragen"); return; }
    if (!ticker.length) { if (laut) toast("Keine Wertpapiere mit Ticker vorhanden"); return; }
    if (laeuft) return;
    if (!erzwingen && Date.now() - letzteZeit() < SPERRE_MIN * 60000) return;
    if (!navigator.onLine) { if (laut) toast("Keine Internetverbindung"); return; }
    laeuft = true; render();
    try {
      const url = basis.replace(/\/+$/, "") + "/?t=" + encodeURIComponent(ticker.join(","));
      const r = await fetch(url, {cache: "no-store"});
      const daten = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(daten.fehler || "Fehler " + r.status);
      const tag = heute();
      let n = 0;
      for (const [t, k] of Object.entries(daten.kurse || {})) {
        if (k && isFinite(k.eur) && k.eur > 0) { setzeKurs(t, tag, Math.round(k.eur * 10000) / 10000); n++; }
      }
      localStorage.setItem(ZEIT_KEY, String(Date.now()));
      speichern();
      const fehlt = Object.keys(daten.fehlend || {});
      toast(`${n} Kurs(e) aktualisiert` + (fehlt.length ? ` · nicht gefunden: ${fehlt.join(", ")}` : ""));
    } catch (e) {
      if (laut) alert("Kurse konnten nicht geladen werden: " + e.message +
        "\n\nBitte die Worker-Adresse unter ⚙️ und ERLAUBT im Worker prüfen.");
      else toast("Kurse konnten gerade nicht geladen werden");
    } finally { laeuft = false; render(); }
  }

  // Statuszeile mit Aktualisieren-Button im Reiter Banken
  function statusKarte() {
    if (!S.depot.length) return "";
    const url = kursUrl();
    const text = !url ? "Kurse automatisch laden? Richte dafür deinen Kurs-Dienst ein."
      : laeuft ? "Kurse werden geladen …" : `Kurse aktualisiert: ${zuletztText()}`;
    const knopf = url
      ? `<button class="btn klein sek" data-action="kurseLaden" ${laeuft ? "disabled" : ""}>🔄 Aktualisieren</button>`
      : `<button class="btn klein sek" data-action="einstellungen">⚙️ Einrichten</button>`;
    return `<div class="card"><div class="spread"><div class="s muted">📡 ${text}</div>${knopf}</div></div>`;
  }
  const altRender = render;
  render = function () {
    altRender();
    if (UI.tab !== "banken") return;
    const app = document.getElementById("app"), chips = app.querySelector(".chips");
    if (chips) chips.insertAdjacentHTML("afterend", statusKarte());
    else app.insertAdjacentHTML("afterbegin", statusKarte());
  };

  // Eingabefeld für die Worker-Adresse in den Einstellungen
  const altEinst = AKTIONEN.einstellungen;
  AKTIONEN.einstellungen = () => {
    altEinst();
    document.getElementById("sheetInhalt").insertAdjacentHTML("beforeend", `<hr class="trenner">
      <form data-form="kursquelle"><h3>📡 Automatische Kurse</h3>
      <p class="s muted">Adresse deines Cloudflare Workers, z. B. https://kurse.deinname.workers.dev.
      Sie wird nur auf diesem Gerät gespeichert und nicht ins Backup übernommen. Leer lassen = ausschalten.</p>
      <label class="f">Worker-Adresse<input name="url" type="url" value="${esc(kursUrl())}"
        placeholder="https://kurse.….workers.dev" autocapitalize="off" autocorrect="off"></label>
      <button class="btn voll" type="submit">Speichern & Kurse laden</button></form>`);
  };
  SPEICHERN.kursquelle = d => {
    const u = (d.url || "").trim();
    if (u && !/^https:\/\//i.test(u)) throw new Error("Die Adresse muss mit https:// beginnen.");
    if (u) localStorage.setItem(URL_KEY, u); else localStorage.removeItem(URL_KEY);
    schliesseSheet(); render();
    if (u) ladeKurse({erzwingen: true, laut: true}); else toast("Automatische Kurse ausgeschaltet");
  };
  AKTIONEN.kurseLaden = () => ladeKurse({erzwingen: true, laut: true});

  // Neue Aktie gespeichert: gleich ihren Kurs holen
  const altPosition = SPEICHERN.position;
  SPEICHERN.position = (d, id) => { altPosition(d, id); if (kursUrl()) ladeKurse({erzwingen: true}); };

  // Automatisch beim Öffnen und beim Zurückkehren in die App
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") ladeKurse(); });
  window.addEventListener("online", () => ladeKurse());
  render();
  ladeKurse();
})();
