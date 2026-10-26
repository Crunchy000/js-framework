/*
 * templates.js — jsonx's template language, compiled to Lit.
 *
 * Templates are plain HTML inside a <template> tag, plus four rules:
 *
 *   1. {{name}} prints a value, between tags or inside an attribute value.
 *      It's always HTML-escaped. Dotted names work: {{stats.done}}. {{.}} is
 *      the current item itself.
 *
 *   2. Logic is written as tags, which draw only what's inside them:
 *        <jx-each items="todos">…</jx-each>   repeat for each item; inside, names
 *                                             refer to the item. Items with an
 *                                             `id` are tracked by it.
 *        <jx-if test="error">…</jx-if>         draw if `error` is truthy
 *        <jx-else-if test="!todos">…</jx-else-if>   `!` means falsy or empty list
 *        <jx-else>…</jx-else>
 *      Inside <table> and <select> the browser moves unknown tags away, so
 *      there you put the logic on the element instead: <tr jx:each="rows">,
 *      <option jx:if="x">, jx:else-if="y", jx:else.
 *
 *   3. Attributes are smart. When an attribute's whole value is one {{name}}:
 *        - if the element has a property with that name (value, checked, ...),
 *          the live property is set, so form controls always show the view
 *        - otherwise true/false adds/removes the attribute, and anything else
 *          becomes the attribute's text
 *
 *   4. class:done="{{done}}" turns the class "done" on or off.
 *
 *   jx:vals="id product" sends the values named, as JSON: {"id": 3, "product": "Tea"}.
 *   A dotted name sends its last part (todo.id as "id"), and id=todo.id renames.
 *
 *   Reuse another template with <template jx:use="#todo-item"></template>.
 *
 * How it works: we walk the template's HTML once and write it back out as a Lit
 * template, with a "hole" wherever a value goes. Lit then updates only those
 * holes when the data changes: no HTML parsing, no comparing trees, and elements
 * that didn't change are left completely alone.
 */
import { html, render, nothing, noChange } from "./vendor/lit-html/lit-html.js";
import { directive, Directive } from "./vendor/lit-html/directive.js";
import { repeat } from "./vendor/lit-html/directives/repeat.js";

// ---------------------------------------------------------------------------
// Looking up names in the data
// ---------------------------------------------------------------------------

// `stack` is the list of contexts, innermost last: [view, todo, ...].
// A name is looked up from the innermost context outwards, so inside
// <jx-each items="todos">, {{title}} is the todo's title and {{filter}} still works.
//
// Names are split on dots once, when the template is compiled: path("a.b") is
// ["a", "b"], and path(".") is DOT.
var DOT = [];
function path(name) {
  name = name.trim();
  return name === "." ? DOT : name.split(".");
}

function lookup(stack, parts) {
  var found = -1, value;
  if (parts === DOT) {
    found = stack.length - 1;
    value = stack[found];
  } else {
    for (var i = stack.length - 1; i >= 0; i--) {
      var context = stack[i];
      if (context != null && typeof context === "object" && parts[0] in context) {
        found = i;
        value = context;
        for (var p = 0; p < parts.length && value != null; p++) value = value[parts[p]];
        break;
      }
    }
  }
  // Tell any list row being drawn that it read a name from outside its item.
  for (var r = 0; r < recorders.length; r++) {
    if (found < recorders[r].depth) recorders[r].reads.push({ parts: parts, value: value });
  }
  return value;
}

// "Empty" means: false, null, undefined, "", 0, or an empty list.
function isEmpty(value) {
  return !value || (Array.isArray(value) && value.length === 0);
}

function text(value) {
  return value == null ? "" : String(value);
}

// ---------------------------------------------------------------------------
// The two special attribute behaviours, as Lit directives
// ---------------------------------------------------------------------------

// Rule 3: a whole-value attribute like checked="{{done}}" or value="{{draft}}".
// While an error is drawn on top of a view, form controls keep what you typed
// (their value and checked properties are left alone).
var keepTyping = false;

// A view answers a request, so it can't know about typing that happened after
// the request was sent. Controls changed since then keep what's in them (the
// next answer catches up). `drawingFor` is when that request was sent.
var drawingFor = Infinity;
// (Only "input": a "change" also fires on Enter, after the request it sent.)
document.addEventListener("input", edited, true);
function edited(event) { event.composedPath()[0].__jxEditedAt = performance.now(); }

// A <select>'s value is set after its <option>s are drawn, or it can't match.
var pendingValues = [];
function setValuesLater(el, value) {
  if (!pendingValues.length) queueMicrotask(setPendingValues);
  pendingValues.push([el, value]);
}
export function setPendingValues() {
  var list = pendingValues;
  pendingValues = [];
  list.forEach(function (pair) { if (pair[0].value !== pair[1]) pair[0].value = pair[1]; });
}

class SmartAttribute extends Directive {
  update(part, [value]) {
    var el = part.element;
    var name = part.name;
    if (name in el && !name.startsWith("aria")) {
      if ((name === "value" || name === "checked") && (keepTyping || el.__jxEditedAt > drawingFor)) return noChange;
      // A property: compare with the element's live value, so typing or
      // clicking never leaves it out of step with the view.
      var next = value == null ? (typeof el[name] === "boolean" ? false : "") : value;
      if (name === "value" && el.localName !== "option") setValuesLater(el, next);
      else if (el[name] !== next) el[name] = next;
    } else if (typeof value === "boolean") {
      el.toggleAttribute(name, value);
    } else if (value == null) {
      el.removeAttribute(name);
    } else {
      el.setAttribute(name, String(value));
    }
    return noChange;
  }
  render() { return noChange; }
}
var smartAttribute = directive(SmartAttribute);

// jx:emit: the element keeps the item it was drawn for, as el.__jxItem.
class EmitItem extends Directive {
  update(part, [item]) {
    part.element.__jxItem = item;
    return noChange;
  }
  render() { return noChange; }
}
var emitItem = directive(EmitItem);

// jx:markdown="{{article.body}}" and jx:html="{{bodyHtml}}" draw text as
// Markdown or HTML, inside that element. Everything is cleaned with DOMPurify
// first: no scripts, no onclick=, no javascript: links. Anything jsonx would
// act on is removed too (jx- attributes, templates, forms), so the text can't
// make requests. Each library loads the first time a page needs it: a page
// with only jx:html never loads marked.
var libraries = {};
var LIBRARIES = {
  purify: ["./vendor/dompurify/purify.js", function (m) { return m.default; }],
  marked: ["./vendor/marked/marked.js", function (m) { return m.marked; }]
};
function needs(kind) { return kind === "markdown" ? ["purify", "marked"] : ["purify"]; }
function loaded(kind) { return needs(kind).every(function (name) { return libraries[name]; }); }
function loadLibraries(kind) {
  return Promise.all(needs(kind).map(function (name) {
    var lib = LIBRARIES[name];
    lib.loading = lib.loading || import(new URL(lib[0], import.meta.url).href).then(function (m) { libraries[name] = lib[1](m); });
    return lib.loading;
  }));
}

var CLEAN = {
  FORBID_TAGS: ["style", "template", "form", "input", "button", "textarea", "select", "iframe", "object", "embed"],
  FORBID_ATTR: ["style"],
  ALLOW_DATA_ATTR: false,
  // ids from the text are prefixed, so they can't clash with the page's own.
  SANITIZE_NAMED_PROPS: true
};

export function cleanHTML(kind, value) {
  var source = value == null ? "" : String(value);
  var html = kind === "markdown" ? libraries.marked.parse(source, { async: false }) : source;
  return libraries.purify.sanitize(html, CLEAN);
}

class RichText extends Directive {
  update(part, [kind, value]) {
    if (this.value === value) return noChange;
    this.value = value;
    var el = part.element;
    var draw = function () { if (part.element.__jxRich === value) el.innerHTML = cleanHTML(kind, value); };
    el.__jxRich = value;
    if (loaded(kind)) draw();
    else loadLibraries(kind).then(draw);
    return noChange;
  }
  render() { return noChange; }
}
var richText = directive(RichText);

// Rule 4: class:done="{{done}}".
class ToggleClass extends Directive {
  update(part, [className, on]) {
    part.element.classList.toggle(className, !isEmpty(on));
    return noChange;
  }
  render() { return noChange; }
}
var toggleClass = directive(ToggleClass);

// ---------------------------------------------------------------------------
// Skipping work that can't change anything
// ---------------------------------------------------------------------------
//
// The server sends a whole new view every time, so most of it is usually the
// same as last time. Two steps let jsonx skip the parts that didn't change:
//
//   1. share(old, new) compares the new view with the last one, and wherever a
//      part is equal, it reuses the old object. So after sharing, "unchanged"
//      simply means "the same object" (===).
//   2. Each <jx-each> row remembers the item it drew, and every name it read
//      from outside the item (like {{filter}}). If the item is the same object
//      and those names have the same values, the row is skipped: none of its
//      holes are even looked at.
//
// One exception: form controls show the view, even after someone has typed or
// clicked in them. So a row (or region) containing a control that was changed
// since the last draw is always drawn, so its value can be put right.

function hasId(item) {
  return item !== null && typeof item === "object" && "id" in item;
}

function share(old, next) {
  if (old === next) return old;
  if (old === null || next === null || typeof old !== "object" || typeof next !== "object") return next;
  if (Array.isArray(old) !== Array.isArray(next)) return next;
  var same = true, out, i;
  if (Array.isArray(next)) {
    // Lists of things with ids are matched by id, so a moved item still matches.
    var byId = next.length && next.every(hasId) && old.every(hasId) ? new Map(old.map(function (o) { return [o.id, o]; })) : null;
    same = old.length === next.length;
    out = new Array(next.length);
    for (i = 0; i < next.length; i++) {
      out[i] = share(byId ? byId.get(next[i].id) : old[i], next[i]);
      if (out[i] !== old[i]) same = false;
    }
    return same ? old : out;
  }
  var proto = Object.getPrototypeOf(next);
  if (proto !== Object.prototype && proto !== null) return next; // not plain JSON: leave it
  var keys = Object.keys(next);
  same = keys.length === Object.keys(old).length;
  out = {};
  for (i = 0; i < keys.length; i++) {
    var k = keys[i];
    out[k] = share(old[k], next[k]);
    if (out[k] !== old[k] || !(k in old)) same = false;
  }
  return same ? old : out;
}

// Rows being drawn right now, each recording the names it reads from outside its item.
var recorders = [];

// Form controls changed by the person since the region was last drawn.
var touched = new Set();

// Does the row drawn in `part` contain a control that was changed?
function hasTouched(part) {
  if (!touched.size) return false;
  for (var node = part.startNode.nextSibling; node && node !== part.endNode; node = node.nextSibling) {
    for (var el of touched) {
      if (node === el || (node.contains && node.contains(el))) return true;
    }
  }
  return false;
}

// One <jx-each> row: row(item, stack, draw).
class Row extends Directive {
  update(part, [item, stack, draw]) {
    if (this.item === item && !hasTouched(part) && this.reads.every(function (read) {
      return lookup(stack, read.parts) === read.value;
    })) {
      return noChange;
    }
    var recorder = { depth: stack.length, reads: [] };
    recorders.push(recorder);
    try {
      var result = draw(stack.concat([item]));
    } finally {
      recorders.pop();
    }
    this.item = item;
    this.reads = recorder.reads;
    return result;
  }
  render() { return noChange; }
}
var row = directive(Row);

// ---------------------------------------------------------------------------
// Compiling: <template> -> a Lit template
// ---------------------------------------------------------------------------

var TAG = /\{\{\s*([^}]+?)\s*\}\}/g;
var WHOLE = /^\{\{\s*([^}]+?)\s*\}\}$/;
var VOID = /^(area|base|br|col|embed|hr|img|input|link|meta|source|track|wbr)$/;

function escapeText(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function escapeAttribute(s) {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

// Lit recognises a template by its strings array, and checks it has the `raw`
// property real template literals have. Ours come only from your page's
// templates, never from data, so building one is safe.
function templateStrings(strings) {
  var array = strings.slice();
  Object.defineProperty(array, "raw", { value: strings.slice() });
  return Object.freeze(array);
}

// Builds a Lit template piece by piece: static HTML, and holes.
// Each hole is a function (stack) -> value.
function Builder() {
  this.strings = [""];
  this.holes = [];
}
Builder.prototype.add = function (staticHtml) {
  this.strings[this.strings.length - 1] += staticHtml;
};
Builder.prototype.hole = function (fn) {
  this.holes.push(fn);
  this.strings.push("");
};
Builder.prototype.finish = function () {
  var strings = templateStrings(this.strings);
  var holes = this.holes;
  return function (stack) {
    return html(strings, ...holes.map(function (hole) { return hole(stack); }));
  };
};

// `nodes` are DOM nodes from the <template>. `ctx` holds `partial(selector)`.
// Returns (stack) -> Lit TemplateResult.
function compileNodes(nodes, ctx) {
  var b = new Builder();
  compileInto(Array.from(nodes), b, ctx);
  return b.finish();
}

// The logic tags, and the attribute forms kept for tables and selects (where
// the browser's HTML parser moves unknown tags out of the way).
function isIf(node) {
  return node.nodeType === Node.ELEMENT_NODE && (node.localName === "jx-if" || node.hasAttribute("jx:if"));
}
function isElse(node) {
  return node.nodeType === Node.ELEMENT_NODE &&
    (node.localName === "jx-else-if" || node.localName === "jx-else" ||
     node.hasAttribute("jx:else-if") || node.hasAttribute("jx:else"));
}
function isBlank(node) {
  return node.nodeType === Node.COMMENT_NODE || (node.nodeType === Node.TEXT_NODE && !node.nodeValue.trim());
}

// One branch of an if / else-if / else chain: { test, render }.
// `test` is null for the final else.
function branch(node, ctx) {
  var tag = node.localName;
  if (tag === "jx-if" || tag === "jx-else-if" || tag === "jx-else") {
    var test = tag === "jx-else" ? null : node.getAttribute("test");
    if (tag !== "jx-else" && test === null) throw new Error("[jsonx] <" + tag + "> needs test=\"name\"");
    return { test: test === null ? null : condition(test), render: compileNodes(node.childNodes, ctx) };
  }
  var copy = node.cloneNode(true);
  var attrTest = copy.hasAttribute("jx:else") ? null : (copy.getAttribute("jx:if") ?? copy.getAttribute("jx:else-if"));
  ["jx:if", "jx:else-if", "jx:else"].forEach(function (a) { copy.removeAttribute(a); });
  return { test: attrTest === null ? null : condition(attrTest), render: compileNodes([copy], ctx) };
}

// test="done", or test="!done" for the opposite.
function condition(test) {
  test = test.trim();
  return { negate: test[0] === "!", parts: path(test.replace(/^!\s*/, "")) };
}
function passes(test, stack) {
  return isEmpty(lookup(stack, test.parts)) === test.negate;
}

function compileInto(nodes, b, ctx) {
  for (var i = 0; i < nodes.length; i++) {
    var node = nodes[i];
    if (isElse(node)) throw new Error("[jsonx] <" + node.localName + "> must come right after <jx-if> or <jx-else-if>");
    if (!isIf(node)) { compileNode(node, b, ctx); continue; }

    // Gather the chain: <jx-if>, then any <jx-else-if>s, then maybe <jx-else>.
    // Only whitespace and comments may sit between them.
    var branches = [branch(node, ctx)];
    var next = i + 1;
    while (branches[branches.length - 1].test !== null) {
      var k = next;
      while (k < nodes.length && isBlank(nodes[k])) k++;
      if (k >= nodes.length || !isElse(nodes[k])) break;
      branches.push(branch(nodes[k], ctx));
      next = k + 1;
    }
    i = next - 1;
    b.hole(function (branches) {
      return function (stack) {
        for (var n = 0; n < branches.length; n++) {
          if (branches[n].test === null || passes(branches[n].test, stack)) return branches[n].render(stack);
        }
        return nothing;
      };
    }(branches));
  }
}

// Repeats `renderItem` for each item of the list called `name`. Items with an
// `id` are tracked by it. A single object (not a list) is drawn once.
function eachHole(name, render) {
  var parts = path(name);
  return function (stack) {
    var list = lookup(stack, parts);
    if (isEmpty(list)) return nothing;
    if (!Array.isArray(list)) list = [list];
    var renderItem = function (item) { return row(item, stack, render); };
    var keyed = list.every(function (item) { return item && typeof item === "object" && "id" in item; });
    return keyed ? repeat(list, function (item) { return item.id; }, renderItem) : list.map(renderItem);
  };
}

function compileNode(node, b, ctx) {
  if (node.nodeType === Node.TEXT_NODE) return compileText(node.nodeValue, b);
  if (node.nodeType === Node.COMMENT_NODE) return; // comments are dropped
  if (node.nodeType !== Node.ELEMENT_NODE) return;

  // <template jx:use="#todo-item">: render another template here.
  if (node.localName === "template" && node.hasAttribute("jx:use")) {
    var selector = node.getAttribute("jx:use");
    b.hole(function (stack) { return ctx.partial(selector)(stack); });
    return;
  }

  // <jx-each items="todos">…</jx-each>: repeat what's inside.
  if (node.localName === "jx-each") {
    var items = node.getAttribute("items");
    if (items === null) throw new Error('[jsonx] <jx-each> needs items="name"');
    b.hole(eachHole(items, compileNodes(node.childNodes, ctx)));
    return;
  }

  // The attribute form, for tables and selects: <tr jx:each="rows">.
  var each = node.getAttribute("jx:each");
  if (each !== null) {
    var copy = node.cloneNode(true);
    copy.removeAttribute("jx:each");
    b.hole(eachHole(each, compileNodes([copy], ctx)));
    return;
  }

  compileElement(node, b, ctx);
}

function compileElement(node, b, ctx) {
  var tag = node.localName;
  b.add("<" + tag);

  Array.from(node.attributes).forEach(function (attr) {
    compileAttribute(attr.name, attr.value, b);
  });

  // A <textarea>'s text can't hold a Lit hole, so {{x}} inside it becomes its value.
  if (tag === "textarea" && TAG.test(node.textContent)) {
    TAG.lastIndex = 0;
    var match = node.textContent.trim().match(WHOLE);
    if (!match) throw new Error("[jsonx] a <textarea> can only hold one {{name}}");
    b.add(" value=");
    var textareaPath = path(match[1]);
    b.hole(function (stack) { return smartAttribute(lookup(stack, textareaPath)); });
    b.add("></textarea>");
    return;
  }

  // jx:emit="pick" remembers the current item, so the event can carry it.
  if (node.hasAttribute("jx:emit")) {
    b.add(" jx:emit-item=");
    b.hole(function (stack) { return emitItem(stack[stack.length - 1]); });
  }

  b.add(">");
  if (VOID.test(tag)) return;

  // jx:markdown and jx:html own the element's content (anything inside is ignored).
  if (node.hasAttribute("jx:markdown") || node.hasAttribute("jx:html")) {
    b.add("</" + tag + ">");
    return;
  }

  // A <style> (say, in a component) is kept as it is: CSS isn't HTML.
  if (tag === "style") {
    b.add(node.textContent + "</style>");
    return;
  }

  // A nested <template> (say, a region inside this one) is kept as it is.
  var children = tag === "template" ? node.content.childNodes : node.childNodes;
  if (tag === "template") {
    b.add(Array.from(children).map(function (c) { return c.outerHTML || escapeText(c.nodeValue || ""); }).join(""));
  } else {
    compileInto(Array.from(children), b, ctx);
  }
  b.add("</" + tag + ">");
}

function compileText(value, b) {
  var last = 0;
  value.replace(TAG, function (whole, name, index) {
    b.add(escapeText(value.slice(last, index)));
    var parts = path(name);
    b.hole(function (stack) { var v = lookup(stack, parts); return v == null ? nothing : String(v); });
    last = index + whole.length;
    return whole;
  });
  b.add(escapeText(value.slice(last)));
}

function compileAttribute(name, value, b) {
  var whole = value.trim().match(WHOLE);

  // jx:markdown="{{body}}", jx:html="{{body}}": the element's content.
  if (name === "jx:markdown" || name === "jx:html") {
    if (!whole) throw new Error('[jsonx] ' + name + '="…" must be exactly one {{name}}');
    var kind = name === "jx:markdown" ? "markdown" : "html";
    loadLibraries(kind); // start now, so they're likely ready by the first draw
    var richPath = path(whole[1]);
    b.add(" " + name + "=");
    b.hole(function (stack) { return richText(kind, lookup(stack, richPath)); });
    return;
  }

  // jx:vals="id product" sends those values by name, as they are (a number
  // stays a number). The JSON form, jx:vals='{"id": {{id}}}', still works.
  if (name === "jx:vals" && /^\s*[\w$][\w$.=\s]*$/.test(value)) {
    var picks = value.trim().split(/\s+/).map(function (item) {
      var pair = item.split("=");
      var from = pair[1] || pair[0];
      return { key: pair[1] ? pair[0] : from.split(".").pop(), path: path(from) };
    });
    b.add(" jx:vals=");
    b.hole(function (stack) {
      var picked = {};
      picks.forEach(function (pick) { picked[pick.key] = lookup(stack, pick.path); });
      return JSON.stringify(picked);
    });
    return;
  }

  // class:done="{{done}}"
  if (name.startsWith("class:")) {
    if (!whole) throw new Error('[jsonx] ' + name + '="…" must be exactly one {{name}}');
    var className = name.slice(6);
    b.add(" " + name + "=");
    var classPath = path(whole[1]);
    b.hole(function (stack) { return toggleClass(className, lookup(stack, classPath)); });
    return;
  }

  // A whole-value attribute: smart (rule 3).
  if (whole) {
    b.add(" " + name + "=");
    var wholePath = path(whole[1]);
    b.hole(function (stack) { return smartAttribute(lookup(stack, wholePath)); });
    return;
  }

  // No tags: static. Some tags mixed with text: Lit joins the parts into a string.
  TAG.lastIndex = 0;
  if (!TAG.test(value)) {
    b.add(" " + name + '="' + escapeAttribute(value) + '"');
    return;
  }
  TAG.lastIndex = 0;
  b.add(" " + name + '="');
  var last = 0;
  value.replace(TAG, function (tagText, tagName, index) {
    b.add(escapeAttribute(value.slice(last, index)));
    var tagPath = path(tagName);
    b.hole(function (stack) { return text(lookup(stack, tagPath)); });
    last = index + tagText.length;
    return tagText;
  });
  b.add(escapeAttribute(value.slice(last)) + '"');
}

// ---------------------------------------------------------------------------
// The public part
// ---------------------------------------------------------------------------

// Compiles a <template> element. `find(selector)` returns another <template>,
// for jx:use. Returns renderInto(data, target).
// Compiles a <template> to view(data) -> a Lit TemplateResult, for code that
// renders with Lit itself (jsonx components are LitElements).
export function compileView(templateElement, find) {
  var template = compileParts(templateElement, find);
  return function (data) { return template([data]); };
}

function compileParts(templateElement, find) {
  var partials = {};
  var ctx = {
    partial: function (selector) {
      if (!partials[selector]) {
        var other = find(selector);
        if (!other) throw new Error('[jsonx] jx:use "' + selector + '" matched nothing');
        partials[selector] = compileNodes(Array.from(other.content.childNodes), ctx);
      }
      return partials[selector];
    }
  };
  return compileNodes(Array.from(templateElement.content.childNodes), ctx);
}

export function compileTemplate(templateElement, find) {
  var template = compileParts(templateElement, find);

  // `keepInputs`: leave form controls' values alone (used when showing an error).
  // `since`: when the request this view answers was sent (see drawingFor).
  return function renderInto(data, target, keepInputs, since) {
    // The first time, clear any placeholder (like a loading skeleton).
    // After that, Lit owns the target and updates it in place.
    if (!target.__jxRendered) {
      target.replaceChildren();
      target.__jxRendered = true;
      target.__jxTouched = new Set();
      var touch = function (event) { target.__jxTouched.add(event.target); };
      target.addEventListener("input", touch, true);
      target.addEventListener("change", touch, true);
    }

    // Reuse what's unchanged from the last view. If nothing changed at all, and
    // no control was touched, there's nothing to do.
    var sameTemplate = target.__jxDrawnWith === template;
    if (sameTemplate) data = share(target.__jxDrawn, data);
    if (sameTemplate && data === target.__jxDrawn && !target.__jxTouched.size) return;

    keepTyping = !!keepInputs;
    drawingFor = since === undefined ? Infinity : since;
    touched = target.__jxTouched;
    try {
      render(template([data]), target);
      setPendingValues();
    } finally {
      keepTyping = false;
      drawingFor = Infinity;
      touched.clear();
      touched = new Set();
    }
    target.__jxDrawn = data;
    target.__jxDrawnWith = template;
  };
}
