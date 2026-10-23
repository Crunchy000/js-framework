/*
 * jsonx.js — a tiny framework for JSON APIs, in the spirit of htmx.
 *
 * The idea: your API answers with the whole view as JSON, shaped for the page.
 * An element with a template is a "region". It loads its view, draws it with the
 * template, and every button inside it calls the API and redraws the region.
 *
 *   <wa-card jx-get="api/todos">              <- a region: loads itself
 *     <template>
 *       <li jx-each="todos">                   <- template syntax: see templates.js
 *         <wa-checkbox checked="{{done}}" jx-post="api/todos/{{id}}/toggle">{{title}}</wa-checkbox>
 *       </li>
 *     </template>
 *   </wa-card>
 *
 * Templates are compiled to Lit (https://lit.dev), so a redraw only touches the
 * values that changed. Load this file as a module:
 *
 *   <script type="module" src="jsonx.js"></script>
 */
import { compileTemplate } from "./templates.js?v=4";

var METHODS = ["get", "post", "put", "patch", "delete"];
var SELECTOR = METHODS.map(function (m) { return "[jx-" + m + "]"; }).join(",") + ",[jx-region]";

// Remember which elements already have listeners, so we never attach twice.
var processed = new WeakSet();

// ---------------------------------------------------------------------------
// 1. Finding elements and wiring up their events
// ---------------------------------------------------------------------------

// Look inside `root` for any element with a jx-get/jx-post/... (or jx-region) attribute and wire it up.
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

  // A region can keep its template inside itself: <wa-card jx-get="..."><template>.
  // We take it out (so it isn't wiped by the first render) and remember it.
  var inline = Array.from(el.children).find(function (child) {
    return child.localName === "template" && !child.hasAttribute("jx-use");
  });
  if (inline && !el.hasAttribute("jx-template")) {
    el.__jxTemplate = inline;
    el.setAttribute("jx-template", "");
    inline.remove();
  }

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
  // <div jx-region> has no URL: it draws its template once, with an empty view.
  // Good for a sign-in form, which has nothing to load.
  if (!getMethodAndUrl(el)) {
    render(el, {});
    return;
  }

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
// Things you click get "click", things you change get "change",
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
// the default instead.
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

// A "region" is the nearest element (the element itself, or one of its parents)
// that has a template. Buttons inside a region send its named controls, and
// their results redraw it.
function findRegion(el) {
  return el.closest("[jx-template]");
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
    var found = el.getRootNode().querySelectorAll(include);
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
  if (!name || el.value === undefined || el.disabled) return;
  if ((el.type === "checkbox" || el.type === "radio") && !el.checked) return;
  values[name] = el.value === null ? "" : el.value; // an untouched <wa-input> has null
}

// Dotted names build nested JSON, so name="user.email" and name="user.password"
// send { "user": { "email": ..., "password": ... } }. (A query string keeps them flat.)
function nest(values) {
  var result = {};
  Object.keys(values).forEach(function (key) {
    var parts = key.split(".");
    var place = result;
    parts.slice(0, -1).forEach(function (part) {
      if (typeof place[part] !== "object" || place[part] === null) place[part] = {};
      place = place[part];
    });
    place[parts[parts.length - 1]] = values[key];
  });
  return result;
}

// `override` ({ method, url }) repeats a request exactly, without collecting values.
// jx-refresh uses it.
function issueRequest(el, override) {
  var info = override || getMethodAndUrl(el);
  var values = override ? {} : collectValues(el);
  var url = info.url;
  var options = { method: info.method, headers: { Accept: "application/json" } };

  // GET and DELETE put values in the query string; the others send a JSON body.
  if (info.method === "GET" || info.method === "DELETE") {
    var query = new URLSearchParams(values).toString();
    if (query) url += (url.indexOf("?") === -1 ? "?" : "&") + query;
  } else {
    options.headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(nest(values));
  }

  // jsonx.headers adds headers to every request, e.g. a sign-in token.
  // It can be an object, or a function that returns one.
  var extra = typeof api.headers === "function" ? api.headers(el) : api.headers;
  if (extra) Object.assign(options.headers, extra);

  // Let page code inspect or cancel the request: listen for "jx:beforeRequest"
  // and call event.preventDefault() to stop it.
  if (!fire(el, "jx:beforeRequest", { url: url, options: options })) return Promise.resolve();

  el.classList.add("jx-loading");

  return fetch(url, options)
    .then(function (response) {
      if (!response.ok) return failed(response, info.method + " " + url);
      // 204 No Content has no body, so we treat it as empty data.
      return response.status === 204 ? null : response.json();
    })
    .then(function (data) {
      render(el, data, info.method === "GET" ? url : null);
      // jx-refresh="#comments": once this worked, reload those regions the way
      // they were last loaded. For APIs that answer with one thing, not the view.
      var refresh = el.getAttribute("jx-refresh");
      if (refresh) refresh.split(",").forEach(function (selector) { reload(findElement(el, selector.trim())); });
    })
    .catch(function (error) {
      console.error("[jsonx]", error);
      // If the server explained what went wrong, show it in the region too.
      if (error.data && el.isConnected) renderError(el, error);
      fire(el.isConnected ? el : document, "jx:error", { error: error });
    })
    .finally(function () {
      el.classList.remove("jx-loading");
    });
}

// Turns an error response into an Error. If the server sent JSON like
// { "error": "Title is required" }, that message is used.
function failed(response, what) {
  return response.json().catch(function () { return null; }).then(function (body) {
    var errors = errorList(body);
    var message = (body && (body.error || body.message)) ||
      (errors.length ? errors.map(function (e) { return e.text; }).join(", ") : what + " failed with status " + response.status);
    var error = new Error(message);
    error.status = response.status;
    error.data = body;
    error.errors = errors;
    throw error;
  });
}

// Many APIs (RealWorld, Rails, ...) send errors per field:
//   { "errors": { "email": ["can't be blank"], "password": ["is too short"] } }
// That becomes a list a template can loop over:
//   [{ field: "email", message: "can't be blank", text: "email can't be blank" }, ...]
function errorList(body) {
  var errors = body && body.errors;
  if (!errors || typeof errors !== "object") return [];
  if (Array.isArray(errors)) {
    return errors.map(function (e) { var m = typeof e === "string" ? e : e.message; return { field: "", message: m, text: m }; });
  }
  var list = [];
  Object.keys(errors).forEach(function (field) {
    [].concat(errors[field]).forEach(function (message) {
      list.push({ field: field, message: message, text: field + " " + message });
    });
  });
  return list;
}

// ---------------------------------------------------------------------------
// 3. Drawing the view
// ---------------------------------------------------------------------------

// `url` is the address the data came from, for GET requests.
function render(el, data, url) {
  var region = findRegion(el);
  var target = el.hasAttribute("jx-target") ? findTarget(el) : (region || el);
  var swap = el.getAttribute("jx-swap") || "";

  // Page code can reshape the data first: listen for "jx:beforeRender" and set
  // event.detail.data. That's how to adapt an API you don't control.
  var detail = { data: data, url: url || null, source: el, target: target };
  fire(el, "jx:beforeRender", detail);
  data = detail.data;

  // jx-swap="prop:items" skips templates: it sets target.items = data.
  // This is the natural way to feed JSON to a web component.
  if (swap.indexOf("prop:") === 0) {
    target[swap.slice(5)] = data;
    fire(el, "jx:afterRender", { data: data, target: target, source: el });
    return;
  }

  // jx-swap="none" (or no template anywhere) means "call the API, draw nothing".
  var owner = el.hasAttribute("jx-template") ? el : (target.hasAttribute && target.hasAttribute("jx-template") ? target : region);
  if (swap !== "none" && owner) {
    var firstTime = !target.__jxRendered;
    target.__jxView = data; // remembered, so an error can be shown on top of it
    if (url && swap !== "none") target.__jxUrl = url; // and for jx-refresh
    getTemplate(owner)(data, target);
    process(target); // wire up any new elements; existing ones stay wired
    if (firstTime) focusAutofocus(target);
  }

  fire(el.isConnected ? el : target, "jx:afterRender", { data: data, target: target, source: el });
}

// When a request fails, the region is redrawn with its last view plus:
//   error        one message for the whole thing
//   errors       the list from errorList(), for jx-each
//   fieldErrors  { email: "can't be blank" }, to show a message under each field
// The next successful answer replaces the view, so the errors go away by themselves.
function renderError(el, error) {
  // (Even with jx-swap="none": "draw nothing" is for success.)
  if ((el.getAttribute("jx-swap") || "").indexOf("prop:") === 0) return;
  var region = findRegion(el);
  var target = el.hasAttribute("jx-target") ? findTarget(el) : (region || el);
  var owner = el.hasAttribute("jx-template") ? el : (target.hasAttribute && target.hasAttribute("jx-template") ? target : region);
  if (!owner) return;
  var fieldErrors = {};
  error.errors.forEach(function (e) {
    if (e.field) fieldErrors[e.field] = fieldErrors[e.field] ? fieldErrors[e.field] + ", " + e.message : e.message;
  });
  var view = Object.assign({}, target.__jxView, { error: error.message, errors: error.errors, fieldErrors: fieldErrors });
  getTemplate(owner)(view, target, true); // true: keep what was typed
  process(target);
}

// jx-target can be a CSS selector, "this", or "closest <selector>".
function findTarget(el) {
  return findElement(el, el.getAttribute("jx-target"));
}

// Selectors are looked up in the element's own root first: inside a web
// component that's its shadow root, so "#list" means the component's #list.
function findElement(el, value) {
  if (!value || value === "this") return el;
  if (value.indexOf("closest ") === 0) return el.closest(value.slice(8));
  var found = el.getRootNode().querySelector(value) || document.querySelector(value);
  if (!found) throw new Error('[jsonx] "' + value + '" matched nothing');
  return found;
}

// Loads a region again from wherever it was last loaded (a tab or page button
// may have changed that), or else with its own jx-get.
function reload(region) {
  if (region.__jxUrl) issueRequest(region, { method: "GET", url: region.__jxUrl });
  else if (getMethodAndUrl(region)) issueRequest(region);
}

// The compiled template for an element with jx-template: either the <template>
// it held inside itself, or jx-template="#id". Ids are looked up in the element's
// own root first (so a web component can ship its own templates), then the page.
var compiled = new WeakMap(); // <template> -> compiled template, so each is compiled once

function getTemplate(owner) {
  var root = owner.getRootNode();
  var find = function (selector) { return root.querySelector(selector) || document.querySelector(selector); };
  var selector = owner.getAttribute("jx-template");
  var node = owner.__jxTemplate || find(selector);
  if (!node || node.localName !== "template") {
    throw new Error('[jsonx] jx-template "' + selector + '" must point to a <template>');
  }
  if (!compiled.has(node)) compiled.set(node, compileTemplate(node, find));
  return compiled.get(node);
}

// Browsers only honour `autofocus` when a page first loads, so do it for new content.
function focusAutofocus(target) {
  var focus = target.querySelector("[autofocus]");
  if (focus) setTimeout(function () { focus.focus(); });
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
// Set jsonx.headers to add headers to every request (see issueRequest).
// Page code that runs before jsonx can set window.jsonx = { headers: ... } first.
var api = Object.assign({ headers: null }, window.jsonx, {
  process: process,
  request: function (el) { return issueRequest(el); },
  reload: reload,
  render: function (el, data) { render(el, data); }
});
window.jsonx = api;

// Modules run once the page has been parsed, so we can start straight away.
process(document.body);
watch(document.body);
