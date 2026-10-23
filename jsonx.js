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
 * Regions: an element with jx-template is a "region". Buttons inside it don't need
 * jx-target or jx-template: their results re-render the region, and each request
 * sends the region's named controls, like a form would. Pair this with an API that
 * returns the whole view as JSON and most pages need only jx-get/jx-post.
 *
 * Web components: jsonx works inside shadow DOM (call jsonx.process(this.shadowRoot)),
 * listens for custom events, and can hand JSON straight to a component as a
 * property with jx-swap="prop:items" instead of rendering HTML.
 *
 * Templates: load EJS (ejs.min.js) for <script type="text/ejs"> templates, or Mustache
 * (mustache.min.js) for <script type="text/mustache">, before jsonx. Other engines
 * can be added with jsonx.engine(type, compile).
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

    // A web component's tag can appear before its code has loaded (Web Awesome
    // loads components on demand). We can only tell what kind of element it is
    // once it's defined, so wait for that first.
    var tag = el.localName;
    if (tag.indexOf("-") !== -1 && !customElements.get(tag)) {
      customElements.whenDefined(tag).then(function () { attachTriggers(el); });
    } else {
      attachTriggers(el);
    }
  }

  function attachTriggers(el) {
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
        if (trigger.filter && String(event[trigger.filter.property]) !== trigger.filter.value) return;

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

  // The trigger you get when you don't write one, based on what the element is:
  //   <form>                                        -> submit
  //   <button>, <a>, and buttons like <wa-button>   -> click
  //   inputs, and form controls like <wa-checkbox>  -> change
  //   anything else (<div>, <ul>, <wa-card>, ...)   -> load
  // The idea: things you click get "click", things you change get "change",
  // and things you can't interact with just fill themselves in.
  function defaultTrigger(el) {
    if (el.tagName === "FORM") return "submit";
    if (el.matches("button, a, [role=button]") || /-button$/.test(el.localName)) return "click";
    if (el.matches("input, select, textarea") || el.constructor.formAssociated) return "change";
    return "load";
  }

  // Turns jx-trigger="input delay:300ms, jx:afterRender from:#list" into
  //   [{ event: "input", delay: 300 }, { event: "jx:afterRender", from: "#list" }]
  //
  // Writing a trigger for the element itself replaces the default.
  // Triggers with "from:" listen to *other* elements, so they're added on top of
  // the default instead: jx-trigger="change from:#filter" on a <ul> still loads.
  function parseTriggers(el) {
    var raw = el.getAttribute("jx-trigger") || "";
    var triggers = raw.split(",").filter(function (one) { return one.trim(); }).map(function (one) {
      var parts = one.trim().split(/\s+/);
      var trigger = { event: parts[0], delay: 0, from: null, filter: null };

      // "keydown[key=Enter]" only fires when event.key is "Enter".
      var filter = parts[0].match(/^(.+)\[(\w+)=([^\]]+)\]$/);
      if (filter) {
        trigger.event = filter[1];
        trigger.filter = { property: filter[2], value: filter[3] };
      }
      parts.slice(1).forEach(function (p) {
        var delay = p.match(/^delay:(\d+)(ms|s)?$/);
        if (delay) trigger.delay = Number(delay[1]) * (delay[2] === "s" ? 1000 : 1);
        if (p.indexOf("from:") === 0) trigger.from = p.slice(5);
      });
      return trigger;
    });

    var hasOwnTrigger = triggers.some(function (t) { return !t.from; });
    if (!hasOwnTrigger) triggers.unshift({ event: defaultTrigger(el), delay: 0, from: null, filter: null });
    return triggers;
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

  // Collects the values to send, in this order (later ones win):
  //   1. every named control in the element's region (or its <form>), like a form would
  //   2. the element's own name and value
  //   3. the values of any elements in jx-include="#a, #b"
  //   4. anything in jx-vals='{"key": "value"}'
  function collectValues(el) {
    var values = {};
    var form = el.tagName === "FORM" ? el : el.closest("form");
    var region = form || findRegion(el);
    if (region) addValues(values, region);
    if (region !== el) addValues(values, el);

    var include = el.getAttribute("jx-include");
    if (include) {
      var root = el.getRootNode();
      var found = root.querySelectorAll(include);
      if (!found.length) found = document.querySelectorAll(include);
      found.forEach(function (other) { addValues(values, other); });
    }

    var extra = el.getAttribute("jx-vals");
    if (extra) Object.assign(values, JSON.parse(extra));
    return values;
  }

  // Adds values from one element: every field if it's a form, every named control
  // inside it if it's a region, otherwise just its own name and value.
  function addValues(values, el) {
    if (el.tagName === "FORM") {
      // FormData also picks up form-associated custom elements.
      new FormData(el).forEach(function (value, key) { values[key] = value; });
      return;
    }
    if (el.hasAttribute("jx-template")) {
      el.querySelectorAll("[name]").forEach(function (control) { addValue(values, control); });
    }
    addValue(values, el);
  }

  // Works for <input> and for any web component with a `value` property.
  function addValue(values, el) {
    var name = el.getAttribute("name");
    if (!name || el.value === undefined || el.value === null || el.disabled) return;
    if ((el.type === "checkbox" || el.type === "radio") && !el.checked) return;
    values[name] = el.value;
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

  // A "region" is the nearest element (the element itself, or one of its parents)
  // that has a jx-template. A button inside a region doesn't need its own
  // jx-target or jx-template: its result re-renders the whole region.
  function findRegion(el) {
    return el.closest("[jx-template]");
  }

  function render(el, data) {
    var region = findRegion(el);
    var target = el.hasAttribute("jx-target") ? findTarget(el) : (region || el);
    var swap = el.getAttribute("jx-swap") ||
      (target === region && region.getAttribute("jx-swap")) || defaultSwap();

    // "prop:items" skips HTML entirely: it sets target.items = data.
    // This is the natural way to feed JSON to a web component.
    if (swap.indexOf("prop:") === 0) {
      target[swap.slice(5)] = data;
      fire(el, "jx:afterRender", { data: data, target: target });
      return;
    }

    // No template (or swap="none"/"delete") means "call the API, don't render anything".
    var html = "";
    var templateSelector = el.getAttribute("jx-template") || (region && region.getAttribute("jx-template"));
    if (templateSelector && swap !== "none" && swap !== "delete") {
      html = getTemplate(templateSelector, el)(data);
    }

    // If the swap removes the element that made the request (say, a delete button
    // inside the row it deletes), we announce the result from the row's parent instead.
    var fallback = target.parentNode;

    var newContent = swapContent(target, html, swap);
    newContent.forEach(process); // new HTML might contain jx- attributes too

    // Re-rendering loses keyboard focus, so put it back on anything marked autofocus.
    newContent.forEach(function (node) {
      var focus = node.matches("[autofocus]") ? node : node.querySelector("[autofocus]");
      if (focus) setTimeout(function () { focus.focus(); });
    });

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

  // ---------------------------------------------------------------------------
  // Template engines
  // ---------------------------------------------------------------------------
  //
  // Templates live in <script type="text/<engine>" id="...">, and the type picks
  // the engine: type="text/ejs" uses EJS, type="text/mustache" uses Mustache.
  // (A <script> keeps its text exactly as written; a <template> tag would mangle
  // tags like EJS's "<%".)
  //
  // An engine is one function: compile(text, lookup) returns render(data) -> html.
  // `lookup(name)` finds another template's text, for includes and partials.
  // Add your own with jsonx.engine("text/handlebars", function (text, lookup) { ... }).
  var engines = {};

  function engine(type, compile) {
    engines[type] = compile;
  }

  // EJS: the JSON is available as `data`, and templates can include each other:
  //   <%- include("#todo-item", { data: todo }) %>
  engine("text/ejs", function (text, lookup) {
    var render = window.ejs.compile(text, {
      includer: function (name) { return { template: lookup(name) }; }
    });
    return function (data) { return render({ data: data }); };
  });

  // Mustache: the JSON is the top level, so it's {{title}} rather than {{data.title}}.
  // Partials use a template's id: {{> todo-item}} renders <script id="todo-item">.
  engine("text/mustache", function (text, lookup) {
    window.Mustache.parse(text); // check the template once, up front
    return function (data) {
      return window.Mustache.render(text, data, function (name) { return lookup("#" + name); });
    };
  });

  // Finds a template and compiles it with the engine its type names.
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
      var type = node.getAttribute("type") || "text/ejs";
      var compile = engines[type];
      if (!compile) throw new Error('[jsonx] no template engine for type "' + type + '"');
      cache[selector] = compile(node.textContent, function (name) {
        var inner = root.querySelector(name) || document.querySelector(name);
        if (!inner) throw new Error('[jsonx] template "' + name + '" matched nothing');
        return inner.textContent;
      });
    }
    return cache[selector];
  }

  // Morphing (see below) is the default when idiomorph is loaded; otherwise we
  // replace the target's contents.
  function defaultSwap() {
    return window.Idiomorph ? "morph" : "innerHTML";
  }

  // Puts `html` into the page. Returns the elements that are new, so we can wire them up.
  function swapContent(target, html, swap) {
    if (swap === "morph") return morph(target, html);

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

  // jx-swap="morph" updates the target's contents to match the new HTML, but only
  // changes what's different, using idiomorph (vendor/idiomorph.min.js).
  // Elements that didn't change stay exactly as they are: web components aren't
  // rebuilt, and focus and scroll position survive. Give list items an id so
  // they're matched up correctly when items are added, removed or reordered.
  function morph(target, html) {
    if (!window.Idiomorph) throw new Error('[jsonx] jx-swap="morph" needs idiomorph loaded first');
    var added = [];
    Idiomorph.morph(target, html, {
      morphStyle: "innerHTML",
      callbacks: {
        afterNodeAdded: function (node) {
          if (node.nodeType === 1) added.push(node);
        },
        // Components often set attributes on themselves (aria-*, tabindex, ...).
        // Those aren't in the template, so don't let the morph strip them off.
        beforeAttributeUpdated: function (name, element, type) {
          if (type === "remove" && element.localName.indexOf("-") !== -1) return false;
        },
        // The server's view is the truth. Native inputs get their value and checked
        // state synced by idiomorph; do the same for form-control web components,
        // whose current state lives in properties, not attributes.
        afterNodeMorphed: function (oldNode, newNode) {
          if (oldNode.nodeType !== 1 || !oldNode.constructor.formAssociated) return;
          if ("checked" in oldNode) oldNode.checked = newNode.hasAttribute("checked");
          if ("value" in oldNode && !/-button$/.test(oldNode.localName)) {
            oldNode.value = newNode.getAttribute("value") || "";
          }
        }
      }
    });
    return added;
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
  window.jsonx = { process: process, request: issueRequest, render: render, engine: engine };

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
