/*
 * components.js — web components written as jsonx templates.
 *
 *   <template jx-component="user-card" props="name role avatar">
 *     <style>:host { display: block; }</style>
 *     <strong>{{name}}</strong> {{role}}
 *     <button jx-emit="pick">Choose</button>
 *   </template>
 *
 * defines <user-card> as a LitElement:
 *   - each prop is a reactive property, and an attribute too (favoritesCount is
 *     the attribute favorites-count). Set it either way: <user-card name="Ada">,
 *     or el.name = "Ada", or name="{{name}}" in a jsonx template, which sets the
 *     property, so objects and lists can be passed in.
 *   - the template draws the props, in shadow DOM, so its <style> stays inside
 *     and <slot> works.
 *   - jx-emit="pick" fires a "pick" event from the component when clicked, with
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

// An attribute is text, except that a bare attribute (<user-card selected>) is true.
var converter = {
  fromAttribute: function (value) { return value === "" ? true : value; },
  toAttribute: function (value) { return value; }
};

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

// `tools` is { compileView, process, bindProps, scopeValue } from jsonx.
export function defineComponent(template, tools) {
  var tag = template.getAttribute("jx-component");
  if (customElements.get(tag)) return;
  if (tag.indexOf("-") === -1) throw new Error('[jsonx] jx-component="' + tag + '" needs a dash in its name, like "user-card"');

  var props = (template.getAttribute("props") || "").split(/[\s,]+/).filter(Boolean);
  var root = template.getRootNode();
  var view = tools.compileView(template, function (selector) {
    return root.querySelector(selector) || document.querySelector(selector);
  });

  var properties = {};
  props.forEach(function (prop) {
    properties[prop] = { attribute: attributeName(prop), converter: converter };
  });

  class JsonxComponent extends LitElement {
    static get properties() { return properties; }

    // A component from a .jx file with a module carries that file's scope,
    // so fn: and jx-data inside it find the module's exports.
    constructor() {
      super();
      if (template.__jxScope) this.__jxScope = template.__jxScope;
    }

    // A prop that isn't set (by attribute, property or the parent template)
    // comes from the component's module scope, if its .jx file exports one by
    // that name. So <cart-badge> with props="count" shows the module's count,
    // and redraws when it changes. Setting it from outside still wins.
    connectedCallback() {
      super.connectedCallback();
      tools.bindProps(this, props);
    }

    render() {
      var data = {};
      for (var i = 0; i < props.length; i++) {
        var value = this[props[i]];
        data[props[i]] = value === undefined ? tools.scopeValue(this, props[i]) : value;
      }
      return view(data);
    }

    // Wire up jx- attributes inside (jsonx also watches for later additions).
    firstUpdated() {
      tools.process(this.renderRoot);
    }

    updated() {
      introduce(this.renderRoot);
    }
  }

  customElements.define(tag, JsonxComponent);
}
