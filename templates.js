/*
 * templates.js — jsonx's template language, compiled to Lit.
 *
 * Templates are plain HTML inside a <template> tag, plus four rules:
 *
 *   1. ${name} prints a value, between tags or inside an attribute value.
 *      It's always HTML-escaped. Dotted names work: ${stats.done}. ${.} is
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
 *      there you put the logic on the element instead: <tr jx-each="rows">,
 *      <option jx-if="x">, jx-else-if="y", jx-else.
 *
 *   3. Attributes are smart. When an attribute's whole value is one ${name}:
 *        - if the element has a property with that name (value, checked, ...),
 *          the live property is set, so form controls always show the view
 *        - otherwise true/false adds/removes the attribute, and anything else
 *          becomes the attribute's text
 *
 *   4. class:done="${done}" turns the class "done" on or off.
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
// <jx-each items="todos">, ${title} is the todo's title and ${filter} still works.
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

// Rule 3: a whole-value attribute like checked="${done}" or value="${draft}".
// While an error is drawn on top of a view, form controls keep what you typed
// (their value and checked properties are left alone).
var keepTyping = false;

class SmartAttribute extends Directive {
  update(part, [value]) {
    var el = part.element;
    var name = part.name;
    if (name in el && !name.startsWith("aria")) {
      if (keepTyping && (name === "value" || name === "checked")) return noChange;
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

// Rule 4: class:done="${done}".
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

var TAG = /\$\{\s*([^}]+?)\s*\}/g;
var WHOLE = /^\$\{\s*([^}]+?)\s*\}$/;
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
  return node.nodeType === Node.ELEMENT_NODE && (node.localName === "jx-if" || node.hasAttribute("jx-if"));
}
function isElse(node) {
  return node.nodeType === Node.ELEMENT_NODE &&
    (node.localName === "jx-else-if" || node.localName === "jx-else" ||
     node.hasAttribute("jx-else-if") || node.hasAttribute("jx-else"));
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
    return { test: test, render: compileNodes(node.childNodes, ctx) };
  }
  var copy = node.cloneNode(true);
  var attrTest = copy.hasAttribute("jx-else") ? null : (copy.getAttribute("jx-if") ?? copy.getAttribute("jx-else-if"));
  ["jx-if", "jx-else-if", "jx-else"].forEach(function (a) { copy.removeAttribute(a); });
  return { test: attrTest, render: compileNodes([copy], ctx) };
}

// test="done", or test="!done" for the opposite.
function passes(test, stack) {
  test = test.trim();
  var negate = test[0] === "!";
  return isEmpty(lookup(stack, test.replace(/^!\s*/, ""))) === negate;
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
  return function (stack) {
    var list = lookup(stack, name.trim());
    if (isEmpty(list)) return nothing;
    if (!Array.isArray(list)) list = [list];
    var renderItem = function (item) { return render(stack.concat([item])); };
    var keyed = list.every(function (item) { return item && typeof item === "object" && "id" in item; });
    return keyed ? repeat(list, function (item) { return item.id; }, renderItem) : list.map(renderItem);
  };
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

  // <jx-each items="todos">…</jx-each>: repeat what's inside.
  if (node.localName === "jx-each") {
    var items = node.getAttribute("items");
    if (items === null) throw new Error('[jsonx] <jx-each> needs items="name"');
    b.hole(eachHole(items, compileNodes(node.childNodes, ctx)));
    return;
  }

  // The attribute form, for tables and selects: <tr jx-each="rows">.
  var each = node.getAttribute("jx-each");
  if (each !== null) {
    var copy = node.cloneNode(true);
    copy.removeAttribute("jx-each");
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

  // A <textarea>'s text can't hold a Lit hole, so ${x} inside it becomes its value.
  if (tag === "textarea" && TAG.test(node.textContent)) {
    TAG.lastIndex = 0;
    var match = node.textContent.trim().match(WHOLE);
    if (!match) throw new Error("[jsonx] a <textarea> can only hold one ${name}");
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
    compileInto(Array.from(children), b, ctx);
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
  var whole = value.trim().match(WHOLE);

  // class:done="${done}"
  if (name.startsWith("class:")) {
    if (!whole) throw new Error('[jsonx] ' + name + '="…" must be exactly one ${name}');
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

  // `keepInputs`: leave form controls' values alone (used when showing an error).
  return function renderInto(data, target, keepInputs) {
    // The first time, clear any placeholder (like a loading skeleton).
    // After that, Lit owns the target and updates it in place.
    if (!target.__jxRendered) {
      target.replaceChildren();
      target.__jxRendered = true;
    }
    keepTyping = !!keepInputs;
    try {
      render(template([data]), target);
    } finally {
      keepTyping = false;
    }
  };
}
