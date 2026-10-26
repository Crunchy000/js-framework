/*
 * tutorial.js — the page's helpers. Not part of jsonx, and not needed in your app.
 *
 *   1. Code panels: each example's code is copied from this page's own source,
 *      between <!-- example:name --> and <!-- /example:name -->, so what you read
 *      is exactly what runs.
 *   2. Data panels: they listen to jsonx's events and show each request, and the
 *      JSON that came back.
 *
 * This is a classic script at the end of <body>, so it runs before jsonx (a module).
 */
(function () {
  "use strict";

  function escapeHtml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // Colours {{values}}, jx: attributes and <jx-...> tags in escaped HTML.
  function highlight(html) {
    return escapeHtml(html)
      .replace(/(&lt;\/?)(jx-[\w-]+)/g, '$1<span class="hl-tag">$2</span>')
      .replace(/(\s)((?:jx|on|class):[\w.-]+)(=)/g, '$1<span class="hl-attr">$2</span>$3')
      .replace(/\{\{[^}]*\}\}/g, '<span class="hl-value">$&</span>')
      .replace(/&lt;!--[\s\S]*?--&gt;/g, '<span class="hl-comment">$&</span>');
  }

  function dedent(text) {
    var lines = text.replace(/^\s*\n/, "").replace(/\s+$/, "").split("\n");
    var indent = Math.min.apply(null, lines.filter(function (l) { return l.trim(); }).map(function (l) {
      return l.match(/^ */)[0].length;
    }));
    return lines.map(function (l) { return l.slice(indent); }).join("\n");
  }

  function showCode(source) {
    document.querySelectorAll("pre[data-example]").forEach(function (pre) {
      var name = pre.getAttribute("data-example");
      var start = "<!-- example:" + name + " -->", end = "<!-- /example:" + name + " -->";
      var a = source.indexOf(start), b = source.indexOf(end);
      if (a === -1 || b === -1) return;
      pre.innerHTML = "<code>" + highlight(dedent(source.slice(a + start.length, b))) + "</code>";
    });
  }

  // Snippets that aren't live: <script type="text/plain" class="snippet">.
  document.querySelectorAll("script.snippet").forEach(function (script) {
    var pre = document.createElement("pre");
    pre.className = "code";
    pre.innerHTML = "<code>" + highlight(dedent(script.textContent)) + "</code>";
    script.replaceWith(pre);
  });

  fetch(location.href).then(function (r) { return r.text(); }).then(showCode).catch(function () {
    document.querySelectorAll("pre[data-example]").forEach(function (pre) {
      pre.textContent = "(Open this page from a web server to see the code here.)";
    });
  });

  // ---------------------------------------------------------------------------
  // Data panels
  // ---------------------------------------------------------------------------

  function describe(el) {
    if (!el || !el.localName) return "the page";
    if (el.id) return "#" + el.id;
    var text = (el.textContent || "").trim().replace(/\s+/g, " ");
    if (el.localName === "button" && text) return "button “" + text.slice(0, 30) + "”";
    if (el.getAttribute && el.getAttribute("name")) return el.localName + ' name="' + el.getAttribute("name") + '"';
    return "<" + el.localName + ">";
  }

  function jsonHtml(value) {
    var text = JSON.stringify(value, null, 2);
    if (text === undefined) return '<span class="j-null">(nothing)</span>';
    return escapeHtml(text).replace(
      /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?)/g,
      function (all, str, colon, word, num) {
        if (str) return '<span class="' + (colon ? "j-key" : "j-str") + '">' + str + "</span>" + (colon || "");
        if (word) return '<span class="j-null">' + word + "</span>";
        return '<span class="j-num">' + num + "</span>";
      });
  }

  var pending = new WeakMap();

  function log(source, entry) {
    // Step out of shadow roots, so a request from inside a component logs too.
    var lesson = null, node = source;
    while (node && node.closest && !(lesson = node.closest(".lesson"))) {
      var root = node.getRootNode();
      node = root && root.host;
    }
    var panel = lesson && lesson.querySelector(".data-log");
    if (!panel) return;
    var item = document.createElement("div");
    item.className = "data-entry" + (entry.failed ? " failed" : "");
    var head = '<div class="data-head"><span class="method">' + escapeHtml(entry.method) + "</span> " +
      '<span class="url">' + escapeHtml(entry.url) + "</span>" +
      (entry.status ? ' <span class="status">' + entry.status + "</span>" : "") + "</div>";
    var meta = '<div class="data-meta">from ' + escapeHtml(describe(source)) +
      (entry.target ? ", drawn into " + escapeHtml(describe(entry.target)) : "") + "</div>";
    var sent = entry.body ? '<div class="data-label">Sent</div><pre>' + jsonHtml(JSON.parse(entry.body)) + "</pre>" : "";
    var got = '<div class="data-label">' + (entry.failed ? "Error answer" : "The view (JSON answer)") + "</div><pre>" + jsonHtml(entry.data) + "</pre>";
    item.innerHTML = head + meta + sent + got;
    var empty = panel.querySelector(".data-empty");
    if (empty) empty.remove();
    panel.prepend(item);
    while (panel.children.length > 4) panel.lastChild.remove();
  }

  document.addEventListener("jx:beforeRequest", function (event) {
    var o = event.detail.options;
    pending.set(event.target, { method: o.method, url: decodeURIComponent(event.detail.url), body: o.body || null });
  });

  document.addEventListener("jx:beforeRender", function (event) {
    var source = event.detail.source;
    var request = pending.get(source);
    pending.delete(source);
    var entry = request || (source.hasAttribute && source.hasAttribute("jx:data")
      ? { method: "—", url: "the variable " + source.getAttribute("jx:data") + " (jx:data)" }
      : { method: "—", url: "no request (jx:region draws with an empty view)" });
    entry.data = event.detail.data;
    entry.target = event.detail.target;
    // Wait a moment so the panel shows the view as it was drawn.
    log(source, entry);
  });

  // A function that returned nothing: no render, so log it here.
  document.addEventListener("jx:afterRender", function (event) {
    if (event.detail.target !== null) return;
    var request = pending.get(event.target);
    if (!request) return;
    pending.delete(event.target);
    request.data = undefined;
    log(event.target, request);
  });

  document.addEventListener("jx:error", function (event) {
    var source = event.target;
    var error = event.detail.error;
    var request = pending.get(source) || { method: "?", url: "" };
    pending.delete(source);
    request.failed = true;
    request.status = error.status;
    request.data = error.data;
    log(source, request);
  });

  // "Outline regions" switch.
  var toggle = document.getElementById("outline");
  if (toggle) {
    var apply = function () { document.body.classList.toggle("show-regions", toggle.checked); };
    toggle.addEventListener("change", apply);
    apply();
  }
})();
