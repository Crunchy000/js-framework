/*
 * components.js — two small hand-written web components that show how jsonx
 * and web components fit together. (The third, <user-card>, is written as a
 * jsonx template instead: see user-card.jx.)
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

