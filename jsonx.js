/*
 * jsonx.js — a tiny framework for JSON APIs, in the spirit of htmx.
 *
 * The idea: your API answers with the whole view as JSON, shaped for the page.
 * An element with a template is a "region". It loads its view, draws it with the
 * template, and every button inside it calls the API and redraws the region.
 *
 *   <wa-card jx-get="api/todos">              <- a region: loads itself
 *     <template>
 *       <jx-each items="todos">                <- template syntax: see templates.js
 *         <wa-checkbox checked="{{done}}" jx-post="api/todos/{{id}}/toggle">{{title}}</wa-checkbox>
 *       </jx-each>
 *     </template>
 *   </wa-card>
 *
 * Templates are compiled to Lit (https://lit.dev), so a redraw only touches the
 * values that changed. Load this file as a module:
 *
 *   <script type="module" src="jsonx.js"></script>
 */
import { compileTemplate, compileView } from "./templates.js?v=32";
import { defineComponent, instances, compileScript } from "./components.js?v=32";

var METHODS = ["get", "post", "put", "patch", "delete"];
var SELECTOR = METHODS.map(function (m) { return "[jx-" + m + "]"; }).join(",") + ",[jx-action],[jx-region],[jx-query],[jx-data],[jx-emit],[jx-ws],[jx-ws-send]";

// Remember which elements already have listeners, so we never attach twice.
var processed = new WeakSet();

// ---------------------------------------------------------------------------
// 1. Finding elements and wiring up their events
// ---------------------------------------------------------------------------

// Look inside `root` for any element with a jx-get/jx-post/... (or jx-region) attribute and wire it up.
// `root` can be the document body, any element, or a web component's shadowRoot.
function process(root) {
  root = root || document.body;

  // <template src="nav.jx"> pulls in a file of HTML first (see include below).
  // Nothing else is wired until they're all in, so their templates are there to use.
  var includes = root.querySelectorAll("template[src]");
  if (includes.length) {
    Promise.all(Array.from(includes).map(include)).then(function () { process(root); });
    return;
  }
  // <template jx-component="user-card"> defines <user-card> (see components.js).
  root.querySelectorAll("template[jx-component]").forEach(function (template) {
    defineComponent(template, { compileView: compileView, process: process, bindProps: bindProps, scopeValue: scopeValue, scopeGet: scopeGet, fingerprint: fingerprint, copy: copy });
  });
  var elements = Array.from(root.querySelectorAll(SELECTOR));
  if (root.matches && root.matches(SELECTOR)) elements.unshift(root);
  elements.forEach(wire);

  // Shadow roots are invisible to the page-level observer, so watch each one we're given.
  if (root instanceof ShadowRoot) watch(root);
}

function wire(el) {
  if (processed.has(el)) return;
  processed.add(el);

  // <template jx-get="..."> loads and draws right where it is. It needs an
  // element to draw into, so it's swapped for a <jx-view> (which takes no space
  // in the layout) with the same attributes, holding the template inside.
  if (el.localName === "template") {
    var view = document.createElement("jx-view");
    Array.from(el.attributes).forEach(function (a) { view.setAttribute(a.name, a.value); });
    if (el.__jxScope) view.__jxScope = el.__jxScope;
    el.replaceWith(view);
    view.append(el);
    wire(view);
    return;
  }

  fillFromAddress(el);

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

// <template src="nav.jx"></template>: a reusable piece of HTML in its own file.
// A plain one is replaced by the file's contents. One with jx-get (or another
// request attribute) uses the file as its template instead.
// Files are fetched once, however many pages or places use them.
var files = {};

function include(template) {
  var src = template.getAttribute("src");
  template.removeAttribute("src");
  var url = new URL(src, location.href).href;
  if (!files[url]) {
    files[url] = fetch(url).then(function (response) {
      if (!response.ok) throw new Error("[jsonx] couldn't load " + src + " (" + response.status + ")");
      return response.text();
    });
  }
  return files[url].then(function (html) {
    var holder = document.createElement("template");
    holder.innerHTML = html;
    // In a .jx file, <template id="my-counter"> defines <my-counter>: an id
    // with a dash is a component's name (on a page, ids are for jx-template).
    Array.from(holder.content.children).forEach(function (child) {
      if (child.localName === "template" && child.id.indexOf("-") > 0 && !child.hasAttribute("jx-component")) {
        child.setAttribute("jx-component", child.id);
      }
    });
    // <script type="module"> in the file becomes the file's scope (see below).
    return fileScope(holder.content, url).then(function (scope) {
      if (getMethodAndUrl(template) || template.hasAttribute("jx-region")) {
        template.innerHTML = "";
        template.content.append(holder.content);
        if (scope) template.__jxScope = scope;
      } else {
        if (scope) Array.from(holder.content.children).forEach(function (child) { child.__jxScope = scope; });
        template.replaceWith(holder.content);
      }
    });
  }).catch(function (error) {
    console.error(error);
    template.remove();
  });
}

// ---------------------------------------------------------------------------
// Module scope for .jx files
// ---------------------------------------------------------------------------
//
// A .jx file can hold a <script type="module">. Its exports are the file's
// scope: fn:add and jx-data="count" in the file's markup (and inside the
// components it defines) look there first, then at the page's globals. What
// isn't exported stays private, and two files can each have their own count.
//
// After any fn: call, jsonx checks each module's bound exports, and redraws
// only the regions bound to the ones that changed. So nobody has to say what
// a button changes. Exports are live bindings: when add() sets count, jsonx
// sees the new value. For changes made outside an fn: call (a timer, a
// socket), call jsonx.changed().

var scopes = [];
var modules = {}; // file address -> its loaded scope, so each runs once

function fileScope(content, url) {
  // Templates keep their own scripts (a component's per-element code), so
  // only scripts at the top of the file count here.
  content.querySelectorAll("template").forEach(function (t) { t.__jxSource = url; });
  var scripts = Array.from(content.children).filter(function (el) {
    return el.localName === "script" && (!el.type || el.type === "module");
  });
  if (!scripts.length) return Promise.resolve(null);
  scripts.forEach(function (script) { script.remove(); });
  if (!modules[url]) {
    modules[url] = Promise.all(scripts.map(function (script) {
      // A plain script: ordinary code, its top-level names shared by the file.
      if (!script.type) return compileScript(script.textContent, [], url + "#script")(null, function () {});
      return loadModule(script.textContent, url);
    }))
      .then(function (namespaces) {
        var scope = { url: url, namespaces: namespaces, bound: {}, last: {} };
        scopes.push(scope);
        return scope;
      });
  }
  return modules[url];
}

// The module runs from a blob: address, so relative imports are made full
// first: "./format.js" is found next to the .jx file.
function loadModule(code, base) {
  code = code.replace(/(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(["'])(\.{1,2}\/[^"']*)\2/g, function (all, before, quote, path) {
    return before + quote + new URL(path, base).href + quote;
  });
  var address = URL.createObjectURL(new Blob([code + "\n//# sourceURL=" + base + "#module"], { type: "text/javascript" }));
  return import(address).finally(function () { URL.revokeObjectURL(address); });
}

function scopeHas(scope, name) {
  return !!scope && scope.namespaces.some(function (ns) { return name in ns; });
}

function scopeGet(scope, name) {
  for (var i = 0; i < scope.namespaces.length; i++) if (name in scope.namespaces[i]) return scope.namespaces[i][name];
}

// The scope an element belongs to: its own, or the nearest one above it,
// crossing out of shadow roots (a component carries its file's scope).
function scopeFor(el, name) {
  for (var node = el; node; node = node.parentNode || node.host) {
    if (node.__jxScope && scopeHas(node.__jxScope, name)) return node.__jxScope;
  }
  return null;
}

// What a value looks like now, to tell whether it changed. Objects and lists
// are compared by their contents, so items.push() counts as a change.
function fingerprint(value) {
  if (value === null || typeof value !== "object") return value;
  try { return "json:" + JSON.stringify(value); } catch (e) { return {}; } // can't tell: always "changed"
}

// Redraw the regions bound to module exports that changed since last time.
function checkScopes() {
  var dirty = new Set();
  scopes.forEach(function (scope) {
    Object.keys(scope.bound).forEach(function (name) {
      var now = fingerprint(scopeGet(scope, name));
      if (Object.is(now, scope.last[name])) return;
      scope.last[name] = now;
      scope.bound[name].forEach(function (el) {
        if (el.isConnected) dirty.add(el);
        else scope.bound[name].delete(el);
      });
    });
  });
  dirty.forEach(function (el) {
    if (el.__jxProps) el.requestUpdate(); // a component reading props from its scope
    else render(el, copy(viewFor(el)));
  });
  // Components with setup() state redraw if their own data changed.
  instances.forEach(function (component) { component.__jxCheck(); });
}

// The component instance (from setup()) nearest el with a function by this name.
function instanceFor(el, name) {
  for (var node = el; node; node = node.parentNode || node.host) {
    var instance = node.__jxInstance;
    if (instance && typeof instance[name] === "function") return instance;
  }
  return null;
}

// For components (see components.js): each prop its scope exports is bound,
// so the component redraws when that export changes.
function bindProps(host, props) {
  props.forEach(function (name) {
    var scope = scopeFor(host, name);
    if (!scope) return;
    host.__jxProps = true;
    (scope.bound[name] = scope.bound[name] || new Set()).add(host);
    if (!(name in scope.last)) scope.last[name] = fingerprint(scopeGet(scope, name));
  });
}

// A copy, so the template sees a change made in place (qty++) as a change.
function scopeValue(host, name) {
  var scope = scopeFor(host, name);
  return scope ? copy(scopeGet(scope, name)) : undefined;
}

// On article.html?slug=hello, jx-get="/view/article/:slug" becomes
// "/view/article/hello", and "?slug=:slug" works the same way.
// A value the address doesn't have becomes empty.
var addressValues = new URLSearchParams(location.search);

function fillFromAddress(el) {
  // Keep the originals, so back and forward can fill them again (jx-push-url).
  var originals = el.__jxAddress || {};
  METHODS.concat("action").forEach(function (m) {
    var attr = "jx-" + m;
    var url = originals[attr] || el.getAttribute(attr);
    if (url === null || url.indexOf(":") === -1) return;
    originals[attr] = url;
    el.setAttribute(attr, url.replace(/([/=]):(\w+)/g, function (all, before, name) {
      return before + encodeURIComponent(addressValues.get(name) || "");
    }));
  });
  // jx-vals='{"slug": ":slug"}' works the same way.
  var vals = originals["jx-vals"] || el.getAttribute("jx-vals");
  // A name the address doesn't have is left out, so defaults apply.
  if (vals && vals.indexOf('":') !== -1) {
    originals["jx-vals"] = vals;
    var filled = JSON.parse(vals);
    Object.keys(filled).forEach(function (key) {
      var match = typeof filled[key] === "string" && /^:(\w+)$/.exec(filled[key]);
      if (!match) return;
      if (addressValues.has(match[1])) filled[key] = addressValues.get(match[1]);
      else delete filled[key];
    });
    el.setAttribute("jx-vals", JSON.stringify(filled));
  }
  el.__jxAddress = originals;
}

// <div jx-get="/view/home?tab=:tab&page=:page" jx-push-url>: when a GET from
// this region works, the values it sent go into the address bar, so refresh,
// back and forward, and shared links all show the same view.
// jx-push-url="tab page" keeps just those names. Empty values are left out.
function pushAddress(el, sent) {
  var region = el.closest("[jx-push-url]");
  if (!region) return;
  var names = (region.getAttribute("jx-push-url") || "").split(/[\s,]+/).filter(Boolean);
  var params = new URLSearchParams(location.search);
  (names.length ? names : Object.keys(sent)).forEach(function (name) {
    var value = sent[name];
    if (value === undefined || value === null || value === "") params.delete(name);
    else if (typeof value !== "object") params.set(name, value);
  });
  // The region's first load only tidies the address; later ones are new steps.
  var first = !region.__jxPushed;
  region.__jxPushed = true;
  var search = params.toString();
  if (search === location.search.slice(1)) return;
  var address = location.pathname + (search ? "?" + search : "") + location.hash;
  history[first ? "replaceState" : "pushState"]({ jsonx: true }, "", address);
  addressValues = params;
}

// Back and forward: load each jx-push-url region again from the address.
window.addEventListener("popstate", function () {
  addressValues = new URLSearchParams(location.search);
  document.querySelectorAll("[jx-push-url]").forEach(function (region) {
    fillFromAddress(region);
    issueRequest(region, null, true);
  });
});

function attachTriggers(el) {
  // <div jx-ws="/ws/chat"> is drawn from a WebSocket: each message is a view.
  // <form jx-ws-send> inside it sends its values over that socket.
  if (el.hasAttribute("jx-ws")) {
    render(el, {});
    connect(el);
    return;
  }
  if (el.hasAttribute("jx-ws-send")) {
    parseTriggers(el).forEach(function (trigger) {
      findSource(el, trigger.from).addEventListener(trigger.event, function (event) {
        if (!el.isConnected) return;
        if (trigger.filter && String(event[trigger.filter.property]) !== trigger.filter.value) return;
        if (event.type === "submit" || el.tagName === "A") event.preventDefault();
        sendOverSocket(el);
      });
    });
    return;
  }
  // <div jx-data="cart"> draws the variable cart, and again after
  // every fn: call or jsonx.update() (see "Shared data" below).
  if (el.hasAttribute("jx-data") && !getMethodAndUrl(el)) {
    dataNames(el).forEach(function (name) {
      var scope = scopeFor(el, name);
      var list = scope ? scope.bound : bound;
      (list[name] = list[name] || new Set()).add(el);
      if (scope && !(name in scope.last)) scope.last[name] = fingerprint(scopeGet(scope, name));
    });
    render(el, copy(viewFor(el)));
    return;
  }
  // <button jx-emit="pick"> fires a "pick" event, carrying the item it was drawn
  // for. Inside a component, the event comes out of the component itself.
  if (el.hasAttribute("jx-emit") && !getMethodAndUrl(el)) {
    parseTriggers(el).forEach(function (trigger) {
      findSource(el, trigger.from).addEventListener(trigger.event, function (event) {
        if (trigger.filter && String(event[trigger.filter.property]) !== trigger.filter.value) return;
        if (event.type === "submit" || el.tagName === "A") event.preventDefault();
        // jx-detail='{"id": "{{id}}"}' sends that instead of the item.
        var detail = el.hasAttribute("jx-detail") ? JSON.parse(el.getAttribute("jx-detail")) : el.__jxItem;
        fire(el, el.getAttribute("jx-emit"), detail);
      });
    });
    return;
  }
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
    // "revealed" runs when the element scrolls into view, e.g. a "Load more"
    // row at the bottom of a long list. It runs again each time it comes back.
    if (trigger.event === "revealed") {
      new IntersectionObserver(function (entries) {
        if (entries.some(function (e) { return e.isIntersecting; }) && el.isConnected) issueRequest(el);
      }, { rootMargin: "200px" }).observe(el);
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
  // jx-action="add" calls the function add: the same as jx-post="fn:add".
  var action = el.getAttribute("jx-action");
  if (action !== null) return { method: "POST", url: "fn:" + action, action: true };
  // A GraphQL query needs no URL: it goes to jsonx.graphql ("/graphql" unless you change it).
  if (el.hasAttribute("jx-query")) return { method: "POST", url: api.graphql };
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

function ownValues(el) {
  var vals = el.getAttribute("jx-vals");
  return vals ? JSON.parse(vals) : {};
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
// A number makes a list: items.0.qty and items.1.qty send { items: [{ qty }, { qty }] }.
function nest(values) {
  var result = {};
  Object.keys(values).forEach(function (key) {
    var parts = key.split(".");
    var place = result;
    parts.slice(0, -1).forEach(function (part, i) {
      if (typeof place[part] !== "object" || place[part] === null) place[part] = /^\d+$/.test(parts[i + 1]) ? [] : {};
      place = place[part];
    });
    place[parts[parts.length - 1]] = values[key];
  });
  return closeGaps(result);
}

// Rows 0 and 2 (row 1 was removed) make a list of two, not one with a hole.
function closeGaps(value) {
  if (Array.isArray(value)) return value.filter(function () { return true; }).map(closeGaps);
  if (value && typeof value === "object") Object.keys(value).forEach(function (k) { value[k] = closeGaps(value[k]); });
  return value;
}

// `override` ({ method, url }) repeats a request exactly, without collecting values.
// jx-refresh uses it.
// `fromAddress` (back and forward) sends only the element's own values, not
// the controls drawn for the view it's leaving.
function issueRequest(el, override, fromAddress) {
  var info = override || getMethodAndUrl(el);
  var values = override ? {} : fromAddress ? ownValues(el) : collectValues(el);
  var url = info.url;
  var options = { method: info.method, headers: { Accept: "application/json" } };

  // jx-query="#home-query" makes it a GraphQL request: the query comes from that
  // <script type="text/graphql"> (or several, for fragments), and the values
  // become its variables.
  var graphql = !override && el.getAttribute("jx-query");
  if (graphql) {
    var text = graphql.split(",").map(function (selector) {
      var script = el.getRootNode().querySelector(selector.trim()) || document.querySelector(selector.trim());
      if (!script) throw new Error('[jsonx] jx-query "' + selector + '" matched nothing');
      return script.textContent;
    }).join("\n");
    options.method = "POST";
    options.headers["Content-Type"] = "application/json";
    var request = { query: text, variables: typedVariables(nest(values), text) };
    // jx-operation="AddComment" picks one operation, when the script holds several.
    if (el.hasAttribute("jx-operation")) request.operationName = el.getAttribute("jx-operation");
    options.body = JSON.stringify(request);
  } else if (info.method === "GET" || info.method === "DELETE") {
    // GET and DELETE put values in the query string; the others send a JSON body.
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

  // When answers arrive out of order (typing fast, clicking twice), only the
  // newest request for the same place is drawn.
  var place = el;
  try { place = el.hasAttribute("jx-target") ? findTarget(el) : (findRegion(el) || el); } catch (e) {}
  var latest = place.__jxLatest = (place.__jxLatest || 0) + 1;
  var stale = function () { return place.__jxLatest !== latest && el.getAttribute("jx-swap") !== "none"; };
  var sentAt = performance.now();

  return send(url, options, el)
    .then(function (response) {
      if (!response.ok) return failed(response, info.method + " " + url);
      // A function that returned nothing: there's no view to draw.
      if (response.headers.get("X-Jsonx-Nothing")) return NOTHING;
      // 204 No Content has no body, so we treat it as empty data.
      return response.status === 204 ? null : response.json();
    })
    .then(function (data) {
      if (stale()) return;
      if (data === NOTHING) {
        fire(el, "jx:afterRender", { data: undefined, target: null, source: el });
        return;
      }
      // GraphQL answers { data, errors } with status 200, even when it failed.
      if (graphql) {
        if (data.errors && data.errors.length) throw problem(data, "GraphQL request");
        data = data.data;
      }
      // jx-select="favoriteArticle.query" draws just that part of the answer.
      var select = el.getAttribute("jx-select");
      if (select) data = select.split(".").reduce(function (v, key) { return v == null ? v : v[key]; }, data);
      render(el, data, info.method === "GET" ? url : null, sentAt);
      // jx-push-url: put what a GET (or a GraphQL query) sent in the address bar.
      // A region that loads itself with jx-action counts as a GET here.
      var reads = info.method === "GET" || (info.action && el.hasAttribute("jx-template")) || (graphql && !/^\s*mutation\b/m.test(text));
      if (!fromAddress && !override && reads) {
        var sent = Object.fromEntries(new URL(url.replace(/^fn:/, ""), location.href).searchParams);
        pushAddress(el, Object.assign(sent, values));
      }
      // jx-refresh="#comments": once this worked, reload those regions the way
      // they were last loaded. For APIs that answer with one thing, not the view.
      var refresh = el.getAttribute("jx-refresh");
      if (refresh) refresh.split(",").forEach(function (selector) { reload(findElement(el, selector.trim())); });
      // jx-then="article.html?slug=:article.slug": once this worked, go to that
      // page. Here :name is filled from the server's answer.
      var then = el.getAttribute("jx-then");
      if (then) location.href = then.replace(/:([\w.]+)/g, function (all, name) {
        var value = name.split(".").reduce(function (v, key) { return v == null ? v : v[key]; }, data);
        return encodeURIComponent(value == null ? "" : value);
      });
    })
    .catch(function (error) {
      if (stale()) return;
      console.error("[jsonx]", error);
      // If the server explained what went wrong, show it in the region too.
      if (error.data && el.isConnected) renderError(el, error);
      fire(el.isConnected ? el : document, "jx:error", { error: error });
    })
    .finally(function () {
      el.classList.remove("jx-loading");
    });
}

// ---------------------------------------------------------------------------
// WebSockets
// ---------------------------------------------------------------------------
//
//   <div jx-ws="/ws/chat">
//     <template>
//       <p jx-each="messages">{{text}}</p>
//       <form jx-ws-send><input name="text" value="{{draft}}"></form>
//     </template>
//   </div>
//
// Every message from the server is JSON: the region's whole view, drawn like
// an answer to jx-get (only what changed is updated). jx-ws-send sends the
// values a jx-post would, as one JSON message. The region gets the class
// jx-ws-connecting, jx-ws-open or jx-ws-closed, so CSS can show the state. When
// the connection drops it tries again, waiting longer each time (up to 30s).

function connect(region) {
  var url = new URL(region.getAttribute("jx-ws"), location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : url.protocol === "http:" ? "ws:" : url.protocol;
  var state = function (name) {
    region.classList.remove("jx-ws-connecting", "jx-ws-open", "jx-ws-closed");
    region.classList.add("jx-ws-" + name);
  };
  state("connecting");
  var socket = region.__jxSocket = new WebSocket(url.href);
  region.__jxQueue = region.__jxQueue || [];
  socket.addEventListener("open", function () {
    region.__jxRetry = 0;
    state("open");
    // Anything sent while it was connecting goes now.
    region.__jxQueue.splice(0).forEach(function (message) { socket.send(message); });
  });
  socket.addEventListener("message", function (event) {
    if (!region.isConnected) { socket.close(); return; }
    var data;
    try { data = JSON.parse(event.data); } catch (e) { console.error("[jsonx] jx-ws message isn't JSON:", event.data); return; }
    // Fields typed in since the last send keep what's in them.
    render(region, data, null, region.__jxSentAt);
  });
  socket.addEventListener("close", function () {
    state("closed");
    if (!region.isConnected || region.__jxSocket !== socket) return;
    var wait = Math.min(30000, 1000 * Math.pow(2, region.__jxRetry || 0));
    region.__jxRetry = (region.__jxRetry || 0) + 1;
    setTimeout(function () { if (region.isConnected) connect(region); }, wait);
  });
}

// The socket is the nearest jx-ws region's, or jx-ws-send="#chat" names one.
function sendOverSocket(el) {
  var name = el.getAttribute("jx-ws-send");
  var region = name ? findElement(el, name) : el.closest("[jx-ws]");
  if (!region || !region.hasAttribute("jx-ws")) throw new Error("[jsonx] jx-ws-send needs a jx-ws region around it, or one named");
  var message = JSON.stringify(nest(collectValues(el)));
  if (!fire(el, "jx:beforeSend", { message: message, socket: region.__jxSocket })) return;
  region.__jxSentAt = performance.now();
  if (region.__jxSocket && region.__jxSocket.readyState === 1) region.__jxSocket.send(message);
  else region.__jxQueue.push(message);
}

// jx-post="fn:addToCart" calls jsonx.functions.addToCart instead of a server.
// It gets the values a request would send, and returns the view (or a promise
// of one). To fail, throw: { errors: {...} } or { error: "..." } (shown like a
// server's error answer, with status 422 unless it has a `status`), or an Error.
// Returning nothing means "nothing to draw" (handy after jsonx.update).
// The answer is wrapped in a real Response, so it's handled exactly like fetch's.
var NOTHING = {};

function send(url, options, el) {
  if (url.indexOf("fn:") !== 0) return fetch(url, options);
  var address = new URL(url.slice(3), "http://x/");
  var name = decodeURIComponent(address.pathname.slice(1));
  // Looked up in order: the component instance, the .jx module, then the page.
  var instance = el && instanceFor(el, name);
  var fnScope = !instance && el && scopeFor(el, name);
  var fn = instance ? instance[name].bind(instance) : fnScope ? scopeGet(fnScope, name) : name in api.functions ? api.functions[name] : globalValue(name);
  var json = function (status, body, headers) {
    return new Response(body === undefined ? null : JSON.stringify(body), {
      status: status, headers: Object.assign({ "Content-Type": "application/json" }, headers)
    });
  };
  if (typeof fn !== "function") return Promise.resolve(json(404, { error: "There's no function called " + name }));
  // fn:favorite?slug=hello sends slug too, for any method.
  var values = Object.assign(Object.fromEntries(address.searchParams), options.body ? JSON.parse(options.body) : {});
  return Promise.resolve()
    .then(function () { return fn(values); })
    .finally(function () {
      // The function may have changed shared data, so redraw what shows it.
      // <button jx-post="fn:add" jx-data="count"> says which data it changes,
      // so only those regions redraw. Otherwise all of them do: unchanged rows
      // are skipped, but each item still costs about a microsecond to check.
      // A module's function: its changes are found by comparing (checkScopes).
      var changes = el && el.getAttribute("jx-data");
      if (changes) changes.split(/[\s,]+/).filter(Boolean).forEach(function (n) { if (!scopeFor(el, n)) redraw(n); });
      else if (!fnScope && !instance) update();
      checkScopes();
    })
    .then(function (view) {
      return view === undefined ? json(204, undefined, { "X-Jsonx-Nothing": "1" }) : json(200, view);
    }, function (thrown) {
      if (thrown instanceof Error) {
        console.error(thrown);
        return json(thrown.status || 500, { error: thrown.message });
      }
      return json((thrown && thrown.status) || 422, thrown);
    });
}

// Shared data, for regions with jx-data="cart".
//
// The simplest way: a plain script with ordinary variables and functions.
//   <script>
//     let cart = { count: 0 };
//     function add() { cart.count++; }
//   </script>
//   <span jx-data="cart"><template>{{count}}</template></span>
//   <button jx-post="fn:add">Add</button>
// After any fn: call, every jx-data region is drawn again from its variable,
// or only the ones it names: <button jx-post="fn:add" jx-data="cart">.
//
// From other code (a timer, a fetch), call jsonx.update() to redraw them all,
// or jsonx.update("cart", function (cart) { cart.count++; }) to change one and
// redraw it. The function can change the data in place, or return new data;
// jsonx.update("cart", newData) replaces it.
//
// Names are looked up in jsonx.data and jsonx.functions first, then as globals.
var bound = {};

// A global by name: a `var` or `function` (on window), or a `let` or `const`
// from a plain script (not on window, but visible to global code).
function globalValue(name) {
  if (!/^[A-Za-z_$][\w$]*$/.test(name)) return undefined;
  try {
    return Function('return typeof ' + name + ' === "undefined" ? undefined : ' + name)();
  } catch (e) {
    return window[name];
  }
}

function setGlobal(name, value) {
  try { Function("value", name + " = value")(value); return true; } catch (e) { return false; }
}

function dataFor(name) {
  var data = name in api.data ? api.data[name] : globalValue(name);
  return data === undefined || data === null ? {} : data;
}

function update(name, change) {
  if (name === undefined) {
    Object.keys(bound).forEach(function (n) { redraw(n); });
    return;
  }
  var data = name in api.data || globalValue(name) === undefined ? api.data[name] : globalValue(name);
  if (typeof change === "function") {
    var result = change(data);
    if (result !== undefined) data = result;
  } else if (change !== undefined) {
    data = change;
  }
  if (name in api.data || globalValue(name) === undefined || !setGlobal(name, data)) api.data[name] = data;
  redraw(name);
  return data;
}

function dataNames(el) {
  return (el.getAttribute("jx-data") || "").split(/[\s,]+/).filter(Boolean);
}

// The view a jx-data region draws. One name holding an object draws that
// object (jx-data="cart" then {{count}}). Otherwise each name is a field:
// jx-data="items total" draws { items: [...], total: "£7.50" }.
function valueFor(el, name) {
  var scope = scopeFor(el, name);
  return scope ? scopeGet(scope, name) : dataFor(name);
}

function viewFor(el) {
  var names = dataNames(el);
  if (names.length === 1) {
    var only = valueFor(el, names[0]);
    if (only && typeof only === "object" && !Array.isArray(only)) return only;
  }
  var view = {};
  names.forEach(function (name) { view[name] = valueFor(el, name); });
  return view;
}

function redraw(name) {
  (bound[name] || new Set()).forEach(function (el) {
    if (el.isConnected) render(el, copy(viewFor(el)));
    else bound[name].delete(el);
  });
}

// Turns an error response into an Error. If the server sent JSON like
// { "error": "Title is required" }, that message is used.
function failed(response, what) {
  return response.json().catch(function () { return null; }).then(function (body) {
    throw problem(body, what + " failed with status " + response.status, response.status);
  });
}

function problem(body, fallback, status) {
  var errors = errorList(body);
  var message = (body && (body.error || body.message)) ||
    (errors.length ? errors.map(function (e) { return e.text; }).join(", ") : fallback);
  var error = new Error(message);
  error.status = status || 200;
  error.data = body;
  error.errors = errors;
  return error;
}

// Form values are always text, but GraphQL variables have types. This reads the
// query's "$offset: Int" declarations and converts: "10" -> 10, "true" -> true,
// and "" -> null for numbers, booleans and anything that isn't a String.
function typedVariables(values, query) {
  var types = {};
  query.replace(/\$(\w+)\s*:\s*\[?\s*(\w+)/g, function (all, name, type) { types[name] = type; });
  Object.keys(values).forEach(function (name) {
    var value = values[name], type = types[name];
    if (typeof value !== "string" || !type || type === "String") return;
    if (value === "") values[name] = null;
    else if (type === "Int" || type === "Float") values[name] = Number(value);
    else if (type === "Boolean") values[name] = value === "true";
  });
  return values;
}

// Many APIs (RealWorld, Rails, ...) send errors per field:
//   { "errors": { "email": ["can't be blank"], "password": ["is too short"] } }
// That becomes a list a template can loop over:
//   [{ field: "email", message: "can't be blank", text: "email can't be blank" }, ...]
function errorList(body) {
  var errors = body && body.errors;
  if (!errors || typeof errors !== "object") return [];
  if (Array.isArray(errors)) {
    // A list of messages, or GraphQL's errors (with extensions.field, if any).
    return errors.map(function (e) {
      var message = typeof e === "string" ? e : e.message;
      var field = (e.extensions && e.extensions.field) || "";
      return { field: field, message: message, text: field ? field + " " + message : message };
    });
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
// `sentAt` is when its request was sent: controls changed since keep their value.
function render(el, data, url, sentAt) {
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
    drawAndWire(target, function () { getTemplate(owner)(data, target, false, sentAt); });
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
  drawAndWire(target, function () { getTemplate(owner)(view, target, true); }); // true: keep what was typed
}

// Draws, then wires up only the elements the draw added. (Scanning the whole
// region every time would cost as much as a big list, even when one row changed.)
// The observer only collects; takeRecords() reads what it saw, straight away.
var newElements = new MutationObserver(function () {});

function drawAndWire(target, draw) {
  newElements.observe(target, { childList: true, subtree: true });
  var records;
  try {
    draw();
  } finally {
    records = newElements.takeRecords();
    newElements.disconnect();
  }
  records.forEach(function (record) {
    record.addedNodes.forEach(function (node) {
      if (node.nodeType === 1 && node.isConnected) process(node);
    });
  });
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

function copy(data) {
  try { return structuredClone(data); } catch (e) { return data; }
}

// A small public API, for page code and web components.
// Set jsonx.headers to add headers to every request (see issueRequest).
// Page code that runs before jsonx can set window.jsonx = { headers: ... } first.
var api = Object.assign({ headers: null, graphql: "/graphql", functions: {}, data: {} }, window.jsonx, {
  process: process,
  update: update,
  // After changing module variables outside an fn: call: redraw what changed.
  changed: checkScopes,
  request: function (el) { return issueRequest(el); },
  reload: reload,
  // A copy, because jsonx compares each view with the last one drawn: if your
  // code changed the same object and passed it again, it would look unchanged.
  render: function (el, data) { render(el, copy(data)); }
});
window.jsonx = api;

// <jx-view> is the element a <template jx-get> draws into. It takes no space in
// the layout, so the template's content sits in the page as if written there.
customElements.define("jx-view", class extends HTMLElement {
  connectedCallback() { this.style.display = "contents"; }
});

// Modules run once the page has been parsed, so we can start straight away.
process(document.body);
watch(document.body);
