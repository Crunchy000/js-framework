/*
 * components.js — three small web components that show how jsonx and
 * web components fit together. Each one shows a different pattern.
 * Loaded as a module after jsonx.js, so `jsonx` exists when they start.
 */

// Pattern 1: a component that FIRES a custom event and has a `value`.
// jsonx can listen for that event (jx-trigger="rating-changed") and send
// the value, just like it would for an <input>.
class StarRating extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.value = Number(this.getAttribute("value") || 0);
  }

  connectedCallback() {
    this.draw();
    this.shadowRoot.addEventListener("click", (event) => {
      const star = event.target.closest("button");
      if (!star) return;
      this.value = Number(star.dataset.value);
      this.draw();
      // bubbles + composed lets the event leave the shadow root.
      this.dispatchEvent(new CustomEvent("rating-changed", {
        bubbles: true, composed: true, detail: { value: this.value }
      }));
    });
  }

  draw() {
    let stars = "";
    for (let i = 1; i <= 5; i++) {
      stars += `<button data-value="${i}" aria-label="${i} stars">${i <= this.value ? "★" : "☆"}</button>`;
    }
    this.shadowRoot.innerHTML = `
      <style>
        button { background: none; border: 0; font-size: 1.6rem; cursor: pointer; color: #e0a800; padding: 0 2px; }
      </style>
      ${stars}`;
  }
}
customElements.define("star-rating", StarRating);


// Pattern 2: a component that RECEIVES JSON as a property.
// jx-swap="prop:stats" sets element.stats = data, and the component draws itself.
// No template needed: the component owns its own rendering.
class TodoStats extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.stats = { total: 0, done: 0, open: 0 };
  }

  set stats(value) {
    this._stats = value;
    const { total, done, open } = value;
    const percent = total ? Math.round((done / total) * 100) : 0;
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; }
        .bar { height: 8px; background: #e5e7eb; border-radius: 4px; overflow: hidden; margin-top: 6px; }
        .fill { height: 100%; background: #16a34a; width: ${percent}%; transition: width .3s; }
      </style>
      <div><strong>${done}</strong> of ${total} done, ${open} still open (${percent}%)</div>
      <div class="bar"><div class="fill"></div></div>`;
  }

  get stats() { return this._stats; }
}
customElements.define("todo-stats", TodoStats);


// Pattern 3: a component that USES jsonx INSIDE its shadow DOM.
// Its template and its target live inside the shadow root, so they can't
// clash with anything on the page. One line wires it up: jsonx.process(this.shadowRoot).
class UserCard extends HTMLElement {
  connectedCallback() {
    const id = this.getAttribute("user-id");
    this.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; border: 1px solid #d1d5db; border-radius: 8px; padding: 12px; }
        h3 { margin: 0 0 4px; }
        button { margin-top: 8px; }
        .jx-loading { opacity: .5; }
      </style>

      <template id="card">
        <h3>\${name}</h3>
        <div>\${role}</div>
      </template>

      <div id="body">User #${id}</div>
      <button jx-get="/api/users/${id}" jx-target="#body" jx-template="#card">Load user</button>`;

    jsonx.process(this.shadowRoot);
  }
}
customElements.define("user-card", UserCard);
