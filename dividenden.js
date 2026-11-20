/* Dividenden automatisch erfassen und dem Konto gutschreiben */
"use strict";
(function () {
  const URL_KEY = "finanzKursUrl", ZEIT_KEY = "finanzDivZeit";
  const ABSTAND = 6 * 3600000, PAKET = 8;          // höchstens alle 6 Stunden automatisch prüfen
  const FONDS = new Set(["ETF", "Fonds"]);
  let laeuft = false;
  if (!KATEGORIEN.includes("Dividende")) KATEGORIEN.push("Dividende");

  const kursUrl = () => (localStorage.getItem(URL_KEY) || "").trim();
  const erledigt = () => (S.divErledigt = Array.isArray(S.divErledigt) ? S.divErledigt : []);
  const offenL = () => (S.divOffen = Array.isArray(S.divOffen) ? S.divOffen : []);
  const r2 = x => Math.round(x * 100) / 100;
  const prozent = x => (x * 100).toFixed(1).replace(".", ",") + " %";

  function zuletzt() {
    const z = +localStorage.getItem(ZEIT_KEY) || 0;
    if (!z) return "noch nie";
    const d = new Date(z);
    return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}. um ${pad(d.getHours())}:${pad(d.getMinutes())} Uhr`;
  }

  // Konto für Gutschriften: gewähltes Konto, sonst Girokonto, sonst erstes Konto der Bank
  function divKonto(bankId) {
    const ks = S.konten.filter(k => k.bankId === bankId), b = S.banken.find(x => x.id === bankId);
    if (b && b.divKonto && ks.some(k => k.id === b.divKonto)) return b.divKonto;
    const giro = ks.find(k => k.art === "Girokonto");
    return giro ? giro.id : (ks[0] ? ks[0].id : "");
  }

  // Nur Käufe VOR dem Ex-Tag haben Anspruch (Käufe ohne Datum gelten als schon länger im Bestand)
  const stueckAm = (bankId, ticker, datum) => summe(S.depot.filter(e => bid(e.bankId) === bankId &&
    e.ticker === ticker && (!e.datum || e.datum < datum)), e => e.menge);

  // Annahmen: US-Aktien 15 % (mit W-8BEN), Schweizer Aktien 35 %, ETFs/Fonds keine Quellensteuer
  function quellensteuer(x) {
    if (FONDS.has(x.typ)) return 0;
    if (!x.ticker.includes(".")) return 0.15;
    if (x.ticker.endsWith(".SW")) return 0.35;
    return 0;
  }

  // Netto-Schätzung für in Deutschland Steuerpflichtige (ohne Kirchensteuer)
  function steuer(brutto, x, jahr) {
    const basis = brutto * (FONDS.has(x.typ) ? 0.7 : 1);   // Teilfreistellung 30 % für Aktien-ETFs
    if (S.einst.divModus !== "netto") return {netto: brutto, qs: 0, steuer: 0, basis};
    const qs = brutto * quellensteuer(x);
    const genutzt = summe(S.buchungen.filter(b => b.div && b.datum.startsWith(jahr)), b => b.div.basis || 0);
    const frei = Math.max(0, Math.min(basis, (+S.einst.divFrei || 0) - genutzt));
    const pflichtig = basis - frei;
    const kest = Math.max(0, pflichtig * 0.25 - Math.min(qs, pflichtig * 0.15));
    const soli = kest * 0.055;
    return {netto: r2(brutto - qs - kest - soli), qs: r2(qs), steuer: r2(kest + soli), basis};
  }

  function buchen(x) {
    const brutto = r2(x.stk * x.eurProStk), st = steuer(brutto, x, x.datum.slice(0, 4));
    S.buchungen.push({id: uid(), datum: x.datum, typ: "Einnahme", kategorie: "Dividende", betrag: st.netto,
      notiz: `Dividende ${x.name}`, serie: "Dividende", kontoId: divKonto(x.bankId), zielKontoId: "",
      div: {key: x.key, ticker: x.ticker, bankId: x.bankId, name: x.name, typ: x.typ, exTag: x.datum, stk: x.stk,
        proStk: x.proStk, waehrung: x.waehrung, brutto, qs: st.qs, steuer: st.steuer, basis: st.basis, geprueft: false}});
    erledigt().push(x.key);
  }

  async function pruefen({erzwingen = false, laut = false} = {}) {
    const ab = S.einst.divAb, basis = kursUrl();
    if (!ab || laeuft) return;
    if (!basis) { if (laut) toast("Bitte zuerst unter Einstellungen die Worker-Adresse eintragen"); return; }
    if (!erzwingen && Date.now() - (+localStorage.getItem(ZEIT_KEY) || 0) < ABSTAND) return;
    if (!navigator.onLine) { if (laut) toast("Keine Internetverbindung"); return; }
    const pos = depotPositionen().filter(p => p.bankId && !p.ticker.startsWith("DEMO") && p.typ !== "Krypto");
    const ticker = [...new Set(pos.map(p => p.ticker))];
    if (!ticker.length) { if (laut) toast("Keine Wertpapiere bei einer Bank vorhanden"); return; }
    laeuft = true; render();
    const daten = {};
    let fehler = false, n = 0, o = 0;
    try {
      for (let i = 0; i < ticker.length; i += PAKET) {
        const teil = ticker.slice(i, i + PAKET);
        try {
          const r = await fetch(basis.replace(/\/+$/, "") + "/?d=" + encodeURIComponent(teil.join(",")) + "&von=" + ab, {cache: "no-store"});
          const d = await r.json().catch(() => ({}));
          if (!r.ok || !d.dividenden) throw new Error(d.fehler || "Fehler " + r.status);
          Object.assign(daten, d.dividenden);
        } catch (e) { fehler = true; }
      }
      const h = heute(), erl = new Set(erledigt()), wartend = new Set(offenL().map(x => x.key)), neu = [];
      for (const p of pos) for (const dv of (daten[p.ticker] || [])) {
        if (dv.datum < ab || dv.datum > h) continue;
        const key = p.bankId + "|" + p.ticker + "|" + dv.datum;
        if (erl.has(key) || wartend.has(key)) continue;
        const stk = stueckAm(p.bankId, p.ticker, dv.datum);
        if (!(stk > 0)) continue;
        neu.push({key, bankId: p.bankId, ticker: p.ticker, name: p.name, typ: p.typ, datum: dv.datum, stk,
          proStk: dv.betrag, waehrung: dv.waehrung, eurProStk: dv.eur, auffaellig: dv.auffaellig, rendite: dv.rendite});
      }
      neu.sort((a, b) => a.datum.localeCompare(b.datum));   // wichtig für den Pauschbetrag
      for (const x of neu) {
        if (x.auffaellig || !divKonto(x.bankId)) { offenL().push(x); o++; } else { buchen(x); n++; }
      }
      localStorage.setItem(ZEIT_KEY, String(Date.now()));
      if (n || o) speichern();
      if (n || o) toast((n ? `${n} Dividende(n) gutgeschrieben` : "") + (n && o ? " · " : "") + (o ? `${o} bitte bestätigen` : ""));
      else if (laut) toast(fehler ? "Dividenden konnten nicht vollständig geladen werden" : "Keine neuen Dividenden");
    } finally { laeuft = false; render(); }
  }

  /* ----- Anzeige in der Bank ----- */
  function divKarte(b) {
    let h = `<div class="card"><h3>Dividenden</h3>`;
    if (!S.einst.divAb) return h + `<p class="s muted" style="margin-top:0">Dividenden deiner Aktien und ETFs automatisch
      erfassen und dem Konto gutschreiben.</p><button class="btn klein" data-action="einstellungen">Einrichten</button></div>`;
    const jahr = heute().slice(0, 4), konto = divKonto(b.id);
    const l = S.buchungen.filter(x => x.div && x.div.bankId === b.id).sort((x, y) => y.datum.localeCompare(x.datum));
    const offen = offenL().filter(x => x.bankId === b.id);
    h += `<div class="grid2">${kpi("Dividenden " + jahr, eur(summe(l.filter(x => x.datum.startsWith(jahr)), x => x.betrag)),
      S.einst.divModus === "netto" ? "netto" : "brutto", "muted")}${kpi("Zu prüfen", l.filter(x => !x.div.geprueft).length + offen.length)}</div>`;
    h += konto ? `<p class="s muted">Gutschrift auf ${esc(kontoLabel(konto))}. Ändern unter „Bearbeiten“ der Bank.</p>`
      : `<div class="hinweis">Diese Bank hat noch kein Konto. Lege eines an, damit Dividenden gutgeschrieben werden können.</div>`;
    if (offen.length) h += `<div class="unter">Bitte bestätigen</div><ul class="liste">${offen.map(x => `<li class="col">
      <div><div class="t">${esc(x.name)}</div><div class="s">Ex-Tag ${datumDE(x.datum)} · ${fmtZahl(x.stk)} Stk. × ${fmtZahl(x.proStk)}
      ${esc(x.waehrung)} ≈ ${eur(x.stk * x.eurProStk)} brutto</div><div class="s">${!divKonto(x.bankId) ? "Kein Konto für die Gutschrift"
      : x.rendite ? "Ungewöhnlich hoch: " + prozent(x.rendite) + " des Kurses. Bitte mit der Abrechnung vergleichen." : "Kein Kurs zum Vergleich vorhanden"}</div></div>
      <div class="btnrow"><button class="btn klein" data-action="divUebernehmen" data-key="${esc(x.key)}">Übernehmen</button>
      <button class="btn klein sek" data-action="divVerwerfen" data-key="${esc(x.key)}">Verwerfen</button></div></li>`).join("")}</ul>`;
    h += l.length ? `<div class="unter">Gutschriften</div><ul class="liste">${l.slice(0, 12).map(x => `<li>
      <div><div class="t">${esc(x.div.name)}</div><div class="s">${datumDE(x.datum)} · ${fmtZahl(x.div.stk)} Stk. · brutto ${eur(x.div.brutto)}</div></div>
      <div class="right"><div class="t pos">${eur(x.betrag)}</div><button class="btn klein ${x.div.geprueft ? "sek" : ""}"
      style="margin-top:4px" data-action="divPruefen" data-id="${x.id}">${x.div.geprueft ? "Geprüft" : "Prüfen"}</button></div></li>`).join("")}</ul>`
      : `<div class="leer">Noch keine Dividenden seit ${datumDE(S.einst.divAb)}.</div>`;
    return h + `<p class="s muted">${laeuft ? "Dividenden werden geprüft …" : "Zuletzt geprüft: " + zuletzt()}</p>
      <div class="btnrow"><button class="btn klein sek" data-action="divLaden" ${laeuft ? "disabled" : ""}>Jetzt prüfen</button></div></div>`;
  }

  function alleKarte() {
    if (!S.einst.divAb) return "";
    const jahr = heute().slice(0, 4), l = S.buchungen.filter(x => x.div && x.datum.startsWith(jahr));
    const zuPruefen = S.buchungen.filter(x => x.div && !x.div.geprueft).length + offenL().length;
    return `<div class="card"><h3>Dividenden</h3><div class="grid2">${kpi("Dividenden " + jahr, eur(summe(l, x => x.betrag)),
      S.einst.divModus === "netto" ? "netto" : "brutto", "muted")}${kpi("Zu prüfen", zuPruefen)}</div>
      <p class="s muted">Details und Prüfung in der jeweiligen Bank.</p></div>`;
  }

  /* ----- Prüfen mit der Abrechnung ----- */
  function formPruefen(id) {
    const b = S.buchungen.find(x => x.id === id);
    if (!b || !b.div) return;
    const v = b.div, zeile = (a, c) => `<li><span>${a}</span><span>${c}</span></li>`;
    oeffneSheet(`<form data-form="divPruefen" data-id="${id}">${kopf("Dividende prüfen")}
      <p class="s muted" style="margin-top:0">${esc(v.name)} · ${esc(kontoLabel(b.kontoId) || "ohne Konto")}</p>
      <ul class="liste">${zeile("Ex-Tag", datumDE(v.exTag))}${zeile("Stück am Ex-Tag", fmtZahl(v.stk))}
      ${zeile("Dividende je Stück", fmtZahl(v.proStk) + " " + esc(v.waehrung))}${zeile("Brutto in Euro", eur(v.brutto))}
      ${v.qs ? zeile("Quellensteuer (geschätzt)", "− " + eur(v.qs)) : ""}
      ${v.steuer ? zeile("Abgeltungsteuer + Soli (geschätzt)", "− " + eur(v.steuer)) : ""}</ul>
      <p class="s muted">Vergleiche das mit der Dividendenabrechnung deiner Bank und trag den tatsächlich gutgeschriebenen
      Betrag und das Datum der Gutschrift ein.</p>
      <div class="zeile">${betragFeld("Gutschrift laut Abrechnung (€)", "betrag", b.betrag)}${feld("Gutschrift am", "datum", b.datum, "date", "required")}</div>
      <button class="btn voll" type="submit">Als geprüft speichern</button>
      <button type="button" class="btn gefahr voll" style="margin-top:8px" data-action="delBuchung" data-id="${id}">Löschen</button></form>`);
  }
  SPEICHERN.divPruefen = (d, id) => {
    const b = S.buchungen.find(x => x.id === id);
    if (!b) return;
    if (!d.datum) throw new Error("Bitte das Datum der Gutschrift wählen.");
    b.betrag = pruefeBetrag(d.betrag); b.datum = d.datum; b.div.geprueft = true;
    fertig("Dividende als geprüft gespeichert");
  };

  /* ----- Einstellungen ----- */
  const altEinst = AKTIONEN.einstellungen;
  AKTIONEN.einstellungen = () => {
    altEinst();
    const e = S.einst;
    $("#sheetInhalt").insertAdjacentHTML("beforeend", `<hr class="trenner"><form data-form="dividenden"><h3>Dividenden</h3>
      <label class="check"><input type="checkbox" name="aktiv" ${e.divAb ? "checked" : ""}> Dividenden automatisch erfassen</label>
      ${feld("Erfassen ab (Ex-Tag)", "ab", e.divAb || heute(), "date")}
      <label class="f">Gutschrift<select name="modus">
        <option value="brutto" ${e.divModus !== "netto" ? "selected" : ""}>Brutto (vor Steuern)</option>
        <option value="netto" ${e.divModus === "netto" ? "selected" : ""}>Netto, geschätzt (steuerpflichtig in Deutschland)</option></select></label>
      ${feld("Sparer-Pauschbetrag pro Jahr in € (nur Netto)", "frei", String(e.divFrei ?? 1000), "text", 'inputmode="decimal"')}
      <p class="s muted">Netto-Schätzung: 25 % Abgeltungsteuer + Soli, ohne Kirchensteuer. Quellensteuer: 15 % bei US-Aktien,
      35 % bei Schweizer Aktien. Bei ETFs 30 % Teilfreistellung. Der Pauschbetrag wird nur mit Dividenden verrechnet, nicht mit Zinsen
      oder Kursgewinnen. Käufe ohne Kaufdatum gelten als schon vor dem Startdatum gekauft. Eine Änderung gilt nur für neue Gutschriften.</p>
      <button class="btn voll" type="submit">Speichern & Dividenden prüfen</button></form>`);
  };
  SPEICHERN.dividenden = d => {
    const frei = (d.frei || "").trim() ? zahl(d.frei) : 0;
    if (isNaN(frei) || frei < 0) throw new Error("Bitte einen gültigen Pauschbetrag eingeben (0 oder mehr).");
    const ab = d.aktiv === "on" ? d.ab : null;
    if (d.aktiv === "on" && !ab) throw new Error("Bitte ein Startdatum wählen.");
    if (ab && ab < heute()) {
      const ohne = S.depot.filter(e => !e.datum && !e.ticker.startsWith("DEMO")).length;
      if (ohne && !confirm(`${ohne} Kauf/Käufe haben kein Kaufdatum. Sie werden so behandelt, als hättest du sie schon vor dem ` +
        `${datumDE(ab)} besessen. Stimmt das? Sonst trag zuerst die Kaufdaten nach.`)) return;
    }
    S.einst.divAb = ab; S.einst.divModus = d.modus === "netto" ? "netto" : "brutto"; S.einst.divFrei = frei;
    fertig("Dividenden-Einstellungen gespeichert");
    if (ab) pruefen({erzwingen: true, laut: true});
  };

  /* ----- Konto je Bank und Kaufdatum je Kauf ----- */
  const altBank = formBank;
  formBank = id => {
    altBank(id);
    const ks = id ? S.konten.filter(k => k.bankId === id) : [];
    const p = document.querySelector('#sheetInhalt form[data-form="bank"] p.s.muted');
    if (ks.length && p) p.insertAdjacentHTML("beforebegin", `<label class="f">Konto für Dividenden-Gutschriften<select name="divKonto">
      ${ks.map(k => `<option value="${k.id}" ${k.id === divKonto(id) ? "selected" : ""}>${esc(k.name)}</option>`).join("")}</select></label>`);
  };
  const altBankSp = SPEICHERN.bank;
  SPEICHERN.bank = (d, id) => {
    altBankSp(d, id);
    const b = id && S.banken.find(x => x.id === id);
    if (b && d.divKonto) { b.divKonto = d.divKonto; speichern(); }
  };

  const altPosForm = formPosition;
  formPosition = (id, bankId) => {
    altPosForm(id, bankId);
    const e = id ? S.depot.find(x => x.id === id) : null;
    const p = document.querySelector('#sheetInhalt form[data-form="position"] p.s.muted');
    if (p) p.insertAdjacentHTML("beforebegin", feld("Kaufdatum (wichtig für Dividenden)", "kaufdatum", e ? (e.datum || "") : heute(), "date"));
  };
  const altPosSp = SPEICHERN.position;
  SPEICHERN.position = (d, id) => {
    const vorher = new Set(S.depot.map(x => x.id));
    altPosSp(d, id);
    const e = id ? S.depot.find(x => x.id === id) : S.depot.find(x => !vorher.has(x.id));
    if (e) { e.datum = d.kaufdatum || ""; speichern(); render(); }
    if (S.einst.divAb) pruefen({erzwingen: true});
  };

  /* ----- Aktionen und Einhängen ----- */
  const altEdit = AKTIONEN.editBuchung;
  AKTIONEN.editBuchung = el => {
    const b = S.buchungen.find(x => x.id === el.dataset.id);
    if (b && b.div) formPruefen(b.id); else altEdit(el);
  };
  AKTIONEN.divPruefen = el => formPruefen(el.dataset.id);
  AKTIONEN.divLaden = () => pruefen({erzwingen: true, laut: true});
  AKTIONEN.divUebernehmen = el => {
    const x = offenL().find(o => o.key === el.dataset.key);
    if (!x) return;
    if (!divKonto(x.bankId)) { alert("Lege zuerst ein Konto bei dieser Bank an."); return; }
    x.stk = stueckAm(x.bankId, x.ticker, x.datum);
    if (!(x.stk > 0)) { alert("Am Ex-Tag war laut deinen Käufen kein Bestand vorhanden."); return; }
    if (x.auffaellig && !confirm(`Bitte mit der Abrechnung vergleichen: ${fmtZahl(x.proStk)} ${x.waehrung} je Stück. Übernehmen?`)) return;
    S.divOffen = offenL().filter(o => o.key !== x.key);
    buchen(x);
    fertig("Dividende gutgeschrieben");
  };
  AKTIONEN.divVerwerfen = el => {
    if (!confirm("Diese Dividende verwerfen? Sie wird nicht mehr vorgeschlagen.")) return;
    S.divOffen = offenL().filter(o => o.key !== el.dataset.key);
    erledigt().push(el.dataset.key);
    fertig("Verworfen");
  };

  const altDetail = bankDetail;
  bankDetail = (b, g) => {
    const h = altDetail(b, g);
    if (!b.echt) return h;
    const hat = depotPositionen().some(p => p.bankId === b.id) || S.buchungen.some(x => x.div && x.div.bankId === b.id);
    return hat ? h + divKarte(b) : h;
  };
  const altAlle = bankenAlle;
  bankenAlle = (items, banken, gesamt) => altAlle(items, banken, gesamt) + alleKarte();

  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") pruefen(); });
  render();
  pruefen();
})();
