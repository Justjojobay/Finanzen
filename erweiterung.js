/* Design-Feinschliff, Einklappen und Sparpläne */
"use strict";
(function () {
  const URL_KEY = "finanzKursUrl", KLAPP_KEY = "finanzOffen";

  /* ===== 1. Schlichte Linien-Symbole statt Emojis ===== */
  const svg = i => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${i}</svg>`;
  const ICON = {
    uebersicht: svg('<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>'),
    cockpit: svg('<path d="M5 20v-8M10.5 20V5M16 20v-5M21 20H3"/>'),
    banken: svg('<path d="M3 9.5 12 4l9 5.5M5 10.5v7.5M9.7 10.5v7.5M14.3 10.5v7.5M19 10.5v7.5M3 20.5h18"/>'),
    abos: svg('<rect x="5" y="3" width="14" height="18" rx="2.5"/><path d="M9 8h6M9 12h6M9 16h3.5"/>'),
    einst: svg('<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>'),
    auto: svg('<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor" stroke="none"/>'),
    hell: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>'),
    dunkel: svg('<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>'),
  };

  document.head.insertAdjacentHTML("beforeend", `<style>
    [data-action]{cursor:pointer}
    .icon-btn{display:flex;align-items:center;justify-content:center;padding:0}
    .icon-btn svg{width:20px;height:20px}
    .tabbar button{font-size:0}.tabbar button svg{width:25px;height:25px}
    .card.klappbar>h3{display:flex;justify-content:space-between;align-items:center;margin:0;user-select:none;-webkit-user-select:none}
    .card.klappbar>h3::after{content:"";width:8px;height:8px;border-right:2px solid var(--muted);border-bottom:2px solid var(--muted);
      transform:rotate(45deg);transition:transform .2s;margin:-5px 4px 0 12px;flex-shrink:0}
    .card.klappbar.offen>h3::after{transform:rotate(-135deg);margin-top:5px}
    .card.klappbar>.klapp{display:none;margin-top:12px}
    .card.klappbar.offen>.klapp{display:block}
    .pfeil{color:var(--muted);font-size:1.4rem;line-height:1;padding-left:4px}</style>`);

  document.querySelectorAll(".tabbar button").forEach(b => {
    const s = b.querySelector("span");
    b.innerHTML = (ICON[b.dataset.tab] || "") + (s ? s.outerHTML : "");
  });
  const einstBtn = document.querySelector('.icon-btn[data-action="einstellungen"]');
  if (einstBtn) einstBtn.innerHTML = ICON.einst;

  wendeThemeAn = function () {
    const t = THEMES.includes(S.einst.theme) ? S.einst.theme : "auto";
    if (t === "auto") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", t);
    $("#themeBtn").innerHTML = ICON[t];
  };
  wendeThemeAn();

  // Emojis aus allen Texten entfernen (Pfeil ↗ und Schließen-Kreuz ✕ bleiben)
  const EMOJI = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{FE0F}\u{200D}\u{20E3}]/gu;
  const BEHALTEN = new Set(["↗", "✕"]);
  function aufraeumen(root) {
    if (!root) return;
    root.querySelectorAll("button").forEach(b => { if (b.textContent.trim() === "🗑") b.textContent = "Löschen"; });
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), knoten = [];
    while (w.nextNode()) knoten.push(w.currentNode);
    for (const n of knoten) {
      const alt = n.nodeValue;
      let neu = alt.replace(EMOJI, c => BEHALTEN.has(c) ? c : "");
      if (neu === alt) continue;
      if (!n.previousSibling) neu = neu.replace(/^\s+/, "");
      n.nodeValue = neu.replace(/ {2,}/g, " ");
    }
  }
  let imGange = false;
  new MutationObserver(() => {
    if (imGange) return;
    imGange = true; aufraeumen($("#sheetInhalt")); imGange = false;
  }).observe($("#sheetInhalt"), {childList: true, subtree: true});

  /* ===== 2. Aktionen erst in der Detailansicht ===== */
  function aktionenAusblenden(app) {
    app.querySelectorAll("li.col .btnrow").forEach(r => { if (r.querySelector('[data-action="kurs"]')) r.remove(); });
    app.querySelectorAll('.spread[data-action="wpVerlauf"], li[data-action="wpVerlauf"]').forEach(el => {
      if (!el.querySelector(".pfeil")) el.insertAdjacentHTML("beforeend", '<span class="pfeil">›</span>');
    });
  }

  /* ===== 3. Karten ein- und ausklappen ===== */
  let OFFEN;
  try { OFFEN = new Set(JSON.parse(localStorage.getItem(KLAPP_KEY) || "[]")); } catch (e) { OFFEN = new Set(); }
  function klappen(app) {
    [...app.children].filter(c => c.classList.contains("card")).forEach(card => {
      const h3 = card.querySelector(":scope > h3");
      if (!h3 || card.classList.contains("klappbar")) return;
      const titel = h3.textContent.trim();
      if (UI.tab === "banken" && UI.bank === "alle" && titel === "Verteilung") return;   // immer offen
      const k = UI.tab + ":" + titel, box = document.createElement("div");
      box.className = "klapp";
      [...card.childNodes].forEach(n => { if (n !== h3) box.appendChild(n); });
      card.appendChild(box);
      card.classList.add("klappbar");
      if (OFFEN.has(k)) card.classList.add("offen");
      card.dataset.k = k;
      h3.dataset.action = "klapp";
    });
  }
  AKTIONEN.klapp = el => {
    const card = el.closest(".card"), k = card.dataset.k;
    if (card.classList.toggle("offen")) OFFEN.add(k); else OFFEN.delete(k);
    localStorage.setItem(KLAPP_KEY, JSON.stringify([...OFFEN]));
  };

  /* ===== 5. Sparpläne: Konto → Aktie/ETF ===== */
  const plaene = () => (S.sparplaene = Array.isArray(S.sparplaene) ? S.sparplaene : []);
  const kursUrl = () => (localStorage.getItem(URL_KEY) || "").trim();

  function faellig(p, bis) {
    const schritt = INTERVALLE[p.intervall], out = [];
    if (!schritt || !p.start) return out;
    const grenze = p.ende && p.ende < bis ? p.ende : bis;
    for (let k = 0; k < 1200; k++) {
      const d = addMonate(p.start, k * schritt);
      if (d > grenze) break;
      if (!p.gebuchtBis || d > p.gebuchtBis) out.push(d);
    }
    return out;
  }
  function naechste(p) {
    const schritt = INTERVALLE[p.intervall];
    for (let k = 0; k < 1200; k++) {
      const d = addMonate(p.start, k * schritt);
      if (p.ende && d > p.ende) return null;
      if (!p.gebuchtBis || d > p.gebuchtBis) return d;
    }
    return null;
  }

  async function abruf(q) {
    const r = await fetch(kursUrl().replace(/\/+$/, "") + "/?" + q, {cache: "no-store"});
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.fehler || "Fehler " + r.status);
    return d;
  }
  // Liefert eine Funktion: Datum -> Kurs in € (heute: aktueller Kurs, früher: Schlusskurs)
  async function preisFinder(ticker, frueheste) {
    const h = heute();
    let aktuell = null, reihe = null;
    if (kursUrl() && navigator.onLine) {
      try { const d = await abruf("t=" + encodeURIComponent(ticker)); const k = d.kurse && d.kurse[ticker]; if (k && k.eur > 0) aktuell = k.eur; } catch (e) {}
      if (frueheste < h) {
        try {
          const d = await abruf("h=" + encodeURIComponent(ticker) + "&r=" + (tageBis(frueheste, h) > 350 ? "5y" : "1y"));
          reihe = (d.verlauf && d.verlauf[ticker]) || null;
        } catch (e) {}
      }
    }
    const lokal = [...(S.kurse[ticker] || [])].sort((a, b) => a.datum.localeCompare(b.datum));
    return datum => {
      if (datum === h) return aktuell || (lokal.find(k => k.datum === h) || {}).kurs || null;
      let best = null;
      if (reihe) for (const [d, v] of reihe) { if (d.slice(0, 10) <= datum) best = v; else break; }
      if (best) return best;
      for (const k of lokal) { if (k.datum <= datum) best = k.kurs; else break; }
      return best;
    };
  }

  let laeuft = false;
  async function ausfuehren({laut = false} = {}) {
    if (laeuft) return;
    laeuft = true;
    let n = 0;
    const warten = [];
    try {
      for (const p of plaene()) {
        if (!S.konten.some(k => k.id === p.kontoId)) continue;
        const daten = faellig(p, heute());
        if (!daten.length) continue;
        const preis = await preisFinder(p.ticker, daten[0]);
        for (const d of daten) {
          const kurs = preis(d);
          if (!(kurs > 0)) { warten.push(p.name); break; }
          const k4 = Math.round(kurs * 10000) / 10000;
          S.depot.push({id: uid(), name: p.name, ticker: p.ticker, typ: p.typ, bankId: p.bankId,
            menge: Math.round(p.betrag / kurs * 1e6) / 1e6, kaufkurs: k4, datum: d, sparplan: p.id});
          S.buchungen.push({id: uid(), datum: d, typ: "Sparen", kategorie: "Sonstiges", betrag: +p.betrag,
            notiz: "Sparplan " + p.name, serie: "Sparplan " + p.name, kontoId: p.kontoId, zielKontoId: ""});
          setzeKurs(p.ticker, d, k4);
          p.gebuchtBis = d;
          n++;
        }
      }
    } finally { laeuft = false; }
    if (n) { sichereFarben(); speichern(); render(); toast(`${n} Sparplan-Ausführung(en) gebucht`); }
    if (warten.length && laut) toast("Noch kein Kurs für: " + [...new Set(warten)].join(", ") + ". Wird später nachgeholt.");
  }

  function formSparplan(id, bankId) {
    const p = plaene().find(x => x.id === id) || {name: "", ticker: "", typ: "ETF", kontoId: ersteKonto(bankId), bankId,
      betrag: "", intervall: "monatlich", start: addMonate(heute().slice(0, 8) + "01", 1), ende: ""};
    const pos = depotPositionen();
    oeffneSheet(`<form data-form="sparplan" data-id="${id || ""}">${kopf(id ? "Sparplan bearbeiten" : "Neuer Sparplan")}
      ${!id && pos.length ? `<label class="f">Vorhandene Position übernehmen (optional)<select name="vorlage">
        <option value="">– neu eingeben –</option>${pos.map(x =>
          `<option value="${esc(x.key)}">${esc(x.name)} · ${esc(bankName(x.bankId))}</option>`).join("")}</select></label>` : ""}
      ${feld("Name (z. B. MSCI World ETF)", "name", p.name, "text", "required")}
      <div class="zeile">${feld("Ticker (z. B. EUNL.DE)", "ticker", p.ticker, "text", 'required autocapitalize="characters" autocorrect="off"')}
      ${auswahl("Art", "typ", WP_TYPEN, p.typ)}</div>
      ${kontoAuswahl("Abbuchung von Konto", "kontoId", p.kontoId || "")}
      ${bankAuswahl(p.bankId, false)}
      <div class="zeile">${betragFeld("Sparrate (€)", "betrag", p.betrag)}${auswahl("Intervall", "intervall", Object.keys(INTERVALLE), p.intervall)}</div>
      <div class="zeile">${feld("Erste Ausführung", "start", p.start, "date", "required")}${feld("Letzte (optional)", "ende", p.ende || "", "date")}</div>
      <p class="s muted">Am Ausführungstag wird die Sparrate vom Konto abgebucht und zum aktuellen Kurs in das Depot der
      gewählten Bank gekauft (auch Bruchstücke). Liegt die erste Ausführung in der Vergangenheit, werden die Käufe mit dem
      damaligen Schlusskurs nachgetragen. Gebühren werden nicht berücksichtigt.</p>${fuss(id, "delSparplan")}</form>`);
  }

  SPEICHERN.sparplan = (d, id) => {
    const name = d.name.trim(), ticker = d.ticker.trim().toUpperCase();
    if (!name || !ticker) throw new Error("Bitte Name und Ticker eingeben.");
    if (!d.kontoId) throw new Error("Bitte das Konto wählen, von dem abgebucht wird.");
    if (!d.bankId) throw new Error("Bitte die Bank wählen, in deren Depot gekauft wird.");
    if (!d.start) throw new Error("Bitte die erste Ausführung angeben.");
    if (d.ende && d.ende < d.start) throw new Error("Die letzte Ausführung liegt vor der ersten.");
    upsert(plaene(), id, {name, ticker, typ: d.typ, kontoId: d.kontoId, bankId: d.bankId,
      betrag: pruefeBetrag(d.betrag, "Sparrate"), intervall: d.intervall, start: d.start, ende: d.ende || ""});
    const b = S.banken.find(x => x.id === d.bankId);
    if (b) b.depot = true;
    fertig("Sparplan gespeichert");
    ausfuehren({laut: true});
  };

  function sparplanKarte(b) {
    const kIds = new Set(S.konten.filter(k => k.bankId === b.id).map(k => k.id));
    const l = plaene().filter(p => kIds.has(p.kontoId) || p.bankId === b.id);
    return `<div class="card"><h3>Sparpläne</h3>${l.length ? `<ul class="liste">${l.map(p => {
      const n = naechste(p);
      return `<li><div><div class="t">${esc(p.name)}</div>
        <div class="s">${eur(p.betrag)} ${esc(p.intervall)} · von ${esc(kontoLabel(p.kontoId) || "–")}</div>
        <div class="s">${n ? "Nächste Ausführung: " + datumDE(n) : "Beendet"}${p.gebuchtBis ? " · zuletzt " + datumDE(p.gebuchtBis) : ""}</div></div>
        <button class="btn klein sek" data-action="editSparplan" data-id="${p.id}">Bearbeiten</button></li>`;
    }).join("")}</ul>` : `<div class="leer">Noch kein Sparplan.</div>`}
      <div class="btnrow"><button class="btn klein" data-action="neuSparplan" data-id="${b.id}">Sparplan hinzufügen</button></div></div>`;
  }
  const altDetail = bankDetail;
  bankDetail = (b, g) => b.echt ? altDetail(b, g) + sparplanKarte(b) : altDetail(b, g);

  const altAktionen = formAktionen;
  formAktionen = bankId => {
    altAktionen(bankId);
    const box = document.querySelector("#sheetInhalt > div[style*='grid']");
    if (box) box.insertAdjacentHTML("beforeend",
      `<button class="btn sek voll" data-action="neuSparplan" data-id="${bankId}">Sparplan (Konto → Aktie/ETF)</button>`);
  };

  AKTIONEN.neuSparplan = el => { if (brauchtKonto(el.dataset.id)) return; formSparplan(null, el.dataset.id); };
  AKTIONEN.editSparplan = el => formSparplan(el.dataset.id);
  AKTIONEN.delSparplan = el => {
    if (!confirm("Sparplan löschen? Bereits ausgeführte Käufe und Buchungen bleiben erhalten.")) return;
    S.sparplaene = plaene().filter(x => x.id !== el.dataset.id);
    fertig("Sparplan gelöscht");
  };
  document.addEventListener("change", e => {
    const t = e.target;
    if (t.name !== "vorlage" || !t.form) return;
    const p = depotPositionen().find(x => x.key === t.value);
    if (!p) return;
    const f = t.form.elements;
    f.name.value = p.name; f.ticker.value = p.ticker; f.typ.value = p.typ;
    if (p.bankId) f.bankId.value = p.bankId;
  });

  /* ===== Alles zusammensetzen ===== */
  const altRender = render;
  render = function () {
    altRender();
    const app = $("#app");
    aufraeumen(app);
    aktionenAusblenden(app);
    klappen(app);
  };
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") ausfuehren(); });
  render();
  ausfuehren();
})();
