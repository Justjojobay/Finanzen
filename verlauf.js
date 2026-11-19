/* Kursverlauf für das Depot und einzelne Positionen (Version 2) */
"use strict";
(function () {
  const URL_KEY = "finanzKursUrl";
  const BEREICHE = [["1mo", "1M"], ["3mo", "3M"], ["6mo", "6M"], ["1y", "1J"], ["5y", "5J"], ["max", "Max"]];
  const NAMEN = {"1mo": "1 Monat", "3mo": "3 Monate", "6mo": "6 Monate", "1y": "1 Jahr", "5y": "5 Jahre", "max": "Gesamt"};
  const MONATE = {"1mo": 1, "3mo": 3, "6mo": 6, "1y": 12, "5y": 60, "max": null};
  const TTL = 60 * 60000;          // erfolgreiche Verläufe eine Stunde merken
  const NEU_VERSUCH = 5 * 60000;   // fehlgeschlagene nach 5 Minuten erneut versuchen
  const PAKET = 8;                 // höchstens 8 Ticker pro Abruf (Cloudflare-Limit)
  const VC = {}, ZEIT = {}, FEHLZEIT = {}, offen = new Set(), charts = {};
  let offenKey = null, chartNr = 0;
  UI.vBereich = UI.vBereich || "1y";

  document.head.insertAdjacentHTML("beforeend", `<style>
    .spread[data-action]{cursor:pointer}.vc{touch-action:pan-y}.vc-info{min-height:1.3em;margin:6px 0 4px}</style>`);

  const kursUrl = () => (localStorage.getItem(URL_KEY) || "").trim();
  const sch = (b, t) => b + "|" + t;

  // Ersatz ohne Worker: selbst gespeicherte Kurse
  function gespeichert(t, bereich) {
    const mon = MONATE[bereich], ab = mon ? addMonate(heute(), -mon) : "";
    return (S.kurse[t] || []).filter(k => k.datum >= ab).map(k => [k.datum, k.kurs]);
  }

  function hole(ticker, bereich) {
    const lokal = () => ({reihen: Object.fromEntries(ticker.map(t => [t, gespeichert(t, bereich)])),
      laedt: false, quelle: "gespeichert", ersatz: new Set()});
    if (!kursUrl() || !navigator.onLine) return lokal();
    if (ZEIT[bereich] && Date.now() - ZEIT[bereich] > TTL) { VC[bereich] = {}; ZEIT[bereich] = 0; }
    const vc = VC[bereich] = VC[bereich] || {}, jetzt = Date.now();
    const fehlt = ticker.filter(t => !t.startsWith("DEMO") && !offen.has(sch(bereich, t)) &&
      (!(t in vc) || (vc[t] === null && jetzt - (FEHLZEIT[sch(bereich, t)] || 0) > NEU_VERSUCH)));
    if (fehlt.length) lade(fehlt, bereich);
    const reihen = {}, ersatz = new Set();
    for (const t of ticker) {
      if (vc[t]) reihen[t] = vc[t];
      else { reihen[t] = gespeichert(t, bereich); if (!t.startsWith("DEMO")) ersatz.add(t); }
    }
    return {reihen, laedt: ticker.some(t => offen.has(sch(bereich, t))), quelle: "live", ersatz};
  }

  // In kleinen Paketen nacheinander laden
  async function lade(ticker, bereich) {
    ticker.forEach(t => offen.add(sch(bereich, t)));
    let fehler = false;
    for (let i = 0; i < ticker.length; i += PAKET) {
      const teil = ticker.slice(i, i + PAKET);
      const vc = VC[bereich] = VC[bereich] || {};
      try {
        const url = kursUrl().replace(/\/+$/, "") + "/?h=" + encodeURIComponent(teil.join(",")) + "&r=" + bereich;
        const r = await fetch(url, {cache: "no-store"});
        const d = await r.json().catch(() => ({}));
        if (!r.ok || !d.verlauf) throw new Error(d.fehler || "Fehler " + r.status);
        for (const t of teil) {
          const v = d.verlauf[t];
          vc[t] = v && v.length >= 2 ? v : null;
          if (!vc[t]) FEHLZEIT[sch(bereich, t)] = Date.now();
        }
        ZEIT[bereich] = ZEIT[bereich] || Date.now();
      } catch (e) {
        fehler = true;
        for (const t of teil) { vc[t] = null; FEHLZEIT[sch(bereich, t)] = Date.now(); }
      }
      teil.forEach(t => offen.delete(sch(bereich, t)));
      aktualisiere();
    }
    if (fehler) toast("Ein Teil der Kursverläufe konnte nicht geladen werden");
  }

  function aktualisiere() {
    render();
    if (offenKey && document.getElementById("vSheet")) zeigeSheet(offenKey);
  }

  // Gesamtwert pro Tag (heutige Stückzahlen × damaliger Kurs); Positionen ohne Verlauf werden weggelassen
  function depotReihe(pos, reihen, ersatz) {
    const gueltig = pos.filter(p => !ersatz.has(p.ticker) && (reihen[p.ticker] || []).length >= 2);
    const fehlend = pos.filter(p => !gueltig.includes(p));
    if (!gueltig.length) return {punkte: [], fehlend, begrenzt: [], start: null};
    const anfaenge = gueltig.map(p => reihen[p.ticker][0][0]).sort();
    const start = anfaenge[anfaenge.length - 1];
    const begrenzt = tageBis(anfaenge[0], start) > 7 ? gueltig.filter(p => reihen[p.ticker][0][0] === start) : [];
    const daten = [...new Set(gueltig.flatMap(p => reihen[p.ticker].map(x => x[0])))].filter(d => d >= start).sort();
    const idx = new Map(gueltig.map(p => [p, 0]));
    const punkte = daten.map(d => {
      let wert = 0;
      for (const p of gueltig) {
        const r = reihen[p.ticker];
        let i = idx.get(p);
        while (i + 1 < r.length && r[i + 1][0] <= d) i++;
        idx.set(p, i);
        wert += p.menge * r[i][1];
      }
      return {datum: d, kurs: wert};
    });
    return {punkte, fehlend, begrenzt, start};
  }

  // Liniendiagramm im Stil der Aktien-App
  function vChart(punkte, ref, refLabel) {
    if (punkte.length < 2) return `<div class="leer">Noch zu wenige Kursdaten für ein Diagramm.</div>`;
    const id = "vc" + (++chartNr), W = 320, H = 180, l = 4, r = 4, o = 12, u = H - 20, n = punkte.length;
    const werte = punkte.map(p => p.kurs).concat(ref != null && ref > 0 ? [ref] : []);
    let max = Math.max(...werte), min = Math.min(...werte);
    const puf = (max - min) * 0.08 || max * 0.05 || 1; max += puf; min -= puf;
    const X = i => l + i / (n - 1) * (W - l - r), Y = v => o + (max - v) / (max - min) * (u - o);
    const farbe = punkte[n - 1].kurs >= punkte[0].kurs ? "#34C759" : "#FF3B30";
    const pts = punkte.map((p, i) => `${X(i).toFixed(1)},${Y(p.kurs).toFixed(1)}`).join(" ");
    let s = `<defs><linearGradient id="${id}g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${farbe}" stop-opacity=".28"/>
      <stop offset="1" stop-color="${farbe}" stop-opacity="0"/></linearGradient></defs>
      <polygon points="${X(0).toFixed(1)},${u} ${pts} ${X(n - 1).toFixed(1)},${u}" fill="url(#${id}g)"/>
      <polyline points="${pts}" fill="none" stroke="${farbe}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    if (ref != null && ref > 0) {
      s += `<line x1="${l}" x2="${W - r}" y1="${Y(ref).toFixed(1)}" y2="${Y(ref).toFixed(1)}" stroke="#8E8E93" stroke-width="1" stroke-dasharray="4 4"/>
        <text x="${W - r}" y="${(Y(ref) - 4).toFixed(1)}" text-anchor="end" font-size="9">${esc(refLabel)} ${esc(eur(ref))}</text>`;
    }
    s += `<text x="${l}" y="${H - 4}" font-size="10">${datumDE(punkte[0].datum)}</text>
      <text x="${W - r}" y="${H - 4}" font-size="10" text-anchor="end">${datumDE(punkte[n - 1].datum)}</text>
      <line class="vc-cursor" x1="0" x2="0" y1="${o}" y2="${u}" stroke="#8E8E93" stroke-width="1" visibility="hidden"/>
      <circle class="vc-punkt" r="4" fill="${farbe}" stroke="#fff" stroke-width="2" visibility="hidden"/>`;
    charts[id] = {punkte, X, Y};
    return `<div class="vc-info s muted" id="${id}i">Zum Ablesen mit dem Finger über das Diagramm streichen</div>
      <svg viewBox="0 0 ${W} ${H}" class="chart vc" data-vc="${id}">${s}</svg>`;
  }

  function scrub(e) {
    const svg = e.target && e.target.closest && e.target.closest("svg.vc");
    const c = svg && charts[svg.dataset.vc];
    if (!c) return;
    const rect = svg.getBoundingClientRect(), n = c.punkte.length;
    const x = (e.clientX - rect.left) / rect.width * 320;
    const i = Math.max(0, Math.min(n - 1, Math.round((x - 4) / 312 * (n - 1))));
    const p = c.punkte[i], cx = c.X(i).toFixed(1), cy = c.Y(p.kurs).toFixed(1);
    const cur = svg.querySelector(".vc-cursor"), dot = svg.querySelector(".vc-punkt");
    cur.setAttribute("x1", cx); cur.setAttribute("x2", cx); cur.setAttribute("visibility", "visible");
    dot.setAttribute("cx", cx); dot.setAttribute("cy", cy); dot.setAttribute("visibility", "visible");
    const info = document.getElementById(svg.dataset.vc + "i");
    if (info) info.innerHTML = `<b style="color:var(--text)">${eur(p.kurs)}</b> · ${datumDE(p.datum)} · ` +
      `${proz((p.kurs / c.punkte[0].kurs - 1) * 100)} seit Beginn`;
  }
  document.addEventListener("pointerdown", scrub);
  document.addEventListener("pointermove", scrub);

  const bereichsKnoepfe = () => `<div class="seg" style="margin-bottom:10px">${BEREICHE.map(([k, l]) =>
    `<button data-action="vBereich" data-r="${k}" class="${UI.vBereich === k ? "aktiv" : ""}">${l}</button>`).join("")}</div>`;

  function kopfwerte(punkte) {
    const a = punkte[0].kurs, z = punkte[punkte.length - 1].kurs, d = z - a;
    return `<div style="font-size:1.8rem;font-weight:600;letter-spacing:-.03em">${eur(z)}</div>
      <div class="s ${d >= 0 ? "pos" : "neg"}" style="font-weight:600">${d >= 0 ? "+" : ""}${eur(d)} (${proz(a ? d / a * 100 : null)})
      <span class="muted" style="font-weight:400">· ${NAMEN[UI.vBereich]}</span></div>`;
  }
  const namenListe = l => l.map(p => `${esc(p.name)} (${esc(p.ticker)})`).join(", ");

  // Karte mit dem Verlauf mehrerer Positionen
  function verlaufKarte(pos, titel) {
    const {reihen, laedt, quelle, ersatz} = hole([...new Set(pos.map(p => p.ticker))], UI.vBereich);
    const {punkte, fehlend, begrenzt, start} = depotReihe(pos, reihen, ersatz);
    const einstand = summe(pos.filter(p => !fehlend.includes(p)), p => p.einstand);
    let h = `<div class="card"><h3>📈 ${esc(titel)}</h3>${bereichsKnoepfe()}`;
    if (punkte.length >= 2) h += kopfwerte(punkte) + vChart(punkte, einstand, "Einstand");
    else h += `<div class="leer">${laedt ? "Kursverlauf wird geladen …" : "Noch keine Kursdaten für diesen Zeitraum."}</div>`;
    if (laedt) h += `<p class="s muted">Kursverläufe werden geladen …</p>`;
    if (!laedt && fehlend.length) h += `<div class="hinweis">Nicht enthalten, weil kein Kursverlauf gefunden wurde:
      <b>${namenListe(fehlend)}</b>. Bitte den Ticker prüfen (Yahoo-Format, z. B. SAP.DE). Der Wert oben ist deshalb
      kleiner als dein Depotwert.</div>`;
    if (begrenzt.length) h += `<p class="s muted">Der Verlauf beginnt erst am ${datumDE(start)}, weil für
      ${namenListe(begrenzt)} erst ab dann Kursdaten vorliegen.</p>`;
    if (quelle === "gespeichert") h += `<p class="s muted">Zeigt nur deine gespeicherten Kurse. Für den vollständigen Verlauf
      unter ⚙️ die Worker-Adresse eintragen.</p>`;
    h += `<p class="s muted">Wert deiner heutigen Bestände im Zeitverlauf, ohne spätere Käufe, Verkäufe und Dividenden.
      Tippe auf eine Position, um ihren eigenen Verlauf zu sehen.</p>`;
    return h + `</div>`;
  }

  // Fenster für eine einzelne Position
  function zeigeSheet(key) {
    const p = depotPositionen().find(x => x.key === key);
    if (!p) return;
    offenKey = key;
    const {reihen, laedt, quelle, ersatz} = hole([p.ticker], UI.vBereich);
    const punkte = (reihen[p.ticker] || []).map(([datum, kurs]) => ({datum, kurs}));
    let h = `<div id="vSheet">${kopf(esc(p.name))}
      <div class="s muted" style="margin:-8px 0 12px">${esc(p.ticker)} · ${esc(p.typ)} · ${esc(bankName(p.bankId))}</div>${bereichsKnoepfe()}`;
    if (punkte.length >= 2) h += kopfwerte(punkte) + vChart(punkte, p.kaufkurs, "Ø Kaufkurs");
    else h += `<div class="leer">${laedt ? "Kursverlauf wird geladen …" : "Noch keine Kursdaten für diesen Zeitraum."}</div>`;
    if (!laedt && ersatz.has(p.ticker)) h += `<div class="hinweis">Der Kursdienst liefert für <b>${esc(p.ticker)}</b> keinen Verlauf.
      Prüfe, ob der Ticker im Yahoo-Format ist. Suche dazu auf finance.yahoo.com nach dem Namen oder der ISIN.
      ${punkte.length >= 2 ? "Angezeigt werden nur deine gespeicherten Kurse." : ""}</div>`;
    if (quelle === "gespeichert") h += `<p class="s muted">Zeigt nur deine gespeicherten Kurse.</p>`;
    h += `<div class="grid2" style="margin-top:12px">${kpi("Stück", fmtZahl(p.menge))}${kpi("Ø Kaufkurs", eur(p.kaufkurs))}
      ${kpi("Aktueller Wert", eur(p.wert))}${kpi("Gewinn / Verlust", p.gv != null ? eur(p.gv) : "–",
        p.gv != null && p.einstand ? proz(p.gv / p.einstand * 100) : "", p.gv >= 0 ? "pos" : "neg")}</div>
      <div class="btnrow"><button class="btn klein" data-action="kurs" data-ticker="${esc(p.ticker)}">Kurs eintragen</button>
      ${link(yahooUrl(p.ticker), "Yahoo ↗")}${link(newsUrl(`"${p.name}" ${newsZusatz(p.typ)}`), "📰 News ↗")}</div>
      ${kursListe(p.ticker)}</div>`;
    oeffneSheet(h);
  }

  /* ----- In die bestehende App einhängen ----- */
  const altSchliessen = schliesseSheet;
  schliesseSheet = function () { offenKey = null; altSchliessen(); };

  const altDepot = depotBereich;
  depotBereich = function (b) {
    const pos = depotPositionen().filter(p => p.bankId === b.id);
    let i = 0;
    const h = altDepot(b)
      .replace(/<div class="unter">Kursverlauf<\/div>[\s\S]*?(?=<div class="unter">Positionen<\/div>)/, "")
      .replace(/<li class="col">\s*<div class="spread">/g, () =>
        `<li class="col"><div class="spread" data-action="wpVerlauf" data-key="${esc((pos[i++] || {}).key || "")}">`);
    return pos.length ? verlaufKarte(pos, "Depot-Verlauf") + h : h;
  };

  const altAlle = bankenAlle;
  bankenAlle = function (items, banken, gesamt) {
    const h = altAlle(items, banken, gesamt), pos = depotPositionen();
    if (!pos.length) return h;
    const karte = verlaufKarte(pos, "Gesamtes Depot"), marke = '<div class="card"><h3>🏦 Deine Banken</h3>';
    return h.includes(marke) ? h.replace(marke, () => karte + marke) : h + karte;
  };

  const altPosZeile = posZeile;
  posZeile = x => x.typ === "wp"
    ? altPosZeile(x).replace("<li ", `<li data-action="wpVerlauf" data-key="${esc(x.id)}" `) : altPosZeile(x);

  AKTIONEN.wpVerlauf = el => zeigeSheet(el.dataset.key);
  AKTIONEN.vBereich = el => { UI.vBereich = el.dataset.r; aktualisiere(); };
  const altDelKurs = AKTIONEN.delKurs;
  AKTIONEN.delKurs = el => { altDelKurs(el); if (offenKey && document.getElementById("vSheet")) zeigeSheet(offenKey); };

  render();
})();
