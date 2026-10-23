# jsonx

A tiny htmx-style framework for JSON APIs. You add attributes to your HTML; jsonx calls your API, renders the JSON with a template in the browser (EJS, Mustache or your own engine), and puts the result on the page. It also works with web components.

```html
<button jx-get="/api/todos" jx-template="#todo-list" jx-target="#todos">Load todos</button>
<ul id="todos"></ul>

<script type="text/ejs" id="todo-list">
  <% data.forEach(function (todo) { %>
    <li><%= todo.title %></li>
  <% }) %>
</script>
```

## The opinionated way: regions

jsonx assumes your API is shaped for the page. Instead of small resources that the browser has to stitch together, each endpoint answers with the **whole view, ready to draw**, like a server-side partial render but in JSON. Then the page needs almost no wiring:

```html
<wa-card jx-get="api/todos" jx-template="#todo-app"></wa-card>

<script type="text/ejs" id="todo-app">
  <input type="hidden" name="filter" value="<%= data.filter %>">
  <wa-input name="title"></wa-input>
  <wa-button jx-post="api/todos">Add</wa-button>

  <% data.todos.forEach(function (todo) { %>
    <wa-checkbox <%= todo.done ? 'checked' : '' %> jx-post="api/todos/<%= todo.id %>/toggle"><%= todo.title %></wa-checkbox>
  <% }) %>
</script>
```

An element with a `jx-template` is a **region**, and three rules do the rest:

1. **A region loads itself.** A `<wa-card>` can't be clicked, so its default trigger is `load`.
2. **Results re-render the region.** A button inside a region doesn't need `jx-target` or `jx-template`. Whatever it calls, the response is drawn with the region's template.
3. **A region is a form without the `<form>`.** Every request from inside it sends the region's named controls. Here that's `title` and the hidden `filter`, so the server always knows the current filter.

Errors are part of the view too: if the title is empty, the server sends the same view with an `error` field, and the template shows it.

The trade-off: re-rendering a region replaces everything in it, including anything half-typed in an input. Keep a region's state in the view, or make regions small.

The [todo app](examples/todo/) works this way. The finer-grained attributes below (`jx-target`, `jx-swap`, `jx-include`) are still there for the cases regions don't fit.

**Live demos:** https://crunchy000.github.io/js-framework/

- [Todo app](https://crunchy000.github.io/js-framework/examples/todo/), built with [Web Awesome](https://webawesome.com) components
- [Todo app with Mustache](https://crunchy000.github.io/js-framework/examples/todo-mustache/): the same app and API, with a logic-less Mustache template
- [Feature tour](https://crunchy000.github.io/js-framework/examples/basic/), every attribute plus three web component patterns

## Try it locally

Open `examples/basic/index.html` in a browser. There's no build step and no server: each example's `mock-api.js` pretends to be a JSON server by intercepting `fetch` calls to `.../api/...`. (The todo app loads Web Awesome as JavaScript modules, so serve the folder with any static server, for example `npx serve .`.)

## Files

| File | What it is |
|---|---|
| `jsonx.js` | The framework (about 440 lines, heavily commented). Read this first. |
| `vendor/ejs.min.js` | EJS 3.1.10's browser build (Apache-2.0, see `vendor/ejs-LICENSE.txt`). |
| `vendor/mustache.min.js` | Mustache.js 4.2.0 (MIT, see `vendor/mustache-LICENSE.txt`). |
| `examples/todo/` | The Web Awesome todo app (EJS), with the mock API both todo demos use. |
| `examples/todo-mustache/` | The same todo app with a Mustache template. |
| `examples/basic/` | The feature tour, with three demo web components in `components.js`. |
| `index.html` | The GitHub Pages home page. |
| `tests/` | A browser test that clicks through every example. |
| `.github/workflows/pages.yml` | Runs the tests, then publishes the site to GitHub Pages on every push to `main`. |

## Attributes

| Attribute | What it does | Default |
|---|---|---|
| `jx-get`, `jx-post`, `jx-put`, `jx-patch`, `jx-delete` | The URL to call, and with which HTTP method. | (required) |
| `jx-trigger` | The event that starts the request. Any event name works, including custom events. Add `delay:300ms` to wait until events stop (good for search boxes), or `from:#other` to listen on another element. Use `keydown[key=Enter]` to fire only for one key. Use `load` to run once on page load. List several with commas. | depends on the element, see below |
| `jx-template` | Selector of a `<script type="text/ejs">` that turns the JSON into HTML. The JSON is available as `data`. An element with a template is a region. | the region's template |
| `jx-target` | Where the result goes: a CSS selector, `this`, or `closest <selector>`. | the region, or else the element itself |
| `jx-swap` | How the result goes in: `innerHTML`, `outerHTML`, `beforeend`, `afterbegin`, `beforebegin`, `afterend`, `delete` (remove the target), `none`, or `prop:<name>` (set a property on the target). | `innerHTML` |
| `jx-include` | Also send the values of other elements, e.g. `jx-include="#filter"`. | none |
| `jx-vals` | Extra JSON to send, e.g. `jx-vals='{"toggle": true}'`. | none |

**Default triggers.** You usually don't need `jx-trigger`, because jsonx picks one from the kind of element:

| Element | Default trigger |
|---|---|
| `<form>` | `submit` |
| `<button>`, `<a>`, and button components like `<wa-button>` | `click` |
| `<input>`, `<select>`, `<textarea>`, and form-control components like `<wa-checkbox>` or `<wa-select>` | `change` |
| Anything else: `<div>`, `<ul>`, `<wa-card>`… | `load` |

In short: things you click get `click`, things you change get `change`, and things you can't interact with fill themselves in when the page loads. (A component counts as a form control if it's [form-associated](https://developer.mozilla.org/en-US/docs/Web/API/ElementInternals), which all Web Awesome form controls are.)

Writing a trigger for the element itself replaces the default. Triggers with `from:` listen to *other* elements, so they're added on top of the default. For example, `<ul jx-get="/api/todos" jx-trigger="change from:#filter">` loads with the page **and** reloads when the filter changes.

**What gets sent:** the named controls in the element's region (or the fields of its `<form>`), then the element's own `name` and `value`, then the values of any `jx-include` elements, then `jx-vals`. Later ones win, so `jx-vals='{"filter": "done"}'` on a button overrides the hidden filter for that one request. GET and DELETE send them as a query string; POST, PUT and PATCH send a JSON body.

## Template engines

The template's `type` picks the engine, so one page can even mix them:

| Type | Engine | Data is | Include another template |
|---|---|---|---|
| `text/ejs` | [EJS](https://ejs.co) (load `vendor/ejs.min.js`) | `data`, e.g. `<%= data.title %>` | `<%- include("#todo-item", { data: todo }) %>` |
| `text/mustache` | [Mustache](https://mustache.github.io) (load `vendor/mustache.min.js`) | the top level, e.g. `{{title}}` | `{{> todo-item}}` |

**Which one?** EJS lets templates run JavaScript, which is handy for small bits of display logic. Mustache has no logic at all, so the API has to send everything ready to show. That fits the regions approach well: compare [the EJS todo](examples/todo/index.html) with [the Mustache todo](examples/todo-mustache/index.html). They share one mock API, which sends ready-made filter buttons so the Mustache template has nothing to work out.

**Add your own** with `jsonx.engine(type, compile)`. `compile(text, lookup)` gets the template's text and returns a function that turns data into HTML. `lookup(selector)` returns another template's text, for includes. For example, [Handlebars](https://handlebarsjs.com):

```js
jsonx.engine("text/handlebars", function (text, lookup) {
  return Handlebars.compile(text);
});
```


**While a request runs**, the element has the class `jx-loading`, so you can style it.

**Focus survives re-renders:** after a render, jsonx focuses the first new element with `autofocus`. That's how the todo input stays ready for the next todo.

## Events

jsonx fires DOM events you can listen to from page code. They bubble and cross shadow DOM boundaries.

| Event | When | `event.detail` |
|---|---|---|
| `jx:beforeRequest` | Just before `fetch`. Call `event.preventDefault()` to cancel. | `{ url, options }` |
| `jx:afterRender` | After the page is updated. If the swap removed the element that made the request, this fires on the target's parent instead. | `{ data, target, source }` |
| `jx:error` | The request failed or returned an error status. If the server's JSON has an `error` field, that's the message. | `{ error }` (with `error.status` and `error.data`) |

## Web components

There are three ways jsonx and web components work together. The feature tour has one of each, and the todo app uses Web Awesome's `<wa-input>`, `<wa-checkbox>` and `<wa-button>` the same way you'd use native controls.

1. **Components that fire events.** `jx-trigger` accepts any event name, so `<star-rating jx-post="/api/feedback" jx-trigger="rating-changed">` works. jsonx reads the component's `name` attribute and `value` property, like an `<input>`. Components inside a form that are [form-associated](https://developer.mozilla.org/en-US/docs/Web/API/ElementInternals) are picked up by the form automatically.
2. **Components that take JSON as a property.** `jx-swap="prop:stats"` skips templates and does `target.stats = data`. The component decides how to draw itself. This is often the cleanest fit, because components usually want data, not HTML.
3. **Components that use jsonx inside their shadow DOM.** Call `jsonx.process(this.shadowRoot)` once in `connectedCallback`. After that, `jx-target` and `jx-template` look inside the component's shadow root first (then fall back to the page), so a component can ship its own private templates. jsonx also watches that shadow root for new elements.

## How it works

The whole framework is four steps, and `jsonx.js` is laid out in the same order:

1. **Find and wire.** On page load, find every element with a `jx-<method>` attribute and add an event listener for its trigger. A `MutationObserver` does the same for elements added later. A `WeakSet` remembers which elements are already wired so nothing is wired twice. For a web component whose code hasn't loaded yet, jsonx waits for `customElements.whenDefined()` first, so it can tell whether the component is a button or a form control.
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
