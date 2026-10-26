/*
 * tutorial.js: this page's code panels. Not part of jsonx, and not needed in your app.
 *
 *   <pre data-example="name">  shows this page's own source between
 *                              <!-- example:name --> and <!-- /example:name -->
 *   <pre data-file="x.jx">     shows the file x.jx
 *
 * So what you read is exactly what runs.
 */
(function () {
  "use strict";

  function escapeHtml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // Colours {{values}}, jx: and on: attributes, <if>, <each> and other tags and comments.
  function highlight(text) {
    return escapeHtml(text)
      .replace(/(&lt;\/?)(jx-[\w-]+|else-if|if|else|each)(?=[\s&])/g, '$1<span class="hl-tag">$2</span>')
      .replace(/(\s)((?:jx|on|class):[\w.-]+)(?=[=\s&])/g, '$1<span class="hl-attr">$2</span>')
      .replace(/\{\{[^}]*\}\}/g, '<span class="hl-value">$&</span>')
      .replace(/&lt;!--[\s\S]*?--&gt;/g, '<span class="hl-comment">$&</span>')
      .replace(/(^|\n)(\s*)(\/\/[^\n]*)/g, '$1$2<span class="hl-comment">$3</span>');
  }

  function dedent(text) {
    var lines = text.replace(/^\s*\n/, "").replace(/\s+$/, "").split("\n");
    var indent = Math.min.apply(null, lines.filter(function (l) { return l.trim(); }).map(function (l) {
      return l.match(/^ */)[0].length;
    }));
    return lines.map(function (l) { return l.slice(indent); }).join("\n");
  }

  function fill(pre, text) {
    pre.innerHTML = "<code>" + highlight(dedent(text)) + "</code>";
  }

  function failed(pre) {
    pre.textContent = "(Open this page from a web server to see the code here.)";
  }

  fetch(location.href).then(function (r) { return r.text(); }).then(function (source) {
    document.querySelectorAll("pre[data-example]").forEach(function (pre) {
      var name = pre.getAttribute("data-example");
      var start = "<!-- example:" + name + " -->", end = "<!-- /example:" + name + " -->";
      var a = source.indexOf(start), b = source.indexOf(end);
      if (a !== -1 && b !== -1) fill(pre, source.slice(a + start.length, b));
    });
  }).catch(function () { document.querySelectorAll("pre[data-example]").forEach(failed); });

  document.querySelectorAll("pre[data-file]").forEach(function (pre) {
    fetch(pre.getAttribute("data-file")).then(function (r) { return r.text(); })
      .then(function (text) { fill(pre, text); })
      .catch(function () { failed(pre); });
  });
})();
