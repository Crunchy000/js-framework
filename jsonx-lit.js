/*
 * jsonx-lit.js — Mustache templates, rendered by Lit.
 *
 *   <script type="module" src="jsonx-lit.js"></script>
 *   <script type="text/mustache-lit" id="todo-app"> ...Mustache... </script>
 *
 * You write ordinary, logic-less Mustache. Instead of turning it into an HTML
 * string (which the browser must parse, and the page must swap or morph), this
 * engine turns it into a Lit template once. After that, each update only touches
 * the values that changed: no HTML parsing, no comparing trees, and elements
 * that didn't change are left completely alone.
 *
 * Lit has one rule you need to know: values can only go in attribute values or
 * between tags, never loose inside a tag. So instead of
 *     <wa-checkbox {{#done}}checked{{/done}}>
 * write one of Lit's binding forms:
 *     ?checked="{{done}}"   turns the attribute on or off
 *     .checked="{{done}}"   sets the live property (best for form controls)
 *     class="{{#done}}done{{/done}}"   plain attributes take text, sections included
 *
 * Supported Mustache: {{name}}, {{a.b}}, {{.}}, {{{raw}}}, {{#section}}, {{^inverted}},
 * {{> partial}} (a template's id), and {{! comments}}. Lists whose items have an `id`
 * are keyed by it, so adding or removing one item only adds or removes that row.
 *
 * Templates must come from your page, never from data: like any template engine,
 * a template can contain any HTML.
 */
import { html, render, nothing } from "./vendor/lit-html/lit-html.js";
import { repeat } from "./vendor/lit-html/directives/repeat.js";
import { live } from "./vendor/lit-html/directives/live.js";
import { unsafeHTML } from "./vendor/lit-html/directives/unsafe-html.js";

// ---------------------------------------------------------------------------
// 1. Mustache text -> a tree of nodes
// ---------------------------------------------------------------------------

// Returns a list of nodes: strings (plain HTML), and objects for tags:
//   { type: "var", name, raw }  { type: "section", name, inverted, children }  { type: "partial", name }
function parse(text) {
  var root = [];
  var stack = [{ children: root }];
  var tag = /\{\{(\{?)\s*([#^\/>!&]?)\s*([^}]*?)\s*\}?\}\}/g;
  var last = 0;
  var match;

  while ((match = tag.exec(text))) {
    var current = stack[stack.length - 1].children;
    if (match.index > last) current.push(text.slice(last, match.index));
    last = tag.lastIndex;

    var triple = match[1] === "{";
    var kind = match[2];
    var name = match[3];

    if (kind === "!") continue;
    if (kind === "#" || kind === "^") {
      var section = { type: "section", name: name, inverted: kind === "^", children: [] };
      current.push(section);
      stack.push(section);
    } else if (kind === "/") {
      var open = stack.pop();
      if (!open.name || open.name !== name) {
        throw new Error("[jsonx-lit] {{/" + name + "}} doesn't match " + (open.name ? "{{#" + open.name + "}}" : "anything"));
      }
    } else if (kind === ">") {
      current.push({ type: "partial", name: name });
    } else {
      current.push({ type: "var", name: name, raw: triple || kind === "&" });
    }
  }
  if (stack.length > 1) throw new Error("[jsonx-lit] {{#" + stack.pop().name + "}} is never closed");
  if (last < text.length) root.push(text.slice(last));
  return root;
}

// ---------------------------------------------------------------------------
// 2. Looking up names, Mustache style
// ---------------------------------------------------------------------------

// `stack` is the list of contexts, innermost last: [view, todo, ...].
// A name is looked up from the innermost context outwards, like Mustache.
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

// Mustache's idea of "falsy": false, null, undefined, "", 0 and empty lists.
function isEmpty(value) {
  return !value || (Array.isArray(value) && value.length === 0);
}

// ---------------------------------------------------------------------------
// 3. Nodes -> a Lit template
// ---------------------------------------------------------------------------
//
// A Lit template is a list of static strings with "holes" between them. We build
// that list once per template (and once per section body), and keep it, because
// Lit recognises a template by its strings: same strings, so it only updates holes.
//
// To know what kind of hole each tag makes, we follow the HTML as we go:
// between tags a hole holds content; inside an attribute value it holds text.

var TEXT = 0, TAG = 1, QUOTED = 2, COMMENT = 3;

// Moves the HTML state forward over a piece of static HTML.
function advance(state, text) {
  for (var i = 0; i < text.length; i++) {
    var c = text[i];
    if (state.mode === TEXT) {
      if (text.startsWith("<!--", i)) { state.mode = COMMENT; i += 3; }
      else if (c === "<" && /[a-zA-Z\/]/.test(text[i + 1] || "")) state.mode = TAG;
    } else if (state.mode === TAG) {
      if (c === ">") state.mode = TEXT;
      else if (c === '"' || c === "'") { state.mode = QUOTED; state.quote = c; }
    } else if (state.mode === QUOTED) {
      if (c === state.quote) state.mode = TAG;
    } else if (state.mode === COMMENT) {
      if (text.startsWith("-->", i)) { state.mode = TEXT; i += 2; }
    }
  }
}

// Makes an array that Lit accepts as template strings. Lit checks for the `raw`
// property that real template literals have. This is safe here because the
// strings only ever come from your page's templates, never from data.
function templateStrings(strings) {
  var array = strings.slice();
  Object.defineProperty(array, "raw", { value: strings.slice() });
  return Object.freeze(array);
}

function where(text) {
  var snippet = text.slice(-40).replace(/\s+/g, " ").trim();
  return snippet ? ' after "…' + snippet + '"' : "";
}

// Compiles a list of nodes (that start between tags) into a function:
//   (stack, engine) -> Lit TemplateResult
function compileContent(nodes, engine) {
  var strings = [""];
  var holes = [];                          // one function per hole: (stack) -> value
  var state = { mode: TEXT, quote: null };
  var html_so_far = "";                    // for error messages
  var pendingAttribute = null;             // an attribute value made of several parts

  function addStatic(text) {
    strings[strings.length - 1] += text;
    html_so_far += text;
    advance(state, text);
  }

  function addHole(fn) {
    holes.push(fn);
    strings.push("");
  }

  for (var i = 0; i < nodes.length; i++) {
    var node = nodes[i];
    if (typeof node === "string") { addStatic(node); continue; }

    if (state.mode === TEXT) {
      addHole(contentHole(node, engine));
    } else if (state.mode === QUOTED) {
      // Inside an attribute value: work out the attribute's name and prefix.
      var before = strings[strings.length - 1];
      var attr = before.match(/([.?@]?)([^\s"'=<>\/]+)\s*=\s*["'][^"']*$/);
      var prefix = attr ? attr[1] : "";
      var startsValue = /=\s*["']$/.test(before);
      var endsValue = typeof nodes[i + 1] === "string" ? /^["']/.test(nodes[i + 1]) : false;
      if (prefix && !(startsValue && endsValue)) {
        throw new Error("[jsonx-lit] " + prefix + attr[2] + "=\"…\" must hold exactly one {{tag}}" + where(html_so_far));
      }
      addHole(attributeHole(node, prefix, engine));
    } else if (state.mode === COMMENT) {
      throw new Error("[jsonx-lit] Mustache tags can't go inside HTML comments" + where(html_so_far));
    } else {
      throw new Error(
        "[jsonx-lit] Lit can't put {{" + (node.name || "") + "}} loose inside a tag" + where(html_so_far) + ". " +
        'Put it in an attribute value, e.g. ?checked="{{done}}" or .value="{{draft}}".'
      );
    }
  }
  if (state.mode !== TEXT) throw new Error("[jsonx-lit] a tag or attribute is never closed" + where(html_so_far));

  var litStrings = templateStrings(strings);
  return function (stack) {
    var values = holes.map(function (hole) { return hole(stack); });
    return html(litStrings, ...values);
  };
}

// A hole between tags.
function contentHole(node, engine) {
  if (node.type === "var") {
    return function (stack) {
      var value = lookup(stack, node.name);
      if (value == null) return nothing;
      return node.raw ? unsafeHTML(String(value)) : String(value);   // Lit escapes plain values
    };
  }

  if (node.type === "partial") {
    return function (stack) { return engine.partial(node.name)(stack); };
  }

  // A section: repeat for lists, show once for true values, or show when empty.
  var body = compileContent(node.children, engine);
  return function (stack) {
    var value = lookup(stack, node.name);
    if (node.inverted) return isEmpty(value) ? body(stack) : nothing;
    if (isEmpty(value)) return nothing;
    if (Array.isArray(value)) {
      var renderItem = function (item) { return body(stack.concat([item])); };
      var keyed = value.every(function (item) { return item && typeof item === "object" && "id" in item; });
      return keyed ? repeat(value, function (item) { return item.id; }, renderItem) : value.map(renderItem);
    }
    return body(typeof value === "object" ? stack.concat([value]) : stack);
  };
}

// A hole inside an attribute value. Lit joins several holes in one attribute itself.
function attributeHole(node, prefix, engine) {
  if (node.type === "partial") throw new Error("[jsonx-lit] {{> " + node.name + "}} can't go in an attribute");

  if (node.type === "var") {
    return function (stack) {
      var value = lookup(stack, node.name);
      if (prefix === ".") return live(value);          // compare with the element's live value
      if (prefix === "?") return !!value && !(Array.isArray(value) && value.length === 0);
      return value == null ? "" : String(value);
    };
  }

  if (prefix) throw new Error("[jsonx-lit] use a plain {{name}} in " + prefix + "attributes, not a section");
  // A section inside an attribute value produces text: class="{{#done}}done{{/done}}"
  var text = compileText(node.children);
  return function (stack) {
    var value = lookup(stack, node.name);
    if (node.inverted) return isEmpty(value) ? text(stack) : "";
    if (isEmpty(value)) return "";
    if (Array.isArray(value)) return value.map(function (item) { return text(stack.concat([item])); }).join("");
    return text(typeof value === "object" ? stack.concat([value]) : stack);
  };
}

// Sections inside attribute values: plain text, no HTML.
function compileText(nodes) {
  var parts = nodes.map(function (node) {
    if (typeof node === "string") return function () { return node; };
    if (node.type === "var") return function (stack) { var v = lookup(stack, node.name); return v == null ? "" : String(v); };
    if (node.type === "section") {
      var inner = compileText(node.children);
      return function (stack) {
        var value = lookup(stack, node.name);
        if (node.inverted) return isEmpty(value) ? inner(stack) : "";
        if (isEmpty(value)) return "";
        if (Array.isArray(value)) return value.map(function (item) { return inner(stack.concat([item])); }).join("");
        return inner(typeof value === "object" ? stack.concat([value]) : stack);
      };
    }
    throw new Error("[jsonx-lit] {{> " + node.name + "}} can't go in an attribute");
  });
  return function (stack) { return parts.map(function (part) { return part(stack); }).join(""); };
}

// ---------------------------------------------------------------------------
// 4. The jsonx engine
// ---------------------------------------------------------------------------

jsonx.engine("text/mustache-lit", function (text, lookupTemplate) {
  var partials = {};
  var engine = {
    partial: function (name) {
      if (!partials[name]) partials[name] = compileContent(parse(lookupTemplate("#" + name)), engine);
      return partials[name];
    }
  };
  var template = compileContent(parse(text), engine);

  // This engine draws straight into the target, instead of returning a string.
  // The first render clears whatever placeholder was there; after that, Lit
  // owns the target and updates it in place.
  var renderInto = function (data, target) {
    if (!target.__jxLit) {
      target.replaceChildren();
      target.__jxLit = true;
    }
    render(template([data]), target);
  };
  renderInto.into = true;
  return renderInto;
});
