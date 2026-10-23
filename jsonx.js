/*
 * jsonx.js — a tiny htmx-style framework for JSON APIs.
 *
 * The idea in one sentence:
 *   An HTML attribute says "when THIS happens, call THAT url, render the JSON
 *   with THIS EJS template, and put the HTML THERE."
 *
 *   <button jx-get="/api/todos"        <- which URL to call (and which HTTP method)
 *           jx-trigger="click"          <- which event starts it (optional)
 *           jx-template="#todo-list"    <- which EJS template turns JSON into HTML
 *           jx-target="#todos"          <- where the HTML goes (optional, default: this element)
 *           jx-swap="innerHTML">        <- how it goes in (optional, default: innerHTML)
 *
 * Web components: jsonx works inside shadow DOM (call jsonx.process(this.shadowRoot)),
 * listens for custom events, and can hand JSON straight to a component as a
 * property with jx-swap="prop:items" instead of rendering HTML.
 *
 * Requires EJS's browser build (ejs.min.js) to be loaded first, which gives us `window.ejs`.
 */
(function () {
  "use strict";

  var METHODS = ["get", "post", "put", "patch", "delete"];
  var SELECTOR = METHODS.map(function (m) { return "[jx-" + m + "]"; }).join(",");

  // Remember which elements already have listeners, so we never attach twice.
  var processed = new WeakSet();

  // Compiled templates are cached per "root" (the document, or a component's
  // shadow root), so each template is compiled only once.
  var templateCache = new WeakMap();

  // ---------------------------------------------------------------------------
  // 1. Finding elements and wiring up their events
  // ---------------------------------------------------------------------------

  // Look inside `root` for any element with a jx-get/jx-post/... attribute and wire it up.
  // `root` can be the document body, any element, or a web component's shadowRoot.
  function process(root) {
    root = root || document.body;
    var elements = Array.from(root.querySelectorAll(SELECTOR));
    if (root.matches && root.matches(SELECTOR)) elements.unshift(root);
    elements.forEach(wire);

    // Shadow roots are invisible to the page-level observer, so watch each one we're given.
    if (root instanceof ShadowRoot) watch(root);
  }

  function wire(el) {
    if (processed.has(el)) return;
    processed.add(el);

    // jx-trigger can list several triggers, separated by commas: "load, click".
    parseTriggers(el).forEach(function (trigger) {
      // "load" means: run once, right now.
      if (trigger.event === "load") {
        issueRequest(el);
        return;
      }

      // Usually we listen on the element itself. "from:#list" listens somewhere else.
      var source = findSource(el, trigger.from);
      var timer = null;

      // Any event name works here, including a web component's custom events
      // (e.g. jx-trigger="rating-changed").
      source.addEventListener(trigger.event, function (event) {
        // The element may have been removed from the page since we started listening.
        if (!el.isConnected) return;

        // Stop forms from reloading the page, and links from navigating.
        if (event.type === "submit" || el.tagName === "A") event.preventDefault();

        // "delay:300ms" waits until the events stop for 300ms (a debounce).
        clearTimeout(timer);
        if (trigger.delay > 0) {
          timer = setTimeout(function () { issueRequest(el); }, trigger.delay);
        } else {
          issueRequest(el);
        }
      });
    });
  }

  // Turns jx-trigger="input delay:300ms, jx:afterRender from:#list" into
  //   [{ event: "input", delay: 300 }, { event: "jx:afterRender", from: "#list" }]
  // With no jx-trigger we pick a sensible default for the element type.
  function parseTriggers(el) {
    var raw = el.getAttribute("jx-trigger");
    if (!raw) {
      if (el.tagName === "FORM") raw = "submit";
      else if (el.matches("input, select, textarea")) raw = "change";
      else raw = "click";
    }
    return raw.split(",").map(function (one) {
      var parts = one.trim().split(/\s+/);
      var trigger = { event: parts[0], delay: 0, from: null };
      parts.slice(1).forEach(function (p) {
        var delay = p.match(/^delay:(\d+)(ms|s)?$/);
        if (delay) trigger.delay = Number(delay[1]) * (delay[2] === "s" ? 1000 : 1);
        if (p.indexOf("from:") === 0) trigger.from = p.slice(5);
      });
      return trigger;
    });
  }

  // Where to listen for a trigger: the element itself, "document", "window",
  // or any CSS selector (looked up like jx-target).
  function findSource(el, from) {
    if (!from) return el;
    if (from === "document") return document;
    if (from === "window") return window;
    var source = el.getRootNode().querySelector(from) || document.querySelector(from);
    if (!source) throw new Error('[jsonx] jx-trigger "from:' + from + '" matched nothing');
    return source;
  }

  // Wire up elements that other code adds later (for example, a web component
  // rendering its own children) without anyone having to call process().
  function watch(root) {
    new MutationObserver(function (mutations) {
      mutations.forEach(function (m) {
        m.addedNodes.forEach(function (node) {
          if (node.nodeType === 1) process(node);
        });
      });
    }).observe(root, { childList: true, subtree: true });
  }

  // ---------------------------------------------------------------------------
  // 2. Making the request
  // ---------------------------------------------------------------------------

  function getMethodAndUrl(el) {
    for (var i = 0; i < METHODS.length; i++) {
      var url = el.getAttribute("jx-" + METHODS[i]);
      if (url !== null) return { method: METHODS[i].toUpperCase(), url: url };
    }
  }

  // Collects the values to send: the closest form's fields (or the element's own
  // name/value), plus anything in jx-vals='{"key": "value"}'.
  function collectValues(el) {
    var values = {};
    var form = el.tagName === "FORM" ? el : el.closest("form");
    var name = el.getAttribute("name");
    if (form) {
      // FormData also picks up form-associated custom elements.
      new FormData(form).forEach(function (value, key) { values[key] = value; });
    } else if (name && el.value !== undefined) {
      // Works for <input> and for any web component with a `value` property.
      values[name] = el.value;
    }
    var extra = el.getAttribute("jx-vals");
    if (extra) Object.assign(values, JSON.parse(extra));
    return values;
  }

  function issueRequest(el) {
    var info = getMethodAndUrl(el);
    var values = collectValues(el);
    var url = info.url;
    var options = { method: info.method, headers: { Accept: "application/json" } };

    // GET and DELETE put values in the query string; the others send a JSON body.
    if (info.method === "GET" || info.method === "DELETE") {
      var query = new URLSearchParams(values).toString();
      if (query) url += (url.indexOf("?") === -1 ? "?" : "&") + query;
    } else {
      options.headers["Content-Type"] = "application/json";
      options.body = JSON.stringify(values);
    }

    // Let page code inspect or cancel the request: listen for "jx:beforeRequest"
    // and call event.preventDefault() to stop it.
    if (!fire(el, "jx:beforeRequest", { url: url, options: options })) return;

    el.classList.add("jx-loading");

    return fetch(url, options)
      .then(function (response) {
        if (!response.ok) return failed(response, info.method + " " + url);
        // 204 No Content has no body, so we treat it as empty data.
        return response.status === 204 ? null : response.json();
      })
      .then(function (data) {
        render(el, data);
      })
      .catch(function (error) {
        console.error("[jsonx]", error);
        fire(el, "jx:error", { error: error });
      })
      .finally(function () {
        el.classList.remove("jx-loading");
      });
  }

  // Turns an error response into an Error. If the server sent JSON like
  // { "error": "Title is required" }, that message is used.
  function failed(response, what) {
    return response.json().catch(function () { return null; }).then(function (body) {
      var message = (body && (body.error || body.message)) || what + " failed with status " + response.status;
      var error = new Error(message);
      error.status = response.status;
      error.data = body;
      throw error;
    });
  }

  // ---------------------------------------------------------------------------
  // 3. Turning JSON into HTML and putting it on the page
  // ---------------------------------------------------------------------------

  function render(el, data) {
    var target = findTarget(el);
    var swap = el.getAttribute("jx-swap") || "innerHTML";

    // "prop:items" skips HTML entirely: it sets target.items = data.
    // This is the natural way to feed JSON to a web component.
    if (swap.indexOf("prop:") === 0) {
      target[swap.slice(5)] = data;
      fire(el, "jx:afterRender", { data: data, target: target });
      return;
    }

    // No template (or swap="none"/"delete") means "call the API, don't render anything".
    var html = "";
    var templateSelector = el.getAttribute("jx-template");
    if (templateSelector && swap !== "none" && swap !== "delete") {
      // Inside the template, the JSON is available as `data`.
      html = getTemplate(templateSelector, el)({ data: data });
    }

    // If the swap removes the element that made the request (say, a delete button
    // inside the row it deletes), we announce the result from the row's parent instead.
    var fallback = target.parentNode;

    var newContent = swapContent(target, html, swap);
    newContent.forEach(process); // new HTML might contain jx- attributes too

    var announcer = el.isConnected ? el : (fallback && fallback.isConnected ? fallback : document);
    fire(announcer, "jx:afterRender", { data: data, target: target, source: el });
  }

  // jx-target can be a CSS selector, "this", or "closest <selector>".
  // Selectors are looked up in the element's own root first: inside a web
  // component that's its shadow root, so "#list" means the component's #list.
  function findTarget(el) {
    var value = el.getAttribute("jx-target");
    if (!value || value === "this") return el;
    if (value.indexOf("closest ") === 0) return el.closest(value.slice(8));
    var target = el.getRootNode().querySelector(value) || document.querySelector(value);
    if (!target) throw new Error('[jsonx] jx-target "' + value + '" matched nothing');
    return target;
  }

  // Templates live in <script type="text/ejs" id="...">. (A <script> keeps its text
  // exactly as written; a <template> tag would mangle EJS's "<%" tags.)
  // We look in the element's own root first, then fall back to the main document,
  // so a component can ship its own templates or share the page's.
  function getTemplate(selector, el) {
    var root = el.getRootNode();
    var node = root.querySelector(selector);
    if (!node) { root = document; node = document.querySelector(selector); }
    if (!node) throw new Error('[jsonx] jx-template "' + selector + '" matched nothing');

    if (!templateCache.has(root)) templateCache.set(root, {});
    var cache = templateCache.get(root);
    if (!cache[selector]) {
      cache[selector] = ejs.compile(node.textContent, {
        // Lets one template use another: <%- include("#todo-item", { data: todo }) %>
        includer: function (includeSelector) {
          var inner = root.querySelector(includeSelector) || document.querySelector(includeSelector);
          if (!inner) throw new Error('[jsonx] include "' + includeSelector + '" matched nothing');
          return { template: inner.textContent };
        }
      });
    }
    return cache[selector];
  }

  // Puts `html` into the page. Returns the elements that are new, so we can wire them up.
  function swapContent(target, html, swap) {
    var fragment = document.createRange().createContextualFragment(html);
    var newNodes = Array.from(fragment.children);

    switch (swap) {
      case "innerHTML":   target.replaceChildren(fragment); break;
      case "outerHTML":   target.replaceWith(fragment); break;
      case "beforeend":   target.append(fragment); break;
      case "afterbegin":  target.prepend(fragment); break;
      case "beforebegin": target.before(fragment); break;
      case "afterend":    target.after(fragment); break;
      case "delete":      target.remove(); break;
      case "none":        break;
      default: throw new Error('[jsonx] unknown jx-swap "' + swap + '"');
    }
    return newNodes;
  }

  // Dispatches a custom DOM event. `composed: true` lets it escape a shadow root,
  // so page code can hear events from inside web components.
  // Returns false if a listener cancelled it.
  function fire(el, name, detail) {
    return el.dispatchEvent(new CustomEvent(name, {
      bubbles: true, cancelable: true, composed: true, detail: detail
    }));
  }

  // ---------------------------------------------------------------------------
  // 4. Start up
  // ---------------------------------------------------------------------------

  // A small public API, for page code and web components.
  window.jsonx = { process: process, request: issueRequest, render: render };

  function start() {
    process(document.body);
    watch(document.body);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
