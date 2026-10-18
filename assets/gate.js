/* Beacon Investor Update - password gate + decryption (Card 0).
   Everything investors see (text, map, photos) is stored ENCRYPTED in assets/payload.js (AES-256-GCM, key from the
   password via PBKDF2-SHA256). This file derives the key from the typed password, decrypts in the browser with WebCrypto,
   and hands the result to BeaconApp.start() (app.js). A wrong password fails GCM authentication, so nothing is shown.
   To change the password, rebuild:  node tools/build-encrypted.js   (see README.txt). Needs https:// or localhost
   (or file:// in Chrome); it will say so if the browser doesn't offer WebCrypto. */
(function () {
  "use strict";
  var P = window.BEACON_PAYLOAD;
  var KEY = "beacon-session-key";   // the DERIVED key (never the password), kept only for this browser tab session
  var root = document.documentElement;
  var subtle = window.crypto && window.crypto.subtle;
  var enc = new TextEncoder(), dec = new TextDecoder();

  function b64(s) { var bin = atob(s), u = new Uint8Array(bin.length), i; for (i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }
  function b64e(buf) { var u = new Uint8Array(buf), s = "", i; for (i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s); }

  function decryptWith(key) {
    return subtle.decrypt({ name: "AES-GCM", iv: b64(P.iv), tagLength: 128 }, key, b64(P.ct)).then(function (pt) {
      return JSON.parse(dec.decode(pt));
    });
  }
  function derive(password) {
    return subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]).then(function (base) {
      return subtle.deriveKey({ name: "PBKDF2", salt: b64(P.salt), iterations: P.iter, hash: "SHA-256" }, base,
        { name: "AES-GCM", length: 256 }, true, ["decrypt"]);
    });
  }
  function launch(data) {
    root.removeAttribute("data-locked");
    var g = document.getElementById("gate"); if (g) g.remove();
    window.BeaconApp.start(data.update, data.map, data.photos || {});
    var h = document.getElementById("main-h"); if (h && h.focus) h.focus();
  }

  function build() {
    var g = document.createElement("div");
    g.id = "gate";
    g.setAttribute("role", "dialog"); g.setAttribute("aria-modal", "true"); g.setAttribute("aria-labelledby", "gate-h");
    g.innerHTML = '<form id="gate-form" autocomplete="off"><img src="assets/logo.png" alt="Beacon" width="160">' +
      '<h1 id="gate-h">Investor Update &middot; 3Q26</h1><p>Confidential. Please enter the password you were given.</p>' +
      '<label for="gate-pw">Password</label><input id="gate-pw" type="password" autocomplete="off" required>' +
      '<p id="gate-err" role="alert" hidden>That password did not match. Please try again.</p>' +
      '<button type="submit">View update</button></form>';
    document.body.appendChild(g);
    var f = document.getElementById("gate-form"), pw = document.getElementById("gate-pw"),
        err = document.getElementById("gate-err"), btn = f.querySelector("button");
    pw.focus();
    if (!subtle || !P) {
      err.textContent = "This page needs a secure connection (https://) to unlock. Please open the link from the address you were sent.";
      err.hidden = false; btn.disabled = true; return;
    }
    f.addEventListener("submit", function (e) {
      e.preventDefault();
      err.hidden = true; btn.disabled = true; btn.textContent = "Checking\u2026";
      var typed = pw.value.trim(), key;
      derive(typed).then(function (k) { key = k; return decryptWith(k); }).then(function (data) {
        subtle.exportKey("raw", key).then(function (raw) { try { sessionStorage.setItem(KEY, b64e(raw)); } catch (x) {} });
        launch(data);
      }, function () {
        err.textContent = "That password did not match. Please try again.";
        err.hidden = false; pw.value = ""; pw.focus();
        btn.disabled = false; btn.textContent = "View update";
      });
    });
  }
  function init() {
    // reopening in the same tab session: reuse the derived key, so the password is not asked for again
    var saved = null;
    try { saved = sessionStorage.getItem(KEY); } catch (e) {}
    if (saved && subtle && P) {
      subtle.importKey("raw", b64(saved), { name: "AES-GCM" }, false, ["decrypt"]).then(decryptWith).then(launch, function () {
        try { sessionStorage.removeItem(KEY); } catch (e) {}
        build();
      });
    } else build();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
