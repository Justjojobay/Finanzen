/* Wertpapiere bearbeiten und löschen */
"use strict";
(function () {
  // Auf dem iPhone werden Tipps auf Listenzeilen nur so zuverlässig erkannt
  document.head.insertAdjacentHTML("beforeend", `<style>
    [data-action]{cursor:pointer}
    .kauf-btns{display:flex;gap:6px;flex-shrink:0}</style>`);

  let aktKey = null;
  const kaeufeVon = key => S.depot.filter(p => bid(p.bankId) + "|" + p.ticker === key);
  const knoepfe = id => `<div class="kauf-btns">
    <button class="btn klein sek" data-action="editPosition" data-id="${id}">Bearbeiten</button>
    <button class="btn klein gefahr" data-action="delPosition" data-id="${id}" aria-label="Löschen">🗑</button></div>`;

  // Bereich "Käufe bearbeiten" im Fenster einer Position
  function kaeufeBox(key) {
    const k = kaeufeVon(key);
    if (!k.length) return "";
    return `<div id="kaeufeBox"><hr class="trenner"><h3>✏️ Käufe bearbeiten</h3>
      <ul class="liste">${k.map(p => `<li><div><div class="t">${fmtZahl(p.menge)} Stk. à ${eur(p.kaufkurs)}</div>
        <div class="s">${esc(p.name)} · ${esc(p.ticker)}</div></div>${knoepfe(p.id)}</li>`).join("")}</ul>
      <div class="btnrow"><button class="btn klein sek" data-action="weitererKauf" data-key="${esc(key)}">＋ Weiteren Kauf</button>
      <button class="btn klein gefahr" data-action="posKomplettLoeschen" data-key="${esc(key)}">Ganze Position löschen</button></div></div>`;
  }

  // Sobald das Fenster einer Position erscheint, den Bereich anhängen
  new MutationObserver(() => {
    const v = document.getElementById("vSheet");
    if (v && aktKey && !document.getElementById("kaeufeBox")) v.insertAdjacentHTML("beforeend", kaeufeBox(aktKey));
  }).observe(document.getElementById("sheetInhalt"), {childList: true});

  if (AKTIONEN.wpVerlauf) {
    const altWp = AKTIONEN.wpVerlauf;
    AKTIONEN.wpVerlauf = el => { aktKey = el.dataset.key; altWp(el); };
  }

  AKTIONEN.weitererKauf = el => {
    const k = kaeufeVon(el.dataset.key)[0];
    if (!k) return;
    formPosition(null, bid(k.bankId));
    const setze = (n, w) => { const f = document.querySelector(`#sheetInhalt [name="${n}"]`); if (f) f.value = w; };
    setze("name", k.name); setze("ticker", k.ticker); setze("typ", k.typ);
  };

  AKTIONEN.posKomplettLoeschen = el => {
    const k = kaeufeVon(el.dataset.key);
    if (!k.length || !confirm(`„${k[0].name}“ komplett löschen? Dabei werden ${k.length} Kauf/Käufe gelöscht.`)) return;
    const ids = new Set(k.map(p => p.id)), t = k[0].ticker;
    S.depot = S.depot.filter(p => !ids.has(p.id));
    if (!S.depot.some(p => p.ticker === t)) delete S.kurse[t];
    aktKey = null;
    fertig("Position gelöscht");
  };

  // Liste "Einzelne Käufe" in der Bank: echte Buttons statt antippbarer Zeilen
  const altDepot = depotBereich;
  depotBereich = b => altDepot(b)
    .replace("Einzelne Käufe bearbeiten", "✏️ Käufe bearbeiten oder löschen")
    .replace(/<li data-action="editPosition" data-id="([^"]+)">([\s\S]*?)<span class="muted">›<\/span><\/li>/g,
      (m, id, inhalt) => `<li>${inhalt}${knoepfe(id)}</li>`);

  render();
})();
