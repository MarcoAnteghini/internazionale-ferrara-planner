/* Festival planner: logica dell'app. Nessuna dipendenza esterna.
   Legge tutto da window.PROGRAMMA (vedi README, sezione "Formato dei dati"). */
(function () {
  "use strict";

  var P = window.PROGRAMMA;
  var $ = function (id) { return document.getElementById(id); };
  if (!P || !Array.isArray(P.events) || !Array.isArray(P.days) || !P.days.length) {
    $("appError").hidden = false;
    return;
  }

  /* ---------- costanti e utilità ---------- */
  var ED = String(P.edition || "x");
  var NS = "fp-" + ED + "-";
  var FEST = P.festival || "Festival";
  var FEST_FULL = FEST + " " + ED;
  var PX = 1.5;
  var store = {
    get: function (k, def) {
      try { var v = localStorage.getItem(NS + k); return v == null ? def : JSON.parse(v); } catch (e) { return def; }
    },
    set: function (k, v) {
      try { localStorage.setItem(NS + k, JSON.stringify(v)); } catch (e) { /* storage non disponibile */ }
    }
  };
  var ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return ESC[c]; }); }
  function pad(n) { return String(n).padStart(2, "0"); }
  function fmt(m) { m = ((m % 1440) + 1440) % 1440; return pad(Math.floor(m / 60)) + "." + pad(m % 60); }
  function norm(s) {
    return String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[’‘`]/g, "'");
  }
  function isUrl(u) { return /^https?:\/\//i.test(String(u || "")); }
  function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }

  var KINDS = {
    talk: { l: "Incontri", c: "--talk" },
    libri: { l: "Libri", c: "--libri" },
    film: { l: "Film", c: "--film" },
    audio: { l: "Podcast", c: "--audio" },
    kids: { l: "Kids e fuoriclasse", c: "--kids" }
  };
  var ACC_ORDER = ["gratuito", "tagliando", "pagamento", "sconosciuto"];
  var ACC = {
    gratuito: { s: "Libero", l: "Ingresso libero", code: "g" },
    tagliando: { s: "Tagliando", l: "Con tagliando gratuito", code: "t" },
    pagamento: { s: "€", l: "A pagamento", code: "p" },
    sconosciuto: { s: "?", l: "Da verificare", code: "u" }
  };
  var SEG = { gratuito: "Libero", tagliando: "Tagliando", pagamento: "Pagamento", sconosciuto: "Da verificare" };
  var CODE2ACC = { g: "gratuito", t: "tagliando", p: "pagamento", u: "sconosciuto" };
  var ICON = {
    gratuito: '<svg class="ic" viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="6" r="4.8" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M3.6 6.2l1.6 1.6 3.2-3.4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    tagliando: '<svg class="ic" viewBox="0 0 12 12" aria-hidden="true"><path d="M1 3h10v2a1 1 0 0 0 0 2v2H1V7a1 1 0 0 0 0-2z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M7.5 3.5v5" stroke="currentColor" stroke-width="1" stroke-dasharray="1 1"/></svg>',
    pagamento: "",
    sconosciuto: ""
  };

  /* ---------- dati ---------- */
  var DAYS = P.days.slice();
  var DAYIDX = {};
  DAYS.forEach(function (d, i) { DAYIDX[d.date] = i; });
  var VORDER = Array.isArray(P.venueOrder) ? P.venueOrder : [];
  var EV = P.events.filter(function (e) { return e && e.id && e.day in DAYIDX && typeof e.s === "number"; })
    .map(function (e) { return Object.assign({}, e); });
  var BY = {};
  EV.forEach(function (e) {
    BY[e.id] = e;
    if (!KINDS[e.k]) e.k = "talk";
    if (!ACC[e.access]) e.access = "sconosciuto";
    e.end = e.s + Math.max(1, e.d || 60);
    e._q = norm([e.t, e.c, e.speakers, e.x, e.v].join(" "));
  });
  // Nello stesso luogo: una fine stimata non può superare l'inizio dell'evento successivo.
  (function () {
    var g = {};
    EV.forEach(function (e) { (g[e.day + "|" + e.v] = g[e.day + "|" + e.v] || []).push(e); });
    Object.keys(g).forEach(function (k) {
      var a = g[k].sort(function (x, y) { return x.s - y.s; });
      a.forEach(function (e, i) {
        var n = a[i + 1];
        if (n && e.est && e.end > n.s && n.s > e.s) e.end = Math.max(e.s + 20, n.s);
        e.dh = Math.max(20, (n && n.s > e.s ? Math.min(e.end, n.s) : e.end) - e.s);
      });
    });
  })();
  function vrank(v) { var i = VORDER.indexOf(v); return i < 0 ? 999 : i; }
  function byTime(a, b) { return a.s - b.s || vrank(a.v) - vrank(b.v) || a.v.localeCompare(b.v); }
  function overlap(a, b) { return a.day === b.day && a.s < b.end && b.s < a.end; }

  // Codice breve e stabile per id (FNV-1a 32 bit in base 36), usato nel link di condivisione.
  function hcode(s) {
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(36).padStart(7, "0").slice(-6);
  }
  var CODE2ID = {};
  EV.forEach(function (e) { e.hc = hcode(e.id); CODE2ID[e.hc] = e.id; });

  /* ---------- stato ---------- */
  var sel = new Set((store.get("sel", []) || []).filter(function (x) { return typeof x === "string"; }));
  var ovr = sanitizeOvr(store.get("ovr", {}));
  var day = store.get("day", 0);
  if (!(day >= 0 && day < DAYS.length)) day = 0;
  var view = store.get("view", "grid") === "prog" ? "prog" : "grid";
  var theme = store.get("theme", "auto");
  var F = { acc: new Set(), kind: new Set(), q: "", mine: false };
  var lastCW = 0;

  function sanitizeOvr(o) {
    var r = {};
    if (o && typeof o === "object") Object.keys(o).forEach(function (k) { if (ACC[o[k]]) r[k] = o[k]; });
    return r;
  }
  function save() { store.set("sel", Array.from(sel)); store.set("ovr", ovr); }
  function acc(e) { return ovr[e.id] || e.access; }
  function isOvr(e) { return !!ovr[e.id] && ovr[e.id] !== e.access; }
  function selected() { return EV.filter(function (e) { return sel.has(e.id); }).sort(function (a, b) { return DAYIDX[a.day] - DAYIDX[b.day] || byTime(a, b); }); }

  /* ---------- badge accesso ---------- */
  function parsePrice(p) {
    if (!p) return null;
    var m = String(p).match(/(\d+(?:[.,]\d{1,2})?)/);
    return m ? parseFloat(m[1].replace(",", ".")) : null;
  }
  function euro(n) { return "€ " + n.toLocaleString("it-IT", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 }); }
  function badge(e, long) {
    var a = acc(e);
    var lab;
    if (a === "pagamento") lab = e.price && !isOvr(e) ? e.price : (long ? "€ A pagamento" : "€");
    else lab = long ? ACC[a].l : ACC[a].s;
    if (a === "sconosciuto" && long) lab = "? Da verificare";
    var mod = isOvr(e) ? '<span class="mod" aria-hidden="true">*</span>' : "";
    var title = ACC[a].l + (a === "pagamento" && e.price && !isOvr(e) ? " " + e.price : "") + (isOvr(e) ? " (modificato da te)" : "");
    return '<span class="acc a-' + a + '" title="' + esc(title) + '">' + ICON[a] + "<span>" + esc(lab) + "</span>" + mod + "</span>";
  }
  function priceOf(e) { return acc(e) === "pagamento" && !isOvr(e) ? e.price : null; }

  /* ---------- filtri ---------- */
  function passes(e) {
    if (F.acc.size && !F.acc.has(acc(e))) return false;
    if (F.kind.size && !F.kind.has(e.k)) return false;
    if (F.mine && !sel.has(e.id)) return false;
    if (F.q) {
      var words = F.q.split(/\s+/).filter(Boolean);
      for (var i = 0; i < words.length; i++) if (e._q.indexOf(words[i]) < 0) return false;
    }
    return true;
  }
  function filtersActive() { return F.acc.size || F.kind.size || F.mine || F.q; }

  function renderFilters(evs) {
    var ca = {}, ck = {};
    evs.forEach(function (e) { var a = acc(e); ca[a] = (ca[a] || 0) + 1; ck[e.k] = (ck[e.k] || 0) + 1; });
    $("accChips").innerHTML = ACC_ORDER.map(function (a) {
      return '<button type="button" class="chip" data-facc="' + a + '" aria-pressed="' + F.acc.has(a) + '">' +
        '<span class="acc a-' + a + '">' + ICON[a] + "<span>" + esc(ACC[a].s) + "</span></span> " + esc(SEG[a]) +
        ' <span class="n">' + (ca[a] || 0) + "</span></button>";
    }).join("");
    $("kindChips").innerHTML = Object.keys(KINDS).map(function (k) {
      return '<button type="button" class="chip kind" style="--c:var(' + KINDS[k].c + ')" data-fkind="' + k + '" aria-pressed="' + F.kind.has(k) + '">' +
        esc(KINDS[k].l) + ' <span class="n">' + (ck[k] || 0) + "</span></button>";
    }).join("");
    $("mineChip").setAttribute("aria-pressed", F.mine);
    $("resetF").hidden = !filtersActive();
  }

  /* ---------- griglia ---------- */
  function venuesOf(evs) {
    var present = new Set(evs.map(function (e) { return e.v; }));
    var vs = VORDER.filter(function (v) { return present.has(v); });
    Array.from(present).sort().forEach(function (v) { if (vs.indexOf(v) < 0) vs.push(v); });
    return vs;
  }
  function clashes(evs) {
    var f = evs.filter(function (e) { return sel.has(e.id); }).sort(byTime);
    var s = new Set(), pairs = [];
    for (var i = 0; i < f.length; i++) for (var j = i + 1; j < f.length; j++) {
      if (overlap(f[i], f[j])) { s.add(f[i].id); s.add(f[j].id); pairs.push([f[i], f[j]]); }
    }
    return { s: s, pairs: pairs };
  }
  function renderGrid() {
    var d = DAYS[day];
    var evs = EV.filter(function (e) { return e.day === d.date; });
    renderFilters(evs);
    var venues = venuesOf(evs);
    var T0 = 600, T1 = 23 * 60 + 30;
    evs.forEach(function (e) { T0 = Math.min(T0, Math.floor(e.s / 60) * 60); T1 = Math.max(T1, Math.ceil((e.s + e.dh) / 30) * 30); });
    var H = (T1 - T0) * PX;
    var g = $("grid");
    var cw = window.innerWidth < 600 ? 128 : 150;
    lastCW = cw;
    g.style.gridTemplateColumns = "48px repeat(" + venues.length + "," + cw + "px)";
    var cl = clashes(evs);
    var shown = 0;
    var h = '<div class="corner"></div>' + venues.map(function (v) { return '<div class="vh">' + esc(v) + "</div>"; }).join("");
    h += '<div class="times" style="height:' + H + 'px">';
    for (var m = T0; m <= T1; m += 60) h += '<div style="top:' + (m - T0) * PX + 'px">' + String(Math.floor(m / 60) % 24) + "</div>";
    h += "</div>";
    venues.forEach(function (v) {
      var c = '<div class="col" style="height:' + H + 'px">';
      for (var m = T0; m <= T1; m += 30) c += '<div class="hl' + (m % 60 ? " half" : "") + '" style="top:' + (m - T0) * PX + 'px"></div>';
      evs.filter(function (e) { return e.v === v; }).forEach(function (e) {
        var on = sel.has(e.id), ok = passes(e);
        if (ok) shown++;
        var cls = ["ev", e.est ? "est" : "", on ? "sel" : "", cl.s.has(e.id) ? "clash" : "", ok ? "" : "dim", e.dh * PX < 44 ? "short" : ""].join(" ");
        c += '<div class="' + cls + '" style="--c:var(' + KINDS[e.k].c + ");top:" + ((e.s - T0) * PX + 1) + "px;height:" + (e.dh * PX - 2) + 'px">' +
          '<button type="button" class="evb" data-open="' + esc(e.id) + '" aria-label="' + esc(fmt(e.s) + ", " + e.t + ", " + e.v + ", " + ACC[acc(e)].l + (on ? ", nel tuo programma" : "")) + '">' +
          '<span class="top"><span class="tm">' + fmt(e.s) + "</span>" + badge(e, false) + "</span>" +
          '<span class="ti">' + esc(e.t) + "</span>" + (e.c ? '<span class="ca">' + esc(e.c) + "</span>" : "") + "</button>" +
          '<label class="ck" title="' + (on ? "Togli dal mio programma" : "Aggiungi al mio programma") + '"><input type="checkbox" data-sel="' + esc(e.id) + '"' + (on ? " checked" : "") +
          ' aria-label="' + esc("Nel mio programma: " + e.t) + '"></label></div>';
      });
      h += c + "</div>";
    });
    g.innerHTML = h;
    $("fcount").textContent = filtersActive() ? "Evidenziati " + shown + " su " + evs.length : evs.length + " eventi";
    var conf = $("conf");
    if (cl.pairs.length) {
      conf.style.display = "block";
      conf.innerHTML = "<b>Sovrapposizioni tra i tuoi eventi:</b> " + cl.pairs.map(function (p) {
        return esc(fmt(p[0].s) + " " + p[0].t) + " ↔ " + esc(fmt(p[1].s) + " " + p[1].t);
      }).join("; ");
    } else conf.style.display = "none";
  }

  /* ---------- il mio programma (schermo, stampa, file salvato) ---------- */
  function clusters(list) {
    var out = [], cur = null, end = -1;
    list.forEach(function (e) {
      if (cur && e.s < end) { cur.push(e); end = Math.max(end, e.end); }
      else { cur = [e]; out.push(cur); end = e.end; }
    });
    return out;
  }
  function programme() {
    var list = selected();
    var st = { n: list.length, tag: 0, pay: 0, cost: 0, noPrice: 0, unk: 0 };
    list.forEach(function (e) {
      var a = acc(e);
      if (a === "tagliando") st.tag++;
      if (a === "sconosciuto") st.unk++;
      if (a === "pagamento") {
        st.pay++;
        var p = parsePrice(priceOf(e));
        if (p == null) st.noPrice++; else st.cost += p;
      }
    });
    var days = DAYS.map(function (d) {
      var evs = list.filter(function (e) { return e.day === d.date; });
      return { d: d, evs: evs, groups: clusters(evs), tags: evs.filter(function (e) { return acc(e) === "tagliando"; }) };
    }).filter(function (x) { return x.evs.length; });
    return { list: list, st: st, days: days };
  }
  function timeRange(e) {
    return fmt(e.s) + "–" + (e.est ? "~" : "") + fmt(e.end);
  }
  function accText(e) {
    var a = acc(e), p = priceOf(e);
    return (a === "pagamento" && p ? "A pagamento, " + p : ACC[a].l) + (isOvr(e) ? " (modificato da te)" : "");
  }
  function summaryHTML(st) {
    function card(n, l, cls) { return '<div class="sc' + (cls ? " " + cls : "") + '"><b>' + n + "</b><span>" + l + "</span></div>"; }
    var costLab = "costo noto totale" + (st.noPrice ? " (+" + st.noPrice + " senza prezzo)" : "");
    return '<div class="summary">' + card(st.n, st.n === 1 ? "evento" : "eventi") + card(st.tag, "tagliandi da ritirare", st.tag ? "warn" : "") +
      card(st.pay, "a pagamento") + card(euro(st.cost), costLab) + card(st.unk, "da verificare", st.unk ? "unk" : "") + "</div>";
  }
  function progItem(e, interactive) {
    var note = e.accessNote ? '<span class="pnote">' + esc(e.accessNote) + "</span>" : "";
    var title = interactive ? '<button type="button" class="linklike" data-open="' + esc(e.id) + '">' + esc(e.t) + "</button>" : esc(e.t);
    return '<article class="pitem" style="--c:var(' + KINDS[e.k].c + ')">' +
      '<div class="ptime">' + fmt(e.s) + '<span class="pend">' + (e.est ? "~" : "") + fmt(e.end) + (e.est ? '<span class="sr"> fine stimata</span>' : "") + "</span></div>" +
      '<div class="pmain"><h4 class="ptitle">' + title + "</h4>" +
      '<div class="pmeta">' + esc(e.v) + (e.c ? " · " + esc(e.c) : "") + "</div>" +
      '<div class="pacc">' + badge(e, true) + note + "</div></div>" +
      (interactive ? '<button type="button" class="rm" data-rm="' + esc(e.id) + '" aria-label="' + esc("Rimuovi " + e.t) + '">Rimuovi</button>' : "") +
      "</article>";
  }
  function tagListHTML(tags) {
    if (!tags.length) return "";
    return '<div class="taglist"><h3>' + ICON.tagliando + " Tagliandi da ritirare (" + tags.length + ")</h3><ul>" + tags.map(function (e) {
      return "<li><b>" + fmt(e.s) + "</b> " + esc(e.t) + " <span class=\"pmeta\">(" + esc(e.v) + ")</span></li>";
    }).join("") + "</ul></div>";
  }
  function progBodyHTML(pg, interactive) {
    if (!pg.list.length) {
      return '<div class="empty"><h2>Il tuo programma è vuoto</h2><p>Torna alla griglia e spunta la casella sugli eventi che vuoi seguire: li ritroverai qui, in ordine di giorno e di orario.</p></div>';
    }
    var h = summaryHTML(pg.st);
    pg.days.forEach(function (x) {
      h += '<section class="pday" id="pday-' + esc(x.d.date) + '"><h2>' + esc(x.d.label) + " <small>" + plural(x.evs.length, "evento", "eventi") + "</small></h2>";
      h += tagListHTML(x.tags);
      x.groups.forEach(function (g) {
        if (g.length === 1) h += progItem(g[0], interactive);
        else h += '<div class="pgroup" role="group" aria-label="In parallelo (' + g.length + ')"><div class="plabel">In parallelo (' + g.length + ")</div>" +
          g.map(function (e) { return progItem(e, interactive); }).join("") + "</div>";
      });
      h += "</section>";
    });
    return h;
  }
  function renderProg() {
    var pg = programme();
    var el = $("progView");
    var h = '<div class="prog-inner"><h2 class="vtitle">Il mio programma</h2>' + progBodyHTML(pg, true);
    if (pg.list.length) h += '<p class="hint">Suggerimento: con "Salva la mia selezione" scarichi un file da tenere sul telefono, leggibile anche senza connessione.</p>';
    el.innerHTML = h + "</div>";
    var missing = Array.from(sel).filter(function (id) { return !BY[id]; }).length;
    if (missing) el.firstChild.insertAdjacentHTML("beforeend", '<p class="hint">' + plural(missing, "evento selezionato non è più", "eventi selezionati non sono più") + " nel programma aggiornato.</p>");
  }
  function todayIT() { var d = new Date(); return pad(d.getDate()) + "/" + pad(d.getMonth() + 1) + "/" + d.getFullYear(); }
  function printHTML(pg) {
    var head = '<div class="pr-head"><div><b>' + esc(FEST_FULL) + "</b> · Il mio programma</div><div>Stampato il " + todayIT() + "</div></div>";
    if (!pg.list.length) {
      return head + '<div class="pr-empty"><h2>Il programma è vuoto</h2><p>Non hai ancora selezionato eventi. Apri la griglia, spunta gli eventi che ti interessano e stampa di nuovo.</p></div>';
    }
    var h = "";
    pg.days.forEach(function (x) {
      h += '<section class="pr-day">' + head + "<h2>" + esc(x.d.label) + "</h2>";
      if (x.tags.length) {
        h += '<div class="pr-tags"><b>Tagliandi da ritirare:</b> ' + x.tags.map(function (e) {
          return "<span>☐ " + fmt(e.s) + " " + esc(e.t) + " (" + esc(e.v) + ")</span>";
        }).join(" ") + "</div>";
      }
      h += '<div class="pr-row pr-th"><span></span><span>Orario</span><span>Evento</span><span>Accesso</span></div>';
      x.groups.forEach(function (g) {
        var rows = g.map(function (e) {
          return '<div class="pr-row"><span class="pr-box" aria-hidden="true"></span><span class="pr-time">' + esc(timeRange(e)) + "</span>" +
            '<span><b>' + esc(e.t) + "</b><br><small>" + esc(e.v) + (e.c ? " · " + esc(e.c) : "") + "</small></span>" +
            "<span>" + esc(accText(e)) + (e.accessNote ? "<br><small>" + esc(e.accessNote) + "</small>" : "") + "</span></div>";
        }).join("");
        h += g.length > 1 ? '<div class="pr-group"><div class="pr-glabel">In parallelo (' + g.length + ")</div>" + rows + "</div>" : rows;
      });
      h += '<div class="pr-foot">' + plural(x.evs.length, "evento", "eventi") + " in questa giornata · " + plural(pg.list.length, "evento", "eventi") +
        " nel programma · ~ = fine stimata · verifica orari e accessi sul sito ufficiale</div></section>";
    });
    return h;
  }
  function renderPrint() { $("print").innerHTML = printHTML(programme()); }

  /* ---------- rendering generale ---------- */
  function keepFocus(fn) {
    var a = document.activeElement, key = null;
    if (a && a.dataset) key = a.dataset.sel ? '[data-sel="' + a.dataset.sel + '"]' : a.dataset.open ? '[data-open="' + a.dataset.open + '"]' : null;
    var inGrid = a && $("grid").contains(a);
    fn();
    if (key && inGrid) { var n = $("grid").querySelector(key); if (n) n.focus({ preventScroll: true }); }
  }
  function renderToolbar() {
    Array.prototype.forEach.call($("days").children, function (b, i) { b.setAttribute("aria-pressed", view === "grid" && i === day); });
    Array.prototype.forEach.call($("views").children, function (b) { b.setAttribute("aria-pressed", b.dataset.view === view); });
    $("nsel").textContent = selected().length;
    $("gridView").hidden = view !== "grid";
    $("progView").hidden = view !== "prog";
    $("festSub").textContent = view === "grid" ? "Griglia per luogo e orario" : "Il mio programma";
  }
  function renderAll() {
    renderToolbar();
    if (view === "grid") keepFocus(renderGrid); else renderProg();
    renderPrint();
  }

  /* ---------- dialog ---------- */
  var dlg = $("dlg");
  function openEvent(id) {
    var e = BY[id];
    if (!e) return;
    var par = EV.filter(function (x) { return x.id !== id && overlap(x, e); }).sort(byTime);
    var on = sel.has(id), a = acc(e), p = priceOf(e);
    var mine = par.filter(function (x) { return sel.has(x.id); });
    var h = '<div class="dl" style="--c:var(' + KINDS[e.k].c + ')">' +
      '<button type="button" class="x" id="dlgX" aria-label="Chiudi">×</button>' +
      '<div class="meta">' + esc(DAYS[DAYIDX[e.day]].label) + " · " + fmt(e.s) + "–" + fmt(e.end) + (e.est ? " (fine stimata)" : "") + (e.c ? " · " + esc(e.c) : "") + "</div>" +
      '<h2 id="dlgTitle">' + esc(e.t) + '</h2><div class="ven">' + esc(e.v) + "</div>" +
      (e.speakers ? '<div class="spk">' + esc(e.speakers) + "</div>" : "") +
      (e.x ? "<p>" + esc(e.x) + "</p>" : "") +
      '<div class="accbox"><div class="accline">' + badge(e, true) + (p ? " <b>" + esc(p) + "</b>" : "") +
      (isOvr(e) ? ' <span class="modtag">modificato da te</span>' : "") + "</div>" +
      (e.accessNote ? '<div class="anote">' + esc(e.accessNote) + "</div>" : "") +
      (isOvr(e) ? '<div class="anote">Dato ufficiale: ' + esc(ACC[e.access].l) + (e.price ? ", " + esc(e.price) : "") + "</div>" : "") +
      '<div class="ovr"><span class="ovl" id="ovl">Correggi accesso:</span><div class="seg small" role="group" aria-labelledby="ovl">' +
      ACC_ORDER.map(function (k) { return '<button type="button" data-ovr="' + k + '" aria-pressed="' + (a === k) + '">' + SEG[k] + "</button>"; }).join("") +
      "</div>" + (isOvr(e) ? '<button type="button" class="linklike" id="ovrReset">ripristina</button>' : "") + "</div></div>" +
      (isUrl(e.src) ? '<p class="src"><a href="' + esc(e.src) + '" target="_blank" rel="noopener">Pagina ufficiale dell\'evento ↗</a></p>' : "") +
      (mine.length ? '<div class="par warnp"><b>Si sovrappone ai tuoi:</b> ' + mine.map(function (x) { return esc(fmt(x.s) + " " + x.t); }).join("; ") + "</div>" : "") +
      '<div class="par"><b>In parallelo (' + par.length + "):</b> " + (par.length ? par.map(function (x) {
        return '<button type="button" class="linklike" data-open="' + esc(x.id) + '">' + esc(fmt(x.s) + " " + x.t) + "</button> <i>(" + esc(x.v) + ")</i>" + (sel.has(x.id) ? " ✓" : "");
      }).join("; ") : "nessuno") + "</div>" +
      '<div class="row"><button type="button" class="primary" id="dlgSel" aria-pressed="' + on + '">' + (on ? "Togli dal mio programma" : "Aggiungi al mio programma") + "</button>" +
      '<button type="button" id="dlgClose">Chiudi</button></div></div>';
    dlg.innerHTML = h;
    dlg.dataset.id = id;
    if (!dlg.open) dlg.showModal();
    var f = dlg.querySelector("#dlgSel");
    if (f) f.focus();
  }
  dlg.addEventListener("click", function (ev) {
    if (ev.target === dlg) { dlg.close(); return; }
    var t = ev.target.closest("button");
    if (!t) return;
    var id = dlg.dataset.id;
    if (t.id === "dlgClose" || t.id === "dlgX") dlg.close();
    else if (t.id === "dlgSel") { toggleSel(id); openEvent(id); }
    else if (t.dataset.ovr) { setOvr(id, t.dataset.ovr); openEvent(id); var b = dlg.querySelector('[data-ovr="' + t.dataset.ovr + '"]'); if (b) b.focus(); }
    else if (t.id === "ovrReset") { setOvr(id, null); openEvent(id); }
    else if (t.dataset.open) openEvent(t.dataset.open);
  });

  function toggleSel(id, force) {
    var on = force == null ? !sel.has(id) : force;
    if (on) sel.add(id); else sel.delete(id);
    save();
    renderAll();
  }
  function setOvr(id, a) {
    var e = BY[id];
    if (!a || a === e.access) delete ovr[id]; else ovr[id] = a;
    save();
    renderAll();
  }

  /* ---------- eventi UI ---------- */
  $("grid").addEventListener("click", function (ev) {
    var t = ev.target;
    if (t.matches && t.matches("input[data-sel]")) { ev.stopPropagation(); return; }
    if (t.closest && t.closest(".ck")) { ev.stopPropagation(); return; }
    var b = t.closest && t.closest("[data-open]");
    if (b) openEvent(b.dataset.open);
  });
  $("grid").addEventListener("change", function (ev) {
    var t = ev.target;
    if (t.dataset && t.dataset.sel) { ev.stopPropagation(); toggleSel(t.dataset.sel, t.checked); }
  });
  $("progView").addEventListener("click", function (ev) {
    var t = ev.target.closest("button");
    if (!t) return;
    if (t.dataset.rm) {
      var e = BY[t.dataset.rm];
      toggleSel(t.dataset.rm, false);
      toast("Rimosso: " + (e ? e.t : ""), "Annulla", function () { toggleSel(e.id, true); });
    } else if (t.dataset.open) openEvent(t.dataset.open);
    else if (t.dataset.go === "grid") setView("grid");
  });
  $("accChips").addEventListener("click", function (ev) {
    var b = ev.target.closest("[data-facc]"); if (!b) return;
    var a = b.dataset.facc; F.acc.has(a) ? F.acc.delete(a) : F.acc.add(a); keepChip(b, renderGrid);
  });
  $("kindChips").addEventListener("click", function (ev) {
    var b = ev.target.closest("[data-fkind]"); if (!b) return;
    var k = b.dataset.fkind; F.kind.has(k) ? F.kind.delete(k) : F.kind.add(k); keepChip(b, renderGrid);
  });
  function keepChip(b, fn) {
    var sel2 = b.dataset.facc ? '[data-facc="' + b.dataset.facc + '"]' : '[data-fkind="' + b.dataset.fkind + '"]';
    fn();
    var n = document.querySelector(sel2); if (n) n.focus();
  }
  $("mineChip").addEventListener("click", function () { F.mine = !F.mine; renderGrid(); });
  $("resetF").addEventListener("click", function () {
    F.acc.clear(); F.kind.clear(); F.mine = false; F.q = ""; $("q").value = ""; renderGrid(); $("q").focus();
  });
  var qt;
  $("q").addEventListener("input", function () {
    clearTimeout(qt);
    qt = setTimeout(function () { F.q = norm($("q").value.trim()); renderGrid(); }, 120);
  });

  function shortDay(d) {
    var m = String(d.label || d.date).match(/^(\S{3})\S*\s+(\d+)/);
    return m ? m[1] + " " + m[2] : d.label || d.date;
  }
  DAYS.forEach(function (d, i) {
    var b = document.createElement("button");
    b.type = "button";
    b.textContent = shortDay(d);
    b.title = d.label;
    b.addEventListener("click", function () {
      day = i; store.set("day", i);
      if (view === "prog") {
        var s = document.getElementById("pday-" + d.date);
        if (s) { s.scrollIntoView({ behavior: "smooth", block: "start" }); return; }
      }
      setView("grid");
    });
    $("days").appendChild(b);
  });
  function setView(v) {
    view = v; store.set("view", v);
    renderAll();
    if (v === "prog") $("progView").scrollTop = 0;
  }
  $("views").addEventListener("click", function (ev) { var b = ev.target.closest("[data-view]"); if (b) setView(b.dataset.view); });
  $("printBtn").addEventListener("click", function () { renderPrint(); window.print(); });
  $("saveBtn").addEventListener("click", saveStandalone);
  window.addEventListener("beforeprint", renderPrint);

  var rt;
  window.addEventListener("resize", function () {
    clearTimeout(rt);
    rt = setTimeout(function () { if (view === "grid" && (window.innerWidth < 600 ? 128 : 150) !== lastCW) renderGrid(); }, 150);
  });

  /* ---------- menu ---------- */
  var menu = $("menu"), menuBtn = $("menuBtn");
  function menuItems() { return Array.prototype.slice.call(menu.querySelectorAll("[role=menuitem]")); }
  function openMenu(open) {
    menu.hidden = !open;
    menuBtn.setAttribute("aria-expanded", open);
    if (open) {
      menu.style.left = ""; menu.style.right = "";
      var r = menu.getBoundingClientRect();
      if (r.left < 8) { menu.style.left = "0"; menu.style.right = "auto"; }
      menuItems()[0].focus();
    }
  }
  menuBtn.addEventListener("click", function () { openMenu(menu.hidden); });
  menu.addEventListener("keydown", function (ev) {
    var it = menuItems(), i = it.indexOf(document.activeElement);
    if (ev.key === "ArrowDown") { ev.preventDefault(); it[(i + 1) % it.length].focus(); }
    else if (ev.key === "ArrowUp") { ev.preventDefault(); it[(i - 1 + it.length) % it.length].focus(); }
    else if (ev.key === "Home") { ev.preventDefault(); it[0].focus(); }
    else if (ev.key === "End") { ev.preventDefault(); it[it.length - 1].focus(); }
    else if (ev.key === "Escape") { ev.preventDefault(); openMenu(false); menuBtn.focus(); }
    else if (ev.key === "Tab") openMenu(false);
  });
  document.addEventListener("click", function (ev) {
    if (!menu.hidden && !menu.contains(ev.target) && !menuBtn.contains(ev.target)) openMenu(false);
  });
  menu.addEventListener("click", function (ev) {
    var b = ev.target.closest("[data-act]"); if (!b) return;
    var act = b.dataset.act;
    if (act !== "theme") { openMenu(false); menuBtn.focus(); }
    if (act === "share") shareLink();
    else if (act === "export-json") exportJSON();
    else if (act === "import-json") $("fileIn").click();
    else if (act === "ics") exportICS();
    else if (act === "theme") cycleTheme();
    else if (act === "clear") askClear();
  });

  /* ---------- tema ---------- */
  var THEMES = { auto: "automatico", light: "chiaro", dark: "scuro" };
  function applyTheme() {
    if (theme === "light" || theme === "dark") document.documentElement.setAttribute("data-theme", theme);
    else document.documentElement.removeAttribute("data-theme");
    $("themeItem").textContent = "Tema: " + THEMES[theme];
  }
  function cycleTheme() {
    theme = theme === "auto" ? "light" : theme === "light" ? "dark" : "auto";
    store.set("theme", theme); applyTheme();
  }
  if (!THEMES[theme]) theme = "auto";
  applyTheme();

  /* ---------- toast e banner ---------- */
  var toastT;
  function toast(msg, actLabel, actFn) {
    var t = $("toast");
    t.innerHTML = "<span>" + esc(msg) + "</span>" + (actLabel ? ' <button type="button">' + esc(actLabel) + "</button>" : "");
    t.classList.add("show");
    if (actLabel) t.querySelector("button").onclick = function () { t.classList.remove("show"); actFn(); };
    clearTimeout(toastT);
    toastT = setTimeout(function () { t.classList.remove("show"); }, actLabel ? 6000 : 3500);
  }
  function banner(html, actions) {
    var b = $("banner");
    if (!html) { b.hidden = true; b.innerHTML = ""; return; }
    b.innerHTML = '<div class="bmsg">' + html + '</div><div class="bact">' + actions.map(function (a, i) {
      return '<button type="button" class="btn' + (a.primary ? " primary" : "") + '" data-i="' + i + '">' + esc(a.label) + "</button>";
    }).join("") + "</div>";
    b.hidden = false;
    b.onclick = function (ev) {
      var t = ev.target.closest("[data-i]"); if (!t) return;
      var a = actions[+t.dataset.i];
      banner(null);
      if (a.fn) a.fn();
    };
    var first = b.querySelector("button"); if (first) first.focus({ preventScroll: true });
  }

  /* ---------- condivisione, import, export ---------- */
  function encodeHash() {
    var s = selected().map(function (e) { return e.hc; }).join(".");
    var o = Object.keys(ovr).filter(function (id) { return BY[id]; }).map(function (id) { return BY[id].hc + ":" + ACC[ovr[id]].code; }).join(",");
    return "e=" + encodeURIComponent(ED) + "&s=" + s + (o ? "&o=" + o : "");
  }
  function shareLink() {
    var url = location.href.split("#")[0] + "#" + encodeHash();
    var n = selected().length;
    function fallback() {
      banner('Copia questo link (' + plural(n, "evento", "eventi") + '):<br><input class="linkbox" readonly value="' + esc(url) + '" aria-label="Link di condivisione">', [{ label: "Chiudi" }]);
      var i = $("banner").querySelector("input"); i.focus(); i.select();
    }
    if (location.protocol === "file:") {
      toast("Attenzione: il link punta a un file sul tuo computer, funziona solo qui. Pubblica il sito per condividerlo.");
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(function () {
        if (location.protocol !== "file:") toast("Link copiato: " + plural(n, "evento", "eventi") + ".");
      }, fallback);
    } else fallback();
  }
  function parseIncoming(selIds, ovrObj) {
    var ids = [], unknown = 0;
    (selIds || []).forEach(function (id) { if (BY[id]) ids.push(id); else unknown++; });
    var o = {};
    Object.keys(ovrObj || {}).forEach(function (id) { if (BY[id] && ACC[ovrObj[id]]) o[id] = ovrObj[id]; });
    return { sel: ids, ovr: o, unknown: unknown };
  }
  function applyIncoming(inc, mode) {
    if (mode === "replace") { sel = new Set(inc.sel); ovr = Object.assign({}, inc.ovr); }
    else { inc.sel.forEach(function (id) { sel.add(id); }); Object.assign(ovr, inc.ovr); }
    save();
    renderAll();
    toast(mode === "replace" ? "Programma sostituito: " + plural(sel.size, "evento", "eventi") + "." : "Unito: ora hai " + plural(selected().length, "evento", "eventi") + ".");
  }
  function offerIncoming(inc, what, onDone) {
    var no = Object.keys(inc.ovr).length;
    var cur = selected().length;
    var msg = "<b>" + esc(what) + "</b> con " + plural(inc.sel.length, "evento", "eventi") +
      (no ? " e " + plural(no, "correzione", "correzioni") + " all'accesso" : "") +
      (inc.unknown ? " (" + inc.unknown + " non più in programma)" : "") + ". " +
      (cur ? "Il tuo programma attuale ha " + plural(cur, "evento", "eventi") + ". Cosa vuoi fare?" : "Vuoi importarlo?");
    var acts = cur ? [
      { label: "Unisci ai miei", primary: true, fn: function () { applyIncoming(inc, "merge"); onDone && onDone(); } },
      { label: "Sostituisci i miei", fn: function () { applyIncoming(inc, "replace"); onDone && onDone(); } },
      { label: "Ignora", fn: function () { onDone && onDone(); } }
    ] : [
      { label: "Importa", primary: true, fn: function () { applyIncoming(inc, "replace"); onDone && onDone(); } },
      { label: "Ignora", fn: function () { onDone && onDone(); } }
    ];
    banner(msg, acts);
  }
  function clearHash() { try { history.replaceState(null, "", location.pathname + location.search); } catch (e) { location.hash = ""; } }
  function readHash() {
    var h = location.hash.replace(/^#/, "");
    if (!h || !/(^|&)(s|o)=/.test(h)) return;
    var p = new URLSearchParams(h);
    var ids = [], unknown = 0, o = {};
    (p.get("s") || "").split(".").filter(Boolean).forEach(function (c) { if (CODE2ID[c]) ids.push(CODE2ID[c]); else unknown++; });
    (p.get("o") || "").split(",").filter(Boolean).forEach(function (pair) {
      var q = pair.split(":"); if (CODE2ID[q[0]] && CODE2ACC[q[1]]) o[CODE2ID[q[0]]] = CODE2ACC[q[1]];
    });
    var ed = p.get("e");
    if (!ids.length && !Object.keys(o).length) {
      banner("Il link aperto non contiene eventi riconoscibili" + (ed && ed !== ED ? " (è di un'altra edizione: " + esc(ed) + ")" : "") + ".", [{ label: "Chiudi", fn: clearHash }]);
      return;
    }
    var inc = { sel: ids, ovr: o, unknown: unknown };
    offerIncoming(inc, "Hai aperto un programma condiviso", clearHash);
  }
  function download(name, text, type) {
    var blob = new Blob([text], { type: type });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }
  var FILEBASE = norm(FEST).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + "-" + ED;
  function exportJSON() {
    var data = {
      festival: FEST, edition: P.edition, exported: new Date().toISOString(),
      selected: Array.from(sel), overrides: ovr,
      titles: selected().map(function (e) { return e.day + " " + fmt(e.s) + " " + e.t; })
    };
    download(FILEBASE + "-backup.json", JSON.stringify(data, null, 2), "application/json");
    toast("Backup esportato: " + plural(sel.size, "evento", "eventi") + ".");
  }
  $("fileIn").addEventListener("change", function () {
    var f = this.files && this.files[0];
    this.value = "";
    if (!f) return;
    var r = new FileReader();
    r.onload = function () {
      var d;
      try { d = JSON.parse(r.result); } catch (e) { toast("Il file non è un JSON valido."); return; }
      var s = d && (d.selected || d.sel), o = d && (d.overrides || d.ovr);
      if (!Array.isArray(s)) { toast("Il file non sembra un backup del planner."); return; }
      if (d.edition && String(d.edition) !== ED) toast("Attenzione: il backup è dell'edizione " + d.edition + ".");
      offerIncoming(parseIncoming(s, o), "Backup letto", null);
    };
    r.onerror = function () { toast("Impossibile leggere il file."); };
    r.readAsText(f);
  });
  function askClear() {
    var n = selected().length;
    if (!n && !Object.keys(ovr).length) { toast("Il programma è già vuoto."); return; }
    var backup = { sel: Array.from(sel), ovr: Object.assign({}, ovr) };
    banner("Vuoi svuotare il programma (" + plural(n, "evento", "eventi") + ")? Le correzioni all'accesso restano.", [
      { label: "Svuota", primary: true, fn: function () {
        sel = new Set(); save(); renderAll();
        toast("Programma svuotato.", "Annulla", function () { sel = new Set(backup.sel); save(); renderAll(); });
      } },
      { label: "Annulla" }
    ]);
  }

  /* ---------- .ics ---------- */
  function icsText(s) { return String(s || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n"); }
  function icsFold(line) {
    var enc = new TextEncoder(), out = [], cur = "", bytes = 0, lim = 75;
    Array.from(line).forEach(function (ch) {
      var b = enc.encode(ch).length;
      if (bytes + b > lim) { out.push(cur); cur = " "; bytes = 1; lim = 75; }
      cur += ch; bytes += b;
    });
    out.push(cur);
    return out.join("\r\n");
  }
  function icsDate(date, min) {
    var p = date.split("-").map(Number);
    var t = new Date(Date.UTC(p[0], p[1] - 1, p[2], 0, min));
    return t.getUTCFullYear() + pad(t.getUTCMonth() + 1) + pad(t.getUTCDate()) + "T" + pad(t.getUTCHours()) + pad(t.getUTCMinutes()) + "00";
  }
  function exportICS() {
    var list = selected();
    if (!list.length) { toast("Seleziona almeno un evento per esportare il calendario."); return; }
    var stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
    var L = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//festival-planner//" + icsText(FEST_FULL) + "//IT", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
      "X-WR-CALNAME:" + icsText(FEST_FULL), "X-WR-TIMEZONE:Europe/Rome",
      "BEGIN:VTIMEZONE", "TZID:Europe/Rome",
      "BEGIN:DAYLIGHT", "TZOFFSETFROM:+0100", "TZOFFSETTO:+0200", "TZNAME:CEST", "DTSTART:19700329T020000", "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU", "END:DAYLIGHT",
      "BEGIN:STANDARD", "TZOFFSETFROM:+0200", "TZOFFSETTO:+0100", "TZNAME:CET", "DTSTART:19701025T030000", "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU", "END:STANDARD",
      "END:VTIMEZONE"];
    list.forEach(function (e) {
      var desc = [e.c, "Accesso: " + accText(e), e.accessNote, e.est ? "Fine stimata" : "", e.speakers, e.x, isUrl(e.src) ? e.src : ""].filter(Boolean).join("\n");
      L.push("BEGIN:VEVENT", "UID:" + e.id + "@festival-planner", "DTSTAMP:" + stamp,
        "DTSTART;TZID=Europe/Rome:" + icsDate(e.day, e.s), "DTEND;TZID=Europe/Rome:" + icsDate(e.day, e.end),
        "SUMMARY:" + icsText(e.t), "LOCATION:" + icsText(e.v + ", Ferrara"), "DESCRIPTION:" + icsText(desc));
      if (isUrl(e.src)) L.push("URL:" + e.src);
      L.push("END:VEVENT");
    });
    L.push("END:VCALENDAR");
    download(FILEBASE + "-mio-programma.ics", L.map(icsFold).join("\r\n") + "\r\n", "text/calendar;charset=utf-8");
    toast("Calendario esportato: " + plural(list.length, "evento", "eventi") + ".");
  }

  /* ---------- file autonomo "Salva la mia selezione" ---------- */
  var SA_CSS = [
    ":root{--bg:#F5F6F8;--surface:#fff;--ink:#1B2230;--mute:#667085;--line:#DDE1E7;--talk:#D0021B;--libri:#2F5DA8;--film:#6A3FA0;--audio:#1D7A58;--kids:#C98A00;--free:#1D7A58;--tag:#A64B00;--warn:#A64B00}",
    "@media (prefers-color-scheme:dark){:root:not([data-theme=\"light\"]){--bg:#12161E;--surface:#1B212C;--ink:#E8EBF0;--mute:#98A2B3;--line:#2A3240;--talk:#FF4D5E;--libri:#6E9BEA;--film:#A987E0;--audio:#4CC08F;--kids:#F0B93A;--free:#4CC08F;--tag:#F0A04B;--warn:#F0A04B}}",
    ":root[data-theme=\"dark\"]{--bg:#12161E;--surface:#1B212C;--ink:#E8EBF0;--mute:#98A2B3;--line:#2A3240;--talk:#FF4D5E;--libri:#6E9BEA;--film:#A987E0;--audio:#4CC08F;--kids:#F0B93A;--free:#4CC08F;--tag:#F0A04B;--warn:#F0A04B}",
    "*,*::before,*::after{box-sizing:border-box}",
    "body{margin:0;background:var(--bg);color:var(--ink);font-family:\"IBM Plex Sans Condensed\",\"Arial Narrow\",system-ui,sans-serif;font-size:16px;line-height:1.35}",
    ".sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}",
    "header{padding:14px 16px 10px;border-bottom:3px solid var(--talk);display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end;justify-content:space-between}",
    "h1{margin:0;font-size:22px;line-height:1.1}h1 small{display:block;font-size:13px;color:var(--mute);font-weight:500}",
    "button{font:inherit;font-weight:600;border:1px solid var(--line);background:var(--surface);color:var(--ink);padding:8px 14px;border-radius:8px;cursor:pointer}",
    "button:focus-visible{outline:2px solid var(--libri);outline-offset:2px}",
    "main{max-width:760px;margin:0 auto;padding:12px 16px 40px}",
    ".summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:8px;margin:8px 0 16px}",
    ".sc{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:8px 10px}.sc b{display:block;font-size:20px}.sc span{font-size:13px;color:var(--mute)}.sc.warn b{color:var(--warn)}",
    ".pday h2{font-size:19px;margin:18px 0 8px;border-bottom:2px solid var(--ink);padding-bottom:3px}.pday h2 small{font-size:13px;color:var(--mute);font-weight:500}",
    ".taglist{background:var(--surface);border:1px solid var(--line);border-left:4px solid var(--tag);border-radius:8px;padding:8px 12px;margin:0 0 10px;font-size:14px}.taglist h3{margin:0 0 4px;font-size:14px;color:var(--tag);display:flex;gap:6px;align-items:center}.taglist ul{margin:0;padding-left:18px}",
    ".pitem{display:grid;grid-template-columns:62px 1fr;gap:10px;background:var(--surface);border:1px solid var(--line);border-left:4px solid var(--c);border-radius:8px;padding:8px 10px;margin:0 0 6px}",
    ".ptime{font-weight:700;font-size:15px}.pend{display:block;font-weight:500;color:var(--mute);font-size:13px}.ptitle{margin:0;font-size:16px;line-height:1.2}.pmeta{font-size:13px;color:var(--mute)}.pacc{margin-top:4px;display:flex;flex-wrap:wrap;gap:4px 8px;align-items:center;font-size:13px}.pnote{color:var(--mute)}",
    ".pgroup{border-left:4px solid var(--ink);padding:4px 0 2px 10px;margin:4px 0 10px}.plabel{font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;margin-bottom:4px}",
    ".acc{display:inline-flex;align-items:center;gap:3px;font-size:12px;font-weight:700;line-height:1;padding:3px 5px;border-radius:4px;white-space:nowrap}.ic{width:12px;height:12px;flex:none}",
    ".a-gratuito{color:var(--free);border:1px solid currentColor}.a-tagliando{background:var(--tag);color:#fff}.a-pagamento{background:var(--ink);color:var(--bg)}.a-sconosciuto{border:1px dashed var(--mute);color:var(--mute)}.mod{margin-left:1px}",
    ".foot{font-size:12.5px;color:var(--mute);margin-top:20px}.empty{padding:20px 0}",
    ".print{display:none}",
    "@page{size:A4;margin:14mm 12mm 14mm}",
    "@media print{body{background:#fff;color:#000;font-size:10.5pt}body>*:not(.print){display:none!important}.print{display:block}" + "__PRINTCSS__" + "}"
  ].join("\n");
  function saveStandalone() {
    var pg = programme();
    if (!pg.list.length) { toast("Seleziona almeno un evento prima di salvare."); return; }
    var body = '<header><h1>' + esc(FEST_FULL) + "<small>Il mio programma · salvato il " + todayIT() + "</small></h1>" +
      '<button type="button" onclick="window.print()">Stampa</button></header><main>' + progBodyHTML(pg, false) +
      '<p class="foot">Legenda: ~ fine stimata; * accesso modificato da te. Orari, accessi e tagliandi possono cambiare: verifica sempre sul sito ufficiale del festival.' +
      (P.meta && P.meta.updated ? " Dati aggiornati al " + esc(P.meta.updated) + "." : "") + "</p></main>" +
      '<div class="print">' + printHTML(pg) + "</div>";
    var html = "<!DOCTYPE html>\n<html lang=\"it\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">" +
      "<title>" + esc(FEST_FULL) + " · Il mio programma</title><style>\n" + SA_CSS.replace("__PRINTCSS__", PRINT_CSS) + "\n</style></head><body>" + body + "</body></html>\n";
    download(FILEBASE + "-mio-programma.html", html, "text/html;charset=utf-8");
    toast("File salvato: aprilo anche senza connessione, per esempio sul telefono.");
  }
  // Regole di stampa del programma: usate sia dalla pagina (iniettate all'avvio) sia dal file autonomo.
  var PRINT_CSS = [
    ".pr-day{break-before:page}.pr-day:first-child{break-before:auto}",
    ".pr-head{display:flex;justify-content:space-between;gap:12px;border-bottom:1.5pt solid #000;padding-bottom:3pt;margin-bottom:6pt;font-size:9.5pt}",
    ".pr-day h2{font-size:15pt;margin:4pt 0 6pt}",
    ".pr-tags{border:1pt solid #000;padding:4pt 6pt;margin:0 0 6pt;font-size:9.5pt}.pr-tags span{display:inline-block;margin-right:12pt}",
    ".pr-row{display:grid;grid-template-columns:7mm 25mm 1fr 62mm;gap:0 3mm;padding:3pt 0;line-height:1.25;border-bottom:.5pt solid #999;break-inside:avoid;align-items:start}",
    ".pr-th{font-weight:700;font-size:8.5pt;text-transform:uppercase;letter-spacing:.04em;border-bottom:1pt solid #000}",
    ".pr-box{width:4.2mm;height:4.2mm;border:1pt solid #000;margin-top:1pt}",
    ".pr-time{font-weight:700;white-space:nowrap}.pr-row small{font-size:8.5pt;line-height:1.2;display:inline-block}",
    ".pr-group{border-left:2.5pt solid #000;padding-left:2mm;margin:3pt 0;break-inside:avoid}.pr-group .pr-row{grid-template-columns:5mm 25mm 1fr 62mm}",
    ".pr-glabel{font-size:8pt;font-weight:700;text-transform:uppercase;letter-spacing:.05em;padding-top:2pt}",
    ".pr-foot{margin-top:8pt;font-size:8.5pt;border-top:.5pt solid #000;padding-top:3pt}",
    ".pr-empty{padding-top:30mm;text-align:center}"
  ].join("");

  /* ---------- avvio ---------- */
  (function () {
    var st = document.createElement("style");
    st.textContent = "@media print{" + PRINT_CSS + "}";
    document.head.appendChild(st);
  })();
  $("festTitle").textContent = FEST_FULL;
  document.title = FEST_FULL + " · planner";
  if (P.accessRules) {
    var rt2 = esc(P.accessRules).replace(/https?:\/\/[^\s<)]+/g, function (u) { return '<a href="' + u + '" target="_blank" rel="noopener">' + u + "</a>"; });
    $("rulesText").innerHTML = rt2 + (P.meta && P.meta.updated ? "<br><small>Dati aggiornati al " + esc(P.meta.updated) + ".</small>" : "");
    $("rules").hidden = false;
  }
  renderAll();
  readHash();
  window.addEventListener("hashchange", readHash);
})();
