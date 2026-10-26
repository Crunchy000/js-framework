/*
 * components.js — web components written as jsonx templates.
 *
 *   <template jx:component="user-card" props="name role avatar">
 *     <style>:host { display: block; }</style>
 *     <strong>{{name}}</strong> {{role}}
 *     <button jx:emit="pick">Choose</button>
 *   </template>
 *
 * defines <user-card> as a LitElement:
 *   - each prop is a reactive property, and an attribute too (favoritesCount is
 *     the attribute favorites-count). Set it either way: <user-card name="Ada">,
 *     or el.name = "Ada", or name="{{name}}" in a jsonx template, which sets the
 *     property, so objects and lists can be passed in.
 *   - the template draws the props, in shadow DOM, so its <style> stays inside
 *     and <slot> works.
 *   - jx:emit="pick" fires a "pick" event from the component when clicked, with
 *     the current item as event.detail. The page decides what happens.
 *   - jx- attributes inside work as usual (jsonx processes the shadow root).
 *
 * In a .jx file with a <script type="module">, a prop that isn't set comes
 * from the module's export with the same name, and redraws when it changes.
 *
 * jsonx defines these automatically when it finds them on the page or in a
 * .jx file pulled in with <template src="...">. It's a genuine LitElement, so
 * Lit apps can use it, subclass it, and await el.updateComplete.
 */
import { LitElement } from "./vendor/lit-element/lit-element.js";

function attributeName(prop) {
  return prop.replace(/[A-Z]/g, function (c) { return "-" + c.toLowerCase(); });
}


// Component libraries that load on demand (like Web Awesome's autoloader) only
// look at the page, not inside shadow roots. So for each tag used inside a
// component that isn't defined yet, put one hidden copy on the page, once.
var introduced = new Set();
function introduce(root) {
  root.querySelectorAll(":not(:defined)").forEach(function (el) {
    var tag = el.localName;
    if (introduced.has(tag) || tag.indexOf("-") === -1) return;
    introduced.add(tag);
    var holder = document.getElementById("jx-introduced");
    if (!holder) {
      holder = document.createElement("div");
      holder.id = "jx-introduced";
      holder.hidden = true;
      document.body.append(holder);
    }
    holder.append(document.createElement(tag));
  });
}

// props="start:number open:boolean items:json": an attribute is text unless
// its prop names a type. A bare attribute (<user-card selected>) is true.
var TYPES = {
  text: { fromAttribute: function (v) { return v === "" ? true : v; }, toAttribute: function (v) { return v; } },
  number: { fromAttribute: function (v) { return v === null ? undefined : Number(v); }, toAttribute: function (v) { return v == null ? null : String(v); } },
  boolean: { fromAttribute: function (v) { return v !== null && v !== "false"; }, toAttribute: function (v) { return v ? "" : null; } },
  json: { fromAttribute: function (v) { try { return JSON.parse(v); } catch (e) { return undefined; } }, toAttribute: function (v) { return JSON.stringify(v); } }
};

// Every live element with its own script, so jsonx.changed() can check them.
export var instances = new Set();

// `tools` is { compileView, process, bindProps, scopeValue, scopeGet, fingerprint } from jsonx.
export function defineComponent(template, tools) {
  var tag = template.getAttribute("jx:component");
  if (customElements.get(tag)) return;
  if (tag.indexOf("-") === -1) throw new Error('[jsonx] jx:component="' + tag + '" needs a dash in its name, like "user-card"');

  var types = {};
  var props = (template.getAttribute("props") || "").split(/[\s,]+/).filter(Boolean).map(function (spec) {
    var parts = spec.split(":");
    if (parts[1] && !TYPES[parts[1]]) throw new Error('[jsonx] prop type "' + parts[1] + '" isn\'t one of text, number, boolean, json');
    types[parts[0]] = parts[1] || "text";
    return parts[0];
  });
  // A plain <script> in the template is this component's own code: it runs
  // once for each element (see "Plain scripts" below).
  var script = Array.from(template.content.children).find(function (el) {
    return el.localName === "script" && !el.type;
  });
  var instanceCode = null;
  if (script) {
    script.remove();
    instanceCode = compileScript(script.textContent, props, (template.__jxSource || location.href) + "#" + tag);
  }
  var root = template.getRootNode();
  var view = tools.compileView(template, function (selector) {
    return root.querySelector(selector) || document.querySelector(selector);
  });

  // The component's own code, run once for each element.
  var setup = null;
  if (instanceCode) {
    setup = function (el) {
      var refs = {};
      var instance = instanceCode(el, function (name) {
        var own = el.__jxProp(name);
        return own !== undefined ? own : tools.scopeValue(el, name);
      }, refs);
      Object.defineProperty(instance, "refs", { value: refs }); // filled after each draw
      return instance;
    };
  }
  // <template jx:component="star-rating" form>: a form field. Its value is
  // the view's `value`, and forms and jsonx send it under the element's name.
  var isField = template.hasAttribute("form");

  var properties = {};
  props.forEach(function (prop) {
    properties[prop] = { attribute: attributeName(prop), converter: TYPES[types[prop]] };
  });

  var HOOKS = ["connected", "disconnected", "rendered"];

  class JsonxComponent extends LitElement {
    static get properties() { return properties; }
    static get formAssociated() { return isField; }

    // A component from a .jx file with a module carries that file's scope,
    // so fn: and jx:data inside it find the module's exports.
    constructor() {
      super();
      if (template.__jxScope) this.__jxScope = template.__jxScope;
      if (isField && this.attachInternals) this.internals = this.attachInternals();
    }

    connectedCallback() {
      super.connectedCallback();
      // A prop that isn't set comes from the module, if it exports one by
      // that name, and the component redraws when that export changes.
      tools.bindProps(this, props);
      if (setup && !this.__jxInstance) this.__jxStart();
      if (this.__jxInstance) instances.add(this);
      this.__jxHook("connected");
    }

    disconnectedCallback() {
      super.disconnectedCallback();
      instances.delete(this);
      this.__jxHook("disconnected");
    }

    // The instance: the script's names, live. Its functions are this
    // element's fn: actions, and become element methods too (el.reset()),
    // unless the element already has something by that name.
    __jxStart() {
      var self = this;
      var given = {};
      props.forEach(function (prop) { if (self.__jxProp(prop) !== undefined) given[prop] = self.__jxProp(prop); });
      var instance = this.__jxInstance = setup(this, given) || {};
      Object.keys(instance).forEach(function (key) {
        if (typeof instance[key] === "function" && HOOKS.indexOf(key) === -1 && !(key in self)) {
          self[key] = function () {
            var result = instance[key].apply(instance, arguments);
            Promise.resolve(result).finally(function () { self.__jxCheck(); });
            self.__jxCheck();
            return result;
          };
        }
      });
      this.__jxLast = tools.fingerprint(this.__jxState());
    }

    __jxHook(name) {
      var instance = this.__jxInstance;
      if (instance && typeof instance[name] === "function") instance[name].call(instance, this);
    }

    // The instance's data: everything in it but functions and refs.
    __jxState() {
      var instance = this.__jxInstance, data = {};
      if (!instance) return data;
      Object.keys(instance).forEach(function (key) {
        if (key !== "refs" && typeof instance[key] !== "function") data[key] = instance[key];
      });
      return data;
    }

    // Redraw if the instance's data changed (jsonx calls this after fn: calls).
    __jxCheck() {
      if (!this.__jxInstance) return;
      var now = tools.fingerprint(this.__jxState());
      if (Object.is(now, this.__jxLast)) return;
      this.__jxLast = now;
      this.requestUpdate();
    }

    // What the template draws: the module's values, then the instance's
    // state, then props set from outside, which win.
    render() {
      var data = {};
      for (var i = 0; i < props.length; i++) data[props[i]] = tools.scopeValue(this, props[i]);
      Object.assign(data, tools.copy(this.__jxState()));
      for (var j = 0; j < props.length; j++) {
        // A form field's value prop is only where it starts: once it has
        // state of its own, the person's choice wins.
        if (isField && props[j] === "value" && "value" in data) continue;
        if (this.__jxProp(props[j]) !== undefined) data[props[j]] = this.__jxProp(props[j]);
      }
      this.__jxView = data;
      return view(data);
    }

    // Wire up jx- attributes inside (jsonx also watches for later additions).
    firstUpdated() {
      tools.process(this.renderRoot);
    }

    updated() {
      introduce(this.renderRoot);
      var instance = this.__jxInstance;
      // jx:ref="input": refs.input in the script is that element.
      if (instance) {
        var refs = instance.refs;
        Object.keys(refs).forEach(function (key) { delete refs[key]; });
        this.renderRoot.querySelectorAll("[jx\\:ref]").forEach(function (el) { refs[el.getAttribute("jx:ref")] = el; });
      }
      if (this.internals && this.__jxView) this.internals.setFormValue(this.__jxView.value == null ? "" : String(this.__jxView.value));
      this.__jxHook("rendered");
    }
  }

  // Lit makes the props' accessors here; done before define, because define
  // upgrades elements already on the page straight away.
  JsonxComponent.finalize();

  // A prop's own value, as set from outside (not the view's).
  var litValue = null;
  JsonxComponent.prototype.__jxProp = function (name) {
    return name === "value" && litValue ? litValue.get.call(this) : this[name];
  };

  // A form field's value is its view's value: what it shows is what it sends.
  // Setting it (el.value = 3, or value="3") still works, as a starting value.
  if (isField) {
    litValue = Object.getOwnPropertyDescriptor(JsonxComponent.prototype, "value");
    Object.defineProperty(JsonxComponent.prototype, "value", {
      get: function () { return this.__jxView ? this.__jxView.value : litValue ? litValue.get.call(this) : undefined; },
      set: function (v) { if (litValue) litValue.set.call(this, v); },
      configurable: true
    });
  }

  customElements.define(tag, JsonxComponent);
}

// ---------------------------------------------------------------------------
// Plain scripts
// ---------------------------------------------------------------------------
//
// A plain <script> (not a module) in a .jx file is ordinary code:
//
//   <script>
//     let count = 0;
//     function up() { count++; }
//   </script>
//
// Its top-level names (let, const, var, function, class) are what the
// template and fn: see, with no exports to write. Inside a jx:component
// template, it runs once for each element, and the component's props are
// variables in it too. At the top of a file, it runs once and is shared.

// Inside a component's script, `el` is the element, `props` its props, and
// `refs` the elements marked jx:ref="name" (filled after each draw). Functions
// named connected, disconnected and rendered run at those moments.

// The names a script declares at its top level, and how: "let", "const"...
export function topLevelNames(code) {
  var names = [], depth = 0, i = 0, n = code.length;
  var word = /[A-Za-z_$][\w$]*/y;
  function skipString(quote) {
    i++;
    while (i < n && code[i] !== quote) {
      if (code[i] === "\\") i++;
      else if (quote === "`" && code[i] === "$" && code[i + 1] === "{") { i += 2; skipTo("}"); continue; }
      i++;
    }
    i++;
  }
  function skipTo(close) { // from inside ${ or a bracket, to its end
    var d = 1;
    while (i < n && d > 0) {
      var c = code[i];
      if (c === '"' || c === "'" || c === "`") { skipString(c); continue; }
      if (c === "/" && code[i + 1] === "/") { while (i < n && code[i] !== "\n") i++; continue; }
      if (c === "/" && code[i + 1] === "*") { i = code.indexOf("*/", i + 2); i = i < 0 ? n : i + 2; continue; }
      if (c === "{" || c === "(" || c === "[") d++;
      if (c === "}" || c === ")" || c === "]") d--;
      i++;
    }
  }
  function readWord() { word.lastIndex = i; var m = word.exec(code); if (m) i = word.lastIndex; return m ? m[0] : null; }
  function spaces() { while (i < n && /\s/.test(code[i])) i++; }
  // After a let/const/var: its names, skipping each initializer.
  function declarators(kind) {
    for (;;) {
      spaces();
      var name = readWord();
      if (!name) return;
      names.push({ name: name, kind: kind });
      spaces();
      if (code[i] === "=") {
        i++;
        while (i < n) {
          var c = code[i];
          if (c === '"' || c === "'" || c === "`") { skipString(c); continue; }
          if (c === "{" || c === "(" || c === "[") { i++; skipTo(); continue; }
          if (c === "," || c === ";") break;
          if (c === "\n") {
            var before = code.slice(0, i).replace(/\s+$/, "");
            if (!/[=+\-*/%&|^!<>?:,.(]$/.test(before) && !/^\s*[.?:+\-*/%&|^)]/.test(code.slice(i + 1))) break;
          }
          i++;
        }
      }
      spaces();
      if (code[i] === ",") { i++; continue; }
      return;
    }
  }
  var atStart = true;
  while (i < n) {
    var c = code[i];
    if (c === '"' || c === "'" || c === "`") { skipString(c); atStart = false; continue; }
    if (c === "/" && code[i + 1] === "/") { while (i < n && code[i] !== "\n") i++; continue; }
    if (c === "/" && code[i + 1] === "*") { i = code.indexOf("*/", i + 2); i = i < 0 ? n : i + 2; continue; }
    if (c === "{" || c === "(" || c === "[") { i++; skipTo(); atStart = false; continue; }
    if (/[A-Za-z_$]/.test(c) && atStart) {
      var w = readWord();
      if (w === "let" || w === "const" || w === "var") { declarators(w); continue; }
      if (w === "async") { spaces(); w = readWord(); }
      if (w === "function" || w === "class") {
        spaces();
        if (code[i] === "*") { i++; spaces(); }
        var name = readWord();
        if (name) names.push({ name: name, kind: w });
        continue;
      }
      atStart = false;
      continue;
    }
    if (/[A-Za-z0-9_$.]/.test(c)) { atStart = false; i++; continue; }
    if (c === ";" || c === "}" || c === "\n") atStart = true;
    i++;
  }
  return names;
}

// Turns a plain script into a function that runs it and returns its
// top-level names, live: reading `count` reads the variable, and functions
// that change it change what's read. `props` (an object with a getter for
// each prop name) makes props usable as variables.
export function compileScript(code, propNames, source) {
  var names = topLevelNames(code).filter(function (n) { return propNames.indexOf(n.name) === -1; });
  var accessors = names.map(function (n) {
    var get = "get " + n.name + "() { return " + n.name + "; }";
    return n.kind === "let" || n.kind === "var" ? get + ", set " + n.name + "(v) { " + n.name + " = v; }" : get;
  }).join(",\n");
  var body = "with (__props) {\n" + code + "\n;return {\n" + accessors + "\n};\n}" + (source ? "\n//# sourceURL=" + source : "");
  var run = new Function("__props", "el", "props", "refs", body);
  return function (el, propValue, refs) {
    var props = Object.create(null);
    propNames.forEach(function (name) {
      Object.defineProperty(props, name, { get: function () { return propValue(name); }, enumerable: true });
    });
    return run(props, el, props, refs || {});
  };
}
