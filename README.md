# jsonx

A tiny htmx-style framework for JSON APIs. You add attributes to your HTML; jsonx calls your API, renders the JSON with an EJS template in the browser, and puts the result on the page. It also works with web components.

```html
<button jx-get="/api/todos" jx-template="#todo-list" jx-target="#todos">Load todos</button>
<ul id="todos"></ul>

<script type="text/ejs" id="todo-list">
  <% data.forEach(function (todo) { %>
    <li><%= todo.title %></li>
  <% }) %>
</script>
```

**Live demos:** https://crunchy000.github.io/js-framework/

- [Todo app](https://crunchy000.github.io/js-framework/examples/todo/), built with [Web Awesome](https://webawesome.com) components
- [Feature tour](https://crunchy000.github.io/js-framework/examples/basic/), every attribute plus three web component patterns

## Try it locally

Open `examples/basic/index.html` in a browser. There's no build step and no server: each example's `mock-api.js` pretends to be a JSON server by intercepting `fetch` calls to `.../api/...`. (The todo app loads Web Awesome as JavaScript modules, so serve the folder with any static server, for example `npx serve .`.)

## Files

| File | What it is |
|---|---|
| `jsonx.js` | The framework (about 330 lines, heavily commented). Read this first. |
| `vendor/ejs.min.js` | EJS 3.1.10's browser build (Apache-2.0, see `vendor/ejs-LICENSE.txt`). |
| `examples/todo/` | The Web Awesome todo app, with its own mock API. |
| `examples/basic/` | The feature tour, with three demo web components in `components.js`. |
| `index.html` | The GitHub Pages home page. |
| `tests/` | A browser test that clicks through both examples. |
| `.github/workflows/pages.yml` | Runs the tests, then publishes the site to GitHub Pages on every push to `main`. |

## Attributes

| Attribute | What it does | Default |
|---|---|---|
| `jx-get`, `jx-post`, `jx-put`, `jx-patch`, `jx-delete` | The URL to call, and with which HTTP method. | (required) |
| `jx-trigger` | The event that starts the request. Any event name works, including custom events. Add `delay:300ms` to wait until events stop (good for search boxes), or `from:#other` to listen on another element. Use `load` to run once on page load. List several with commas: `load, change`. | `submit` for forms, `change` for inputs, `click` for everything else |
| `jx-template` | Selector of a `<script type="text/ejs">` that turns the JSON into HTML. The JSON is available as `data`. | none (nothing is rendered) |
| `jx-target` | Where the result goes: a CSS selector, `this`, or `closest <selector>`. | the element itself |
| `jx-swap` | How the result goes in: `innerHTML`, `outerHTML`, `beforeend`, `afterbegin`, `beforebegin`, `afterend`, `delete` (remove the target), `none`, or `prop:<name>` (set a property on the target). | `innerHTML` |
| `jx-vals` | Extra JSON to send, e.g. `jx-vals='{"toggle": true}'`. | none |

**What gets sent:** the fields of the closest `<form>`, or the element's own `name` and `value`, plus `jx-vals`. GET and DELETE send them as a query string; POST, PUT and PATCH send a JSON body.

**Templates can include each other:** `<%- include("#todo-item", { data: todo }) %>`.

**While a request runs**, the element has the class `jx-loading`, so you can style it.

## Events

jsonx fires DOM events you can listen to from page code. They bubble and cross shadow DOM boundaries.

| Event | When | `event.detail` |
|---|---|---|
| `jx:beforeRequest` | Just before `fetch`. Call `event.preventDefault()` to cancel. | `{ url, options }` |
| `jx:afterRender` | After the page is updated. If the swap removed the element that made the request, this fires on the target's parent instead. | `{ data, target, source }` |
| `jx:error` | The request failed or returned an error status. If the server's JSON has an `error` field, that's the message. | `{ error }` (with `error.status` and `error.data`) |

## Web components

There are three ways jsonx and web components work together. The feature tour has one of each, and the todo app uses Web Awesome's form controls (`<wa-input>`, `<wa-checkbox>`, `<wa-radio-group>`) the same way you'd use native ones.

One tip: jsonx only knows the default event for native elements, so give a component an explicit trigger, like `jx-trigger="change"` on a `<wa-checkbox>`.

1. **Components that fire events.** `jx-trigger` accepts any event name, so `<star-rating jx-post="/api/feedback" jx-trigger="rating-changed">` works. jsonx reads the component's `name` attribute and `value` property, like an `<input>`. Components inside a form that are [form-associated](https://developer.mozilla.org/en-US/docs/Web/API/ElementInternals) are picked up by the form automatically.
2. **Components that take JSON as a property.** `jx-swap="prop:stats"` skips templates and does `target.stats = data`. The component decides how to draw itself. This is often the cleanest fit, because components usually want data, not HTML.
3. **Components that use jsonx inside their shadow DOM.** Call `jsonx.process(this.shadowRoot)` once in `connectedCallback`. After that, `jx-target` and `jx-template` look inside the component's shadow root first (then fall back to the page), so a component can ship its own private templates. jsonx also watches that shadow root for new elements.

## How it works

The whole framework is four steps, and `jsonx.js` is laid out in the same order:

1. **Find and wire.** On page load, find every element with a `jx-<method>` attribute and add an event listener for its trigger. A `MutationObserver` does the same for elements added later. A `WeakSet` remembers which elements are already wired so nothing is wired twice.
2. **Request.** When the event fires, collect the values, build the `fetch` call, and send it.
3. **Render.** Pass the JSON to the EJS template as `data`. Compiled templates are cached, so each one is compiled only once.
4. **Swap.** Put the HTML into the target using the swap style, then run step 1 on the new HTML so any `jx-` attributes inside it work too. This is how the checkbox and Delete button on each todo work, even though they arrive from a template.

## Design choices, and why

- **JSON instead of HTML from the server.** htmx expects the server to return HTML. jsonx moves rendering into the browser, so the same API can also serve a mobile app or other clients. The trade-off is that templates now live in the page.
- **EJS for templates.** It's plain JavaScript inside `<% %>` tags, so there's no new template language to learn. `<%= %>` escapes HTML (safe for user text); `<%- %>` doesn't (only use it for trusted HTML, like `include`).
- **Templates in `<script type="text/ejs">`, not `<template>`.** The browser rewrites the inside of a `<template>` tag (turning `<%` into `&lt;%`), which breaks EJS. A script with an unknown type is left exactly as written and never runs.
- **No build step, no dependencies besides EJS.** Easy to read, easy to change.

## Ideas for what to build next

- `jx-indicator="#spinner"` to show a separate loading element.
- Load templates from files: `jx-template="/templates/todo.ejs"` fetched and cached.
- `jx-confirm="Are you sure?"` before a delete.
- `jx-push-url` to update the address bar, so the back button works.
- Polling: `jx-trigger="every 5s"`.
- Unit tests for each attribute, and publishing to npm.

## Running the tests

```sh
npm install
npx playwright install chromium
npm test
```

## Publishing

Every push to `main` runs the tests and, if they pass, publishes the site to GitHub Pages using `.github/workflows/pages.yml`. There's no build step: the workflow just copies `index.html`, `jsonx.js`, `vendor/` and `examples/`.
