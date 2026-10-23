/*
 * templates.js — jsonx's template language, compiled to Lit.
 *
 * Templates are plain HTML inside a <template> tag, plus four rules:
 *
 *   1. {{name}} prints a value, between tags or inside an attribute value.
 *      It's always HTML-escaped. Dotted names work: {{stats.done}}. {{.}} is
 *      the current item itself.
 *
 *   2. Logic goes on elements, as attributes:
 *        jx-each="todos"   repeat this element for each item; inside it, names
 *                          refer to the item. Items with an `id` are tracked by it.
 *        jx-if="error"     show this element only if `error` is truthy
 *        jx-if="!todos"    show it only if `todos` is falsy or an empty list
 *
 *   3. Attributes are smart. When an attribute's whole value is one {{name}}:
 *        - if the element has a property with that name (value, checked, ...),
 *          the live property is set, so form controls always show the view
 *        - otherwise true/false adds/removes the attribute, and anything else
 *          becomes the attribute's text
 *
 *   4. class:done="{{done}}" turns the class "done" on or off.
 *
 *   Reuse another template with <template jx-use="#todo-item"></template>.
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
// jx-each="todos", {{title}} is the todo's title and {{filter}} still works.
function lookup(stack, name) {
  if (name === ".") return stack[stack.length - 1];
  var parts = name.split(".");
  for (var i = stack.length - 1; i >= 0; i--) {
    var context = stack[i];
    if (context != null && typeof context === "object" && parts[0] in context) {
      var value = context;
      for (var p = 0; p < parts.length && value != null; p++) value = value[parts[p]];
      return value;
    }
  }
  return undefined;
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
class SmartAttribute extends Directive {
  update(part, [value]) {
    var el = part.element;
    var name = part.name;
    if (name in el && !name.startsWith("aria")) {
      // A property: compare with the element's live value, so typing or
      // clicking never leaves it out of step with the view.
      var next = value == null ? (typeof el[name] === "boolean" ? false : "") : value;
      if (el[name] !== next) el[name] = next;
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
// Compiling: <template> -> a Lit template
// ---------------------------------------------------------------------------

var TAG = /\{\{\s*([^}]+?)\s*\}\}/g;
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
  nodes.forEach(function (node) { compileNode(node, b, ctx); });
  return b.finish();
}

function compileNode(node, b, ctx) {
  if (node.nodeType === Node.TEXT_NODE) return compileText(node.nodeValue, b);
  if (node.nodeType === Node.COMMENT_NODE) return; // comments are dropped
  if (node.nodeType !== Node.ELEMENT_NODE) return;

  // <template jx-use="#todo-item">: render another template here.
  if (node.localName === "template" && node.hasAttribute("jx-use")) {
    var selector = node.getAttribute("jx-use");
    b.hole(function (stack) { return ctx.partial(selector)(stack); });
    return;
  }

  // jx-if and jx-each turn the element into its own little template.
  var each = node.getAttribute("jx-each");
  var condition = node.getAttribute("jx-if");
  if (each !== null || condition !== null) {
    var copy = node.cloneNode(true);
    copy.removeAttribute("jx-each");
    copy.removeAttribute("jx-if");
    var element = compileNodes([copy], ctx);
    b.hole(function (stack) {
      if (condition !== null) {
        var negate = condition.trim()[0] === "!";
        var value = lookup(stack, condition.trim().replace(/^!\s*/, ""));
        if (isEmpty(value) !== negate) return nothing;
      }
      if (each === null) return element(stack);
      var list = lookup(stack, each.trim());
      if (isEmpty(list)) return nothing;
      if (!Array.isArray(list)) list = [list];
      var renderItem = function (item) { return element(stack.concat([item])); };
      var keyed = list.every(function (item) { return item && typeof item === "object" && "id" in item; });
      return keyed ? repeat(list, function (item) { return item.id; }, renderItem) : list.map(renderItem);
    });
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
    var match = node.textContent.trim().match(/^\{\{\s*([^}]+?)\s*\}\}$/);
    if (!match) throw new Error("[jsonx] a <textarea> can only hold one {{name}}");
    b.add(" value=");
    b.hole(function (stack) { return smartAttribute(lookup(stack, match[1])); });
    b.add("></textarea>");
    return;
  }

  b.add(">");
  if (VOID.test(tag)) return;

  // A nested <template> (say, a region inside this one) is kept as it is.
  var children = tag === "template" ? node.content.childNodes : node.childNodes;
  if (tag === "template") {
    b.add(Array.from(children).map(function (c) { return c.outerHTML || escapeText(c.nodeValue || ""); }).join(""));
  } else {
    Array.from(children).forEach(function (child) { compileNode(child, b, ctx); });
  }
  b.add("</" + tag + ">");
}

function compileText(value, b) {
  var last = 0;
  value.replace(TAG, function (whole, name, index) {
    b.add(escapeText(value.slice(last, index)));
    b.hole(function (stack) { var v = lookup(stack, name); return v == null ? nothing : String(v); });
    last = index + whole.length;
    return whole;
  });
  b.add(escapeText(value.slice(last)));
}

function compileAttribute(name, value, b) {
  var whole = value.trim().match(/^\{\{\s*([^}]+?)\s*\}\}$/);

  // class:done="{{done}}"
  if (name.startsWith("class:")) {
    if (!whole) throw new Error('[jsonx] ' + name + '="…" must be exactly one {{name}}');
    var className = name.slice(6);
    b.add(" " + name + "=");
    b.hole(function (stack) { return toggleClass(className, lookup(stack, whole[1])); });
    return;
  }

  // A whole-value attribute: smart (rule 3).
  if (whole) {
    b.add(" " + name + "=");
    b.hole(function (stack) { return smartAttribute(lookup(stack, whole[1])); });
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
    b.hole(function (stack) { return text(lookup(stack, tagName)); });
    last = index + tagText.length;
    return tagText;
  });
  b.add(escapeAttribute(value.slice(last)) + '"');
}

// ---------------------------------------------------------------------------
// The public part
// ---------------------------------------------------------------------------

// Compiles a <template> element. `find(selector)` returns another <template>,
// for jx-use. Returns renderInto(data, target).
export function compileTemplate(templateElement, find) {
  var partials = {};
  var ctx = {
    partial: function (selector) {
      if (!partials[selector]) {
        var other = find(selector);
        if (!other) throw new Error('[jsonx] jx-use "' + selector + '" matched nothing');
        partials[selector] = compileNodes(Array.from(other.content.childNodes), ctx);
      }
      return partials[selector];
    }
  };
  var template = compileNodes(Array.from(templateElement.content.childNodes), ctx);

  return function renderInto(data, target) {
    // The first time, clear any placeholder (like a loading skeleton).
    // After that, Lit owns the target and updates it in place.
    if (!target.__jxRendered) {
      target.replaceChildren();
      target.__jxRendered = true;
    }
    render(template([data]), target);
  };
}
