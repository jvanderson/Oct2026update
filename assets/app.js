/* Beacon investor update engine. The content, map and photos arrive already decrypted from gate.js (BeaconApp.start).
   You should not need to edit this file.
   Model: swipeable cards -> tiles / map shapes -> ONE popup. No other pages or nesting.
   All text is inserted with textContent (never innerHTML). No network calls. */
window.BeaconApp = { start: function (U, M, PHOTOS) {
  "use strict";
  // U = the decrypted content object, M = the decrypted map data, PHOTOS = { "people/x.jpg": "data:image/jpeg;base64,..." }
  var SVGNS = "http://www.w3.org/2000/svg";
  var deck = document.getElementById("deck");
  var overlay = document.getElementById("overlay");
  var sheet = document.getElementById("sheet");
  var pager = document.getElementById("pager");
  var dotsEl = document.getElementById("dots");
  var labelEl = document.getElementById("pager-label");
  var hintEl = document.getElementById("swipe-hint");
  var prevBtn = document.getElementById("prev");
  var nextBtn = document.getElementById("next");
  var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var showAvatars = !(U.settings && U.settings.showAvatars === false);
  var lastFocus = null;
  var registry = {};      // popup id -> { modal, card index }
  var panels = [], dots = [];
  var cur = 0, ready = false, hintHidden = false;
  var dotHits = [];       // big invisible transit hit circles (sized in screen pixels)
  var mapSvg = null;

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function sv(tag, attrs, cls) {
    var e = document.createElementNS(SVGNS, tag);
    if (cls) e.setAttribute("class", cls);
    if (attrs) for (var k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }
  function host(url) { try { return new URL(url).hostname.replace(/^www\./, ""); } catch (e) { return url; } }
  function plain(t) { return String(t).replace(/\*\*|\{\{|\}\}/g, ""); }

  /* External-link icon (box with arrow), drawn with currentColor. Always >= 1.25em. */
  function icon() {
    var s = sv("svg", { viewBox: "0 0 24 24", "aria-hidden": "true", focusable: "false" }, "xicon");
    s.appendChild(sv("path", { d: "M14 3h7v7M21 3l-9.5 9.5M19 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5" }));
    return s;
  }
  function newTab() { return el("span", "sr-only", " (opens in a new tab)"); }
  function ext(a, url) { a.href = url; a.target = "_blank"; a.rel = "noopener noreferrer"; return a; }
  function inlineLink(text, url) {
    var a = ext(el("a", "inline-link"), url);
    a.appendChild(document.createTextNode(text));
    a.appendChild(document.createTextNode("\u00a0"));
    a.appendChild(icon());
    a.appendChild(newTab());
    return a;
  }
  // **bold** and {{link text}} (links to url) inline markup, built with DOM nodes (never innerHTML)
  function rich(parent, text, url) {
    function withLinks(into, str) {
      String(str).split(/(\{\{[^}]+\}\})/g).forEach(function (part) {
        if (!part) return;
        if (part.indexOf("{{") === 0 && url) into.appendChild(inlineLink(part.slice(2, -2), url));
        else into.appendChild(document.createTextNode(part.replace(/\{\{|\}\}/g, "")));
      });
    }
    String(text).split(/(\*\*[^*]+\*\*)/g).forEach(function (part) {
      if (!part) return;
      if (part.indexOf("**") === 0) { var b = el("b"); withLinks(b, part.slice(2, -2)); parent.appendChild(b); }
      else withLinks(parent, part);
    });
    return parent;
  }

  document.title = U.meta.pageTitle;
  document.getElementById("tag").textContent = U.meta.tag;

  /* ---------------- avatars ---------------- */
  function initialsOf(a) {
    if (a.initials) return a.initials;
    var w = String(a.author).replace(/^interview with\s+/i, "").split(/\s+/).filter(Boolean);
    if (!w.length) return "?";
    return (w[0].charAt(0) + (w.length > 1 ? w[w.length - 1].charAt(0) : "")).toUpperCase();
  }
  function avatar(a, idx, size) {
    if (!showAvatars) return null;
    var wrap = el("span", "av av" + (idx % 6) + (size === "lg" ? " av-lg" : ""));
    wrap.setAttribute("aria-hidden", "true");
    var ini = el("span", "av-ini", initialsOf(a));
    wrap.appendChild(ini);
    var photoSrc = a.photo ? (PHOTOS ? PHOTOS[a.photo] : a.photo) : "";
    if (photoSrc) {
      var img = el("img", "av-img");
      img.alt = String(a.author).replace(/^interview with\s+/i, ""); img.decoding = "async";
      img.addEventListener("load", function () { wrap.classList.add("has-photo"); });
      img.addEventListener("error", function () { img.remove(); });   // graceful fallback: initials stay
      img.src = photoSrc;
      wrap.appendChild(img);
    }
    return wrap;
  }

  /* ---------------- cards ---------------- */
  function cardShell(card, ci) {
    var sec = el("section", "page");
    sec.id = card.id;
    sec.setAttribute("aria-label", "Card " + (ci + 1) + " of " + U.cards.length + ": " + card.title);
    sec.setAttribute("data-card", ci);
    var inner = el("div", "inner");
    if (card.eyebrow) inner.appendChild(el("p", "eyebrow", card.eyebrow));
    var h = el("h1", null, card.headline);
    h.id = ci === 0 ? "main-h" : card.id + "-h";
    h.tabIndex = -1;
    inner.appendChild(h);
    if (card.sub) inner.appendChild(rich(el("p", "sub"), card.sub));
    sec.appendChild(inner);
    sec._inner = inner;
    return sec;
  }
  function addFooter(sec) { sec.appendChild(el("p", "footer", U.meta.footer)); }

  /* --- type "stats" --- */
  function buildStats(card, ci) {
    var sec = cardShell(card, ci);
    var tiles = el("div", "tiles");
    card.tiles.forEach(function (t) {
      registry[t.id] = { modal: t.modal, card: ci };
      var b = el("button", "tile");
      b.type = "button";
      b.setAttribute("aria-haspopup", "dialog");
      b.setAttribute("data-tile", t.id);
      // line 1: big number + bold label side by side (wraps gracefully when long); line 2: the sublabel
      var head = el("span", "thead");
      head.appendChild(el("span", "num " + t.color, t.num));
      head.appendChild(el("b", "tlab", t.label));
      b.appendChild(head);
      if (t.sublabel) b.appendChild(el("span", "tsub", t.sublabel));
      b.appendChild(el("span", "chev"));
      b.addEventListener("click", function () { openItem(t.id, true, b); });
      tiles.appendChild(b);
    });
    sec._inner.appendChild(tiles);
    sec._inner.appendChild(el("p", "hint hint-stats", "Tap any box for detail"));
    addFooter(sec);
    return sec;
  }

  /* --- type "articles" --- */
  function buildArticles(card, ci) {
    var sec = cardShell(card, ci);
    var tiles = el("div", "tiles atiles");
    card.articles.forEach(function (a, idx) {
      var id = "article-" + a.id;
      registry[id] = {
        card: ci,
        modal: {
          title: a.title,
          author: { a: a, idx: idx },
          blocks: [{ type: "summary", text: a.summary }, { type: "implication", text: a.implication }],
          linksLabel: "",
          links: [{ action: "Read the article", url: a.url, btn: true, source: host(a.url) }]
        }
      };
      var b = el("button", "tile atile");
      b.type = "button";
      b.setAttribute("aria-haspopup", "dialog");
      b.setAttribute("data-tile", id);
      b.appendChild(el("span", "atitle", a.title));
      var who = el("span", "who");
      var av = avatar(a, idx, "sm"); if (av) who.appendChild(av);
      var txt = el("span", "whotxt");
      txt.appendChild(el("span", "aname", a.author));
      txt.appendChild(el("span", "arole", a.role));
      who.appendChild(txt);
      b.appendChild(who);
      b.appendChild(el("span", "chev"));
      b.addEventListener("click", function () { openItem(id, true, b); });
      tiles.appendChild(b);
    });
    sec._inner.appendChild(tiles);
    sec._inner.appendChild(el("p", "hint", "Tap any article for the summary"));
    addFooter(sec);
    return sec;
  }

  /* --- type "map" --- */
  function buildMap(card, ci) {
    var sec = cardShell(card, ci);
    var inner = sec._inner;
    var statusById = {}, regionByState = {};
    card.statuses.forEach(function (s) { statusById[s.id] = s; });
    card.regions.forEach(function (r) { regionByState[r.state] = r; });

    var vb = M.viewBox;
    var wrap = el("div", "map-wrap");
    var svg = sv("svg", { viewBox: vb.join(" "), role: "group", focusable: "false",
      "aria-label": "Map of the United States. Colored states and orange transit agency dots open a short summary." }, "map");
    mapSvg = svg;
    var gStates = sv("g"), gDotHit = sv("g"), gLive = sv("g"), gHit = sv("g"), gLeaders = sv("g"), gCalls = sv("g"), gDots = sv("g");
    // layer order (bottom to top): grey states, big transit hit circles, colored states, small-state tap areas, ... visible dots
    [gStates, gDotHit, gLive, gHit, gLeaders, gCalls, gDots].forEach(function (g) { svg.appendChild(g); });

    var abbrs = Object.keys(M.states).sort();
    var shapes = {};
    abbrs.filter(function (a) { return !regionByState[a]; }).concat(abbrs.filter(function (a) { return regionByState[a]; })).forEach(function (a) {
      var r = regionByState[a], s = M.states[a];
      if (!r) { gStates.appendChild(sv("path", { d: s.d }, "st")); return; }
      var st = statusById[r.status];
      var id = "state-" + a.toLowerCase();
      registry[id] = { card: ci, modal: { kicker: s.name, title: r.title, badge: { label: st.badge, color: st.color }, blocks: [{ type: "p", text: r.text }] } };
      var p = sv("path", { d: s.d, tabindex: "0", role: "button",
        "aria-label": r.title + ", " + st.badge + ". Open summary.", "aria-haspopup": "dialog", "data-state": a }, "st live " + st.color);
      var t = sv("title"); t.textContent = r.title + " \u00b7 " + st.badge; p.appendChild(t);
      wire(p, id, p);
      gLive.appendChild(p);
      shapes[a] = { el: p, id: id, status: st };
    });

    var calloutSet = {}; (card.callouts || []).forEach(function (a) { calloutSet[a] = 1; });
    Object.keys(shapes).forEach(function (a) {
      var bb = M.states[a].b, w = bb[2] - bb[0], h = bb[3] - bb[1];
      shapes[a].cx = (bb[0] + bb[2]) / 2; shapes[a].cy = (bb[1] + bb[3]) / 2;
      var small = Math.min(w, h) < 40 || w * h < 5000;
      if (small || calloutSet[a]) {
        var hit = sv("path", { d: M.states[a].d, "aria-hidden": "true", "data-hit": a }, "hit");
        wire(hit, shapes[a].id, shapes[a].el, shapes[a].el);
        gHit.appendChild(hit);
      }
    });
    Object.keys(calloutSet).forEach(function (a) {
      var sh = shapes[a], pos = M.callouts[a];
      if (!sh || !pos) return;
      gLeaders.appendChild(sv("line", { x1: pos[0], y1: pos[1], x2: sh.cx, y2: sh.cy }, "leader"));
      var g = sv("g", { "aria-hidden": "true", "data-callout": a }, "callout " + sh.status.color);
      g.appendChild(sv("circle", { cx: pos[0], cy: pos[1], r: 44 }));
      var tx = sv("text", { x: pos[0], y: pos[1], "text-anchor": "middle", "dominant-baseline": "central" });
      tx.textContent = a; g.appendChild(tx);
      wire(g, sh.id, sh.el, sh.el);
      gCalls.appendChild(g);
    });

    // transit dots: visible dot (20% smaller by area than v4: r 17 -> 15.2) with a small tap area on top, plus a big
    // (44px) invisible hit circle placed BELOW the colored states. So a tap on a state (any state next to a dot)
    // opens that state; the 44px circle only wins over grey map areas and ocean around the dot.
    card.transit.forEach(function (t) {
      var xy = M.cities[t.city];
      if (!xy) { if (window.console) console.warn("Unknown map city: " + t.city); return; }
      var id = "transit-" + t.id;
      registry[id] = { card: ci, modal: { kicker: t.place || t.city, title: t.name, badge: { label: card.transitBadge, color: "orange" }, blocks: [{ type: "p", text: t.text }] } };
      var g = sv("g", { tabindex: "0", role: "button", "aria-haspopup": "dialog", "data-transit": t.id,
        "aria-label": t.name + " (" + (t.place || t.city) + "), " + card.transitBadge + ". Open summary." }, "dot");
      var ti = sv("title"); ti.textContent = t.name + " \u00b7 " + card.transitBadge; g.appendChild(ti);
      g.appendChild(sv("circle", { cx: xy[0], cy: xy[1], r: t.tapR || 24 }, "dhit"));
      g.appendChild(sv("circle", { cx: xy[0], cy: xy[1], r: Math.max(t.tapR || 24, 20) }, "dring"));
      g.appendChild(sv("circle", { cx: xy[0], cy: xy[1], r: 15.2 }, "dvis"));
      wire(g, id, g);
      gDots.appendChild(g);
      var big = sv("circle", { cx: xy[0], cy: xy[1], r: 40, "aria-hidden": "true" }, "dhitbig");
      wire(big, id, g, g);
      gDotHit.appendChild(big);
      dotHits.push(big);
    });

    wrap.appendChild(svg);
    inner.appendChild(wrap);

    var leg = el("ul", "legend");
    card.statuses.forEach(function (s) {
      var li = el("li"); li.appendChild(el("span", "sw " + s.color)); li.appendChild(document.createTextNode(s.legend)); leg.appendChild(li);
    });
    var lt = el("li"); lt.appendChild(el("span", "sw dotsw orange")); lt.appendChild(document.createTextNode(card.transitLegend)); leg.appendChild(lt);
    inner.appendChild(leg);
    inner.appendChild(el("p", "hint", "Tap a state or a dot for detail"));

    if (card.stage) {
      var st2 = el("section", "stage");
      st2.setAttribute("aria-labelledby", card.id + "-stage-h");
      var sh = el("h2", "eyebrow stage-h", card.stage.label); sh.id = card.id + "-stage-h";
      st2.appendChild(sh);
      var ul = el("ul", "stage-list");
      card.stage.items.forEach(function (it) {
        var li = el("li");
        rich(li, it.text, it.url);
        ul.appendChild(li);
      });
      st2.appendChild(ul);
      inner.appendChild(st2);
    }
    addFooter(sec);
    return sec;
  }

  // Transit hit circles are sized in SCREEN pixels so the effective tap target is always >= 44px.
  function sizeDotHits() {
    if (!mapSvg || !dotHits.length) return;
    var w = mapSvg.getBoundingClientRect().width;
    if (!w) return;
    var r = 22 / (w / M.viewBox[2]);
    dotHits.forEach(function (c) { c.setAttribute("r", r.toFixed(1)); });
  }

  function wire(node, id, hoverEl, returnEl) {
    node.addEventListener("click", function () { openItem(id, true, returnEl || node); });
    node.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openItem(id, true, returnEl || node); }
    });
    node.addEventListener("mouseenter", function () { hoverEl.classList.add("hover"); });
    node.addEventListener("mouseleave", function () { hoverEl.classList.remove("hover"); });
  }

  var builders = { stats: buildStats, map: buildMap, articles: buildArticles };
  U.cards.forEach(function (card, ci) {
    var sec = builders[card.type](card, ci);
    deck.appendChild(sec);
    panels.push(sec);
  });

  /* ---------------- swipe navigation (CSS scroll-snap) ---------------- */
  var n = U.cards.length;
  U.cards.forEach(function (card, ci) {
    var b = el("button", "dotbtn");
    b.type = "button";
    b.setAttribute("aria-label", "Go to card " + (ci + 1) + " of " + n + ": " + card.title);
    b.appendChild(el("span", "pip"));
    b.addEventListener("click", function () { userNav(ci); });
    dotsEl.appendChild(b);
    dots.push(b);
  });
  pager.hidden = n < 2;

  function setCur(i) {
    cur = i;
    panels.forEach(function (p, k) {
      var off = k !== i;
      if ("inert" in p) p.inert = off;          // off-screen cards: not focusable, hidden from screen readers
      if (off) p.setAttribute("aria-hidden", "true"); else p.removeAttribute("aria-hidden");
    });
    dots.forEach(function (d, k) {
      if (k === i) d.setAttribute("aria-current", "true"); else d.removeAttribute("aria-current");
    });
    labelEl.textContent = "Card " + (i + 1) + " of " + n;
    prevBtn.setAttribute("aria-disabled", i === 0 ? "true" : "false");
    nextBtn.setAttribute("aria-disabled", i === n - 1 ? "true" : "false");
    if (ready) { try { history.replaceState(history.state, "", "#" + U.cards[i].id); } catch (e) {} }
  }
  function scrollToCard(i, smooth) {
    var w = deck.clientWidth;
    if (!w) return;
    deck.scrollTo({ left: i * w, top: 0, behavior: (smooth && !reduced) ? "smooth" : "auto" });
  }
  function goTo(i, smooth) {
    i = Math.max(0, Math.min(n - 1, i));
    setCur(i);
    scrollToCard(i, smooth);
  }
  function hideHint() {
    if (hintHidden) return;
    hintHidden = true;
    hintEl.classList.add("gone");
    var first = panels[0] && panels[0].querySelector(".inner");
    if (first) first.classList.remove("nudge");
    window.setTimeout(function () { hintEl.hidden = true; }, 700);
  }
  function userNav(i) { hideHint(); goTo(i, true); }

  prevBtn.addEventListener("click", function () { userNav(cur - 1); });
  nextBtn.addEventListener("click", function () { userNav(cur + 1); });

  var raf = 0;
  deck.addEventListener("scroll", function () {
    if (raf) return;
    raf = window.requestAnimationFrame(function () {
      raf = 0;
      var w = deck.clientWidth;
      if (!w) return;
      var i = Math.max(0, Math.min(n - 1, Math.round(deck.scrollLeft / w)));
      if (i !== cur) { setCur(i); if (ready) hideHint(); }
    });
  }, { passive: true });

  var lastW = 0;
  function realign() {
    var w = deck.clientWidth;
    if (w && w !== lastW) { lastW = w; scrollToCard(cur, false); }
    sizeDotHits();
  }
  if (window.ResizeObserver) {
    var ro = new ResizeObserver(realign);
    ro.observe(deck);
    if (mapSvg) ro.observe(mapSvg);
  }
  window.addEventListener("resize", realign);
  // the page itself never scrolls (only the cards do); undo any scroll caused by focus/scrollIntoView so the arrows stay put
  function pin() { if (document.body.scrollTop) document.body.scrollTop = 0; if (document.documentElement.scrollTop) document.documentElement.scrollTop = 0; }
  document.body.addEventListener("scroll", pin, { passive: true });
  window.addEventListener("scroll", pin, { passive: true });

  document.addEventListener("keydown", function (e) {
    if (!overlay.hidden || e.altKey || e.ctrlKey || e.metaKey) return;
    var t = e.target, tag = t && t.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    if (e.key === "ArrowRight") { e.preventDefault(); userNav(cur + 1); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); userNav(cur - 1); }
  });

  /* ---------------- popup ---------------- */
  function renderBlock(b, body) {
    var node;
    if (b.type === "p") {
      body.appendChild(rich(el("p"), b.text));
    } else if (b.type === "summary") {
      node = el("div", "sum");
      node.appendChild(el("p", "glabel", "SUMMARY"));
      node.appendChild(rich(el("p"), b.text));
      body.appendChild(node);
    } else if (b.type === "implication") {
      node = el("div", "impl");
      node.appendChild(el("p", "glabel", "BEACON IMPLICATION"));
      node.appendChild(rich(el("p"), b.text));
      body.appendChild(node);
    } else if (b.type === "quote") {
      node = el("blockquote", "quote");
      node.appendChild(rich(el("p"), "\u201c" + b.text + "\u201d"));
      if (b.by) node.appendChild(el("cite", null, b.by));
      body.appendChild(node);
    } else if (b.type === "stats") {
      node = el("div", "stats");
      b.items.forEach(function (s) {
        var d = el("div", "stat");
        d.appendChild(el("span", "snum", s.num));
        d.appendChild(el("span", "slab", s.label));
        node.appendChild(d);
      });
      body.appendChild(node);
    } else if (b.type === "group") {
      node = el("div", "group " + (b.color || "teal"));
      node.appendChild(el("p", "glabel", b.label));
      var chips = el("div", "chips");
      b.names.forEach(function (nm) { chips.appendChild(el("span", "chip", nm)); });
      node.appendChild(chips);
      if (b.note) node.appendChild(el("p", "gnote", b.note));
      body.appendChild(node);
    } else if (b.type === "list") {
      if (b.label) body.appendChild(el("p", "glabel listlabel", b.label));
      node = el("ul");
      b.items.forEach(function (i) { node.appendChild(rich(el("li"), i)); });
      body.appendChild(node);
    }
  }

  function renderLink(l, wrap) {
    var a = ext(el("a", l.btn ? "btn-link" : "link"), l.url);
    if (l.btn) {
      a.appendChild(el("span", "btxt", l.action || "Open link"));
      a.appendChild(icon());
      a.appendChild(newTab());
      wrap.appendChild(a);
      if (l.source) wrap.appendChild(el("p", "lsrc2", "Opens " + l.source + " in a new tab"));
      return;
    }
    // Link card: the card itself is NOT clickable (no underline on the title); only the button is the link.
    var card = el("div", "linkcard");
    card.appendChild(el("p", "ltitle", l.label));
    if (l.source) card.appendChild(el("p", "lsrc", l.source));
    var b = ext(el("a", "btn-link"), l.url);
    b.appendChild(el("span", "btxt", l.action || "Open link"));
    b.appendChild(icon());
    b.appendChild(el("span", "sr-only", ": " + l.label + " (opens in a new tab)"));
    card.appendChild(b);
    wrap.appendChild(card);
  }

  function openItem(id, push, returnEl) {
    var it = registry[id];
    if (!it) return;
    var m = it.modal, body = document.getElementById("sheet-body");
    lastFocus = returnEl || document.activeElement;
    if (it.card !== cur) { setCur(it.card); scrollToCard(it.card, false); }
    document.getElementById("sheet-kicker").textContent = m.kicker || "";
    document.getElementById("sheet-title").textContent = m.title;
    body.textContent = "";
    if (m.badge) body.appendChild(el("p", "badge " + m.badge.color, m.badge.label));
    if (m.author) {
      var ab = el("div", "authorblock");
      var av = avatar(m.author.a, m.author.idx, "lg"); if (av) ab.appendChild(av);
      var at = el("div", "whotxt");
      at.appendChild(el("span", "aname", m.author.a.author));
      at.appendChild(el("span", "arole", m.author.a.role));
      ab.appendChild(at);
      body.appendChild(ab);
    }
    m.blocks.forEach(function (b) { renderBlock(b, body); });
    if (m.links && m.links.length) {
      var wrap = el("div", "links");
      var ll = m.linksLabel === undefined ? "LEARN MORE" : m.linksLabel;
      if (ll) wrap.appendChild(el("p", "glabel", ll));
      m.links.forEach(function (l) { renderLink(l, wrap); });
      body.appendChild(wrap);
    }
    overlay.hidden = false;
    document.documentElement.classList.add("modal-open");
    sheet.scrollTop = 0;
    sheet.focus();
    if (push) { try { history.pushState({ tile: id }, "", "#" + id); } catch (e) {} }
  }

  function closeItem(fromPop) {
    if (overlay.hidden) return;
    overlay.hidden = true;
    document.documentElement.classList.remove("modal-open");
    if (!fromPop && history.state && history.state.tile) { try { history.back(); } catch (e) {} }
    if (lastFocus && lastFocus.focus) { try { lastFocus.focus({ preventScroll: true }); } catch (e) {} }
  }

  document.getElementById("close").addEventListener("click", function () { closeItem(false); });
  overlay.addEventListener("click", function (e) { if (e.target === overlay) closeItem(false); });
  window.addEventListener("popstate", function () {
    if (history.state && history.state.tile) openItem(history.state.tile, false);
    else closeItem(true);
  });
  document.addEventListener("keydown", function (e) {
    if (overlay.hidden) return;
    if (e.key === "Escape") { e.preventDefault(); closeItem(false); return; }
    if (e.key === "Tab") { // keep focus inside the popup
      var f = sheet.querySelectorAll("a[href],button");
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === sheet)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });

  /* ---------------- start ---------------- */
  setCur(0);
  var h0 = location.hash.slice(1), startCard = 0, startItem = null;
  if (h0) {
    var ci0 = U.cards.map(function (c) { return c.id; }).indexOf(h0);
    if (ci0 >= 0) startCard = ci0;
    else if (registry[h0]) { startCard = registry[h0].card; startItem = h0; }
  }
  setCur(startCard);
  lastW = deck.clientWidth; scrollToCard(startCard, false);
  if (startCard === 0 && !reduced && n > 1) panels[0].querySelector(".inner").classList.add("nudge");
  if (startCard !== 0) { hintHidden = false; }
  ready = true;
  window.setTimeout(hideHint, 7000);   // the swipe hint floats above the pager and fades by itself
  sizeDotHits();
  if (startItem) openItem(startItem, false);
} };
