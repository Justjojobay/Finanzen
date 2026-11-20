/* Edelmetalle (Gold, Silber, Platin, Palladium) mit aktuellem Wert */
"use strict";
(function () {
  const URL_KEY = "finanzKursUrl", ZEIT_KEY = "finanzMetallZeit", SPERRE = 15 * 60000;
  const UNZE = 31.1034768;                       // 1 Feinunze in Gramm
  const METALLE = {Gold: "GC=F", Silber: "SI=F", Platin: "PL=F", Palladium: "PA=F"};
  const EINHEIT = {oz: UNZE, g: 1, kg: 1000};
  const FORMEN = ["Münze", "Barren", "Sonstiges"];
  let laeuft = false;
  for (const m of Object.keys(METALLE)) if (!ANLAGEARTEN.includes(m)) ANLAGEARTEN.push(m);

  const liste = () => (S.edelmetalle = Array.isArray(S.edelmetalle) ? S.edelmetalle : []);
  const kursUrl = () => (localStorage.getItem(URL_KEY) || "").trim();
  const preis = metall => letzterKurs(METALLE[metall]);          // {datum, kurs} in € je Feinunze
  const feinGramm = e => e.anzahl * e.gewicht * (EINHEIT[e.einheit] || 1) *
    (e.gewichtsart === "roh" ? e.feingehalt / 1000 : 1);
  const rund = (x, n) => Math.round(x * 10 ** n) / 10 ** n;

  function bewertung(e) {
    const g = feinGramm(e), oz = g / UNZE, p = preis(e.metall);
    const wert = p ? oz * p.kurs * (1 - (+e.abschlag || 0) / 100) : null;
    return {g, oz, p, wert, gv: wert != null && e.kaufpreis > 0 ? wert - e.kaufpreis : null};
  }
  function farben() {
    let g = false;
    for (const e of liste()) if (e.fnr == null) { e.fnr = S.einst.farbZaehler++; g = true; }
    return g;
  }

  /* ----- Ins Gesamtvermögen und die Diagramme einrechnen ----- */
  const altVerm = vermoegen;
  vermoegen = function () {
    const items = altVerm();
    for (const e of liste()) {
      const b = bewertung(e);
      items.push({typ: "metall", id: e.id, bankId: bid(e.bankId), name: e.name, art: e.metall,
        wert: b.wert != null ? b.wert : (+e.kaufpreis || 0), ohneKurs: b.wert == null, fnr: e.fnr});
    }
    return items;
  };
  const altPos = posZeile;
  posZeile = x => x.typ === "metall"
    ? altPos(x).replace("<li ", `<li data-action="editMetall" data-id="${x.id}" `) : altPos(x);

  /* ----- Preise laden ----- */
  async function ladePreise({erzwingen = false, laut = false} = {}) {
    const metalle = [...new Set(liste().map(e => e.metall))];
    if (!metalle.length || laeuft) return;
    if (!kursUrl()) { if (laut) toast("Bitte zuerst unter Einstellungen die Worker-Adresse eintragen"); return; }
    if (!erzwingen && Date.now() - (+localStorage.getItem(ZEIT_KEY) || 0) < SPERRE) return;
    if (!navigator.onLine) { if (laut) toast("Keine Internetverbindung"); return; }
    laeuft = true;
    try {
      const ticker = metalle.map(m => METALLE[m]);
      const r = await fetch(kursUrl().replace(/\/+$/, "") + "/?t=" + encodeURIComponent(ticker.join(",")), {cache: "no-store"});
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.fehler || "Fehler " + r.status);
      let n = 0;
      for (const m of metalle) {
        const t = METALLE[m], k = d.kurse && d.kurse[t];
        if (!k || !(k.eur > 0)) continue;
        const neu = rund(k.eur, 2), alt = letzterKurs(t);
        if (alt && Math.abs(neu / alt.kurs - 1) > 0.25 &&
            !(laut && confirm(`Ungewöhnliche Preisänderung bei ${m}: ${eur(alt.kurs)} → ${eur(neu)} je Unze. Übernehmen?`))) continue;
        setzeKurs(t, heute(), neu);
        n++;
      }
      localStorage.setItem(ZEIT_KEY, String(Date.now()));
      if (n) speichern();
      if (laut) toast(n ? "Edelmetallpreise aktualisiert" : "Keine Edelmetallpreise erhalten");
    } catch (e) {
      if (laut) alert("Edelmetallpreise konnten nicht geladen werden: " + e.message);
    } finally { laeuft = false; render(); }
  }

  /* ----- Anzeige ----- */
  function preisZeilen(metalle) {
    return metalle.map(m => {
      const p = preis(m);
      return `<li><span>${m}</span><span>${p ? `${eur(p.kurs)} / oz · ${eur(p.kurs / UNZE)} / g` : "noch kein Preis"}</span></li>`;
    }).join("");
  }
  function preisStand(metalle) {
    const d = metalle.map(preis).filter(Boolean).map(p => p.datum).sort();
    return (d.length ? `Preisstand: ${datumDE(d[0])}. ` : "") +
      "Wert = Feingewicht × Börsenpreis je Feinunze in Euro, abzüglich deines Abschlags.";
  }
  function karte(l, bankId) {
    const metalle = [...new Set(l.map(e => e.metall))];
    const bw = l.map(e => ({e, b: bewertung(e)}));
    const mitKauf = bw.filter(x => x.b.gv != null), gv = summe(mitKauf, x => x.b.gv);
    let h = `<div class="card"><h3>Edelmetalle</h3>`;
    if (l.length) {
      h += `<div class="grid2">${kpi("Aktueller Wert", eur(summe(bw, x => x.b.wert)))}
        ${kpi("Gewinn / Verlust", mitKauf.length ? eur(gv) : "–", mitKauf.length ? "nur Einträge mit Kaufpreis" : "", gv >= 0 ? "pos" : "neg")}</div>
        <div class="unter">Aktuelle Preise</div><ul class="liste">${preisZeilen(metalle)}</ul>
        <div class="unter">Bestand</div><ul class="liste">${bw.map(({e, b}) => `<li data-action="editMetall" data-id="${e.id}">
          <div class="reihe"><span class="ld" style="background:${farbeNr(e.fnr)}"></span><div>
          <div class="t">${esc(e.name)}</div>
          <div class="s">${fmtZahl(e.anzahl)} × ${fmtZahl(e.gewicht)} ${e.einheit}${e.gewichtsart === "roh" ? ` roh (${fmtZahl(e.feingehalt)} ‰)` : ""}
          · ${fmtZahl(rund(b.oz, 3))} oz Fein${e.metall.toLowerCase()} (${fmtZahl(rund(b.g, 2))} g)</div>
          ${bankId === null ? `<div class="s">${esc(bankName(bid(e.bankId)))}</div>` : ""}</div></div>
          <div class="right"><div class="t">${b.wert != null ? eur(b.wert) : "–"}</div>
          ${b.gv != null ? `<div class="s ${b.gv >= 0 ? "pos" : "neg"}">${eur(b.gv)}</div>` : ""}</div></li>`).join("")}</ul>
        <p class="s muted">${preisStand(metalle)}</p>`;
    } else {
      h += `<div class="leer">Noch keine Edelmetalle eingetragen.</div>`;
    }
    return h + `<div class="btnrow"><button class="btn klein" data-action="neuMetall" data-id="${bankId || ""}">Edelmetall hinzufügen</button>
      ${l.length ? `<button class="btn klein sek" data-action="metallLaden" ${laeuft ? "disabled" : ""}>Preise aktualisieren</button>
      <button class="btn klein sek" data-action="metallPreis">Preis von Hand</button>` : ""}</div></div>`;
  }

  /* ----- Formulare ----- */
  function formMetall(id, bankId) {
    const e = liste().find(x => x.id === id) || {metall: "Gold", form: "Münze", name: "", anzahl: 1, gewicht: 1,
      einheit: "oz", gewichtsart: "fein", feingehalt: 999.9, kaufpreis: "", datum: heute(), abschlag: "", bankId};
    const opt = (l, w) => l.map(([k, t]) => `<option value="${k}" ${k === w ? "selected" : ""}>${t}</option>`).join("");
    oeffneSheet(`<form data-form="metall" data-id="${id || ""}">${kopf(id ? "Edelmetall bearbeiten" : "Edelmetall hinzufügen")}
      <div class="zeile">${auswahl("Metall", "metall", Object.keys(METALLE), e.metall)}${auswahl("Form", "form", FORMEN, e.form)}</div>
      ${feld("Bezeichnung (z. B. Krügerrand 1 oz)", "name", e.name, "text", "required")}
      ${bankAuswahl(bid(e.bankId), false)}
      <div class="zeile">${betragFeld("Anzahl (Stück)", "anzahl", e.anzahl)}${betragFeld("Gewicht je Stück", "gewicht", e.gewicht)}</div>
      <div class="zeile"><label class="f">Einheit<select name="einheit">${opt([["oz", "Feinunze (31,1 g)"], ["g", "Gramm"], ["kg", "Kilogramm"]], e.einheit)}</select></label>
      <label class="f">Gewicht ist<select name="gewichtsart">${opt([["fein", "Feingewicht"], ["roh", "Rohgewicht"]], e.gewichtsart)}</select></label></div>
      <div id="feinWrap" style="${e.gewichtsart === "roh" ? "" : "display:none"}">${betragFeld("Feingehalt in ‰ (z. B. 916,7 beim Krügerrand)", "feingehalt", e.feingehalt)}</div>
      <div class="zeile">${betragFeld("Kaufpreis gesamt in € (optional)", "kaufpreis", e.kaufpreis)}${feld("Kaufdatum (optional)", "datum", e.datum || "", "date")}</div>
      ${betragFeld("Abschlag auf den Börsenpreis in % (optional)", "abschlag", e.abschlag)}
      <p class="s muted">Steht auf der Münze „1 oz Feingold“, wähle Feingewicht, 1, Feinunze. Bei Rohgewicht gib zusätzlich den
      Feingehalt an. Der Abschlag bildet ab, dass Händler etwas unter dem Börsenpreis ankaufen. Für Gold zu Hause lege unter Banken
      z. B. „Tresor“ an und wähle es oben aus.</p>${fuss(id, "delMetall")}</form>`);
  }
  function formPreis() {
    const metalle = [...new Set(liste().map(e => e.metall))];
    oeffneSheet(`<form data-form="metallPreis">${kopf("Preis von Hand eintragen")}
      ${auswahl("Metall", "metall", metalle.length ? metalle : Object.keys(METALLE), metalle[0] || "Gold")}
      <div class="zeile">${feld("Datum", "datum", heute(), "date", "required")}${betragFeld("Preis je Feinunze (€)", "preis", "")}</div>
      <p class="s muted">Gilt, bis wieder ein Preis automatisch geladen wird.</p>
      <button class="btn voll" type="submit">Speichern</button></form>`);
  }

  SPEICHERN.metall = (d, id) => {
    const name = d.name.trim();
    if (!name) throw new Error("Bitte eine Bezeichnung eingeben.");
    if (!d.bankId) throw new Error("Bitte wählen, wo das Edelmetall liegt. Für Gold zu Hause lege unter Banken z. B. „Tresor“ an.");
    const anzahl = pruefeBetrag(d.anzahl, "Anzahl"), gewicht = pruefeBetrag(d.gewicht, "Gewicht je Stück");
    const roh = d.gewichtsart === "roh", fg = roh ? zahl(d.feingehalt) : 1000;
    if (roh && !(fg > 0 && fg <= 1000)) throw new Error("Der Feingehalt muss zwischen 1 und 1000 ‰ liegen.");
    const kp = (d.kaufpreis || "").trim() ? zahl(d.kaufpreis) : 0;
    if (isNaN(kp) || kp < 0) throw new Error("Bitte einen gültigen Kaufpreis eingeben.");
    const ab = (d.abschlag || "").trim() ? zahl(d.abschlag) : 0;
    if (isNaN(ab) || ab < 0 || ab >= 100) throw new Error("Der Abschlag muss zwischen 0 und 99 % liegen.");
    const e = {metall: d.metall, form: d.form, name, bankId: d.bankId, anzahl, gewicht, einheit: d.einheit,
      gewichtsart: roh ? "roh" : "fein", feingehalt: roh ? fg : 1000, kaufpreis: kp, datum: d.datum || "", abschlag: ab};
    const oz = feinGramm(e) / UNZE;
    if (oz > 1000 && !confirm(`Das sind ${fmtZahl(rund(oz, 1))} oz Fein${d.metall.toLowerCase()}. Stimmen Gewicht und Einheit?`)) return;
    upsert(liste(), id, e);
    farben();
    fertig(`${fmtZahl(rund(oz, 3))} oz Fein${d.metall.toLowerCase()} gespeichert`);
    ladePreise({erzwingen: !preis(d.metall)});
  };
  SPEICHERN.metallPreis = d => {
    setzeKurs(METALLE[d.metall], d.datum || heute(), pruefeBetrag(d.preis, "Preis"));
    fertig("Preis gespeichert");
  };

  /* ----- Aktionen und Einhängen ----- */
  AKTIONEN.neuMetall = el => {
    if (!S.banken.length) { alert("Lege zuerst unter Banken einen Ort an, z. B. deine Bank oder „Tresor“."); formBank(); return; }
    formMetall(null, el.dataset.id || "");
  };
  AKTIONEN.editMetall = el => formMetall(el.dataset.id);
  AKTIONEN.delMetall = el => {
    if (!confirm("Diesen Edelmetall-Eintrag löschen?")) return;
    S.edelmetalle = liste().filter(x => x.id !== el.dataset.id);
    fertig("Edelmetall gelöscht");
  };
  AKTIONEN.metallLaden = () => ladePreise({erzwingen: true, laut: true});
  AKTIONEN.metallPreis = () => formPreis();

  document.addEventListener("change", ev => {
    const t = ev.target;
    if (t.name === "gewichtsart" && t.form) {
      const w = t.form.querySelector("#feinWrap");
      if (w) w.style.display = t.value === "roh" ? "" : "none";
    }
  });

  const altDetail = bankDetail;
  bankDetail = (b, g) => {
    const h = altDetail(b, g), l = liste().filter(e => bid(e.bankId) === b.id);
    return l.length ? h + karte(l, b.id) : h;
  };
  const altAlle = bankenAlle;
  bankenAlle = (items, banken, gesamt) => altAlle(items, banken, gesamt) + karte(liste(), null);

  const altAktionen = formAktionen;
  formAktionen = bankId => {
    altAktionen(bankId);
    const box = document.querySelector("#sheetInhalt > div[style*='grid']");
    if (box) box.insertAdjacentHTML("beforeend",
      `<button class="btn sek voll" data-action="neuMetall" data-id="${bankId}">Edelmetall (Gold, Silber …)</button>`);
  };

  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") ladePreise(); });
  if (farben()) speichern();
  render();
  ladePreise();
})();
