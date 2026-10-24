# jsonx

A tiny htmx-style framework for JSON APIs. Your server sends JSON shaped for the page, a plain HTML template draws it in the browser, and only what changed is updated. It works with web components, and there's no build step.

```html
<wa-card jx-get="api/todos">
  <template>
    <ul>
      <li jx-each="todos" class:done="{{done}}">
        <wa-checkbox checked="{{done}}" jx-post="api/todos/{{id}}/toggle">{{title}}</wa-checkbox>
      </li>
    </ul>
    <p jx-if="!todos">Nothing to do.</p>
  </template>
</wa-card>
```

The card loads `api/todos` when the page opens and draws it with the template inside it. Ticking a checkbox posts to the server, and the server answers with the whole view again. jsonx then updates only what changed: one checkbox and one class, not the whole list.

**Live demos:** https://crunchy000.github.io/js-framework/

- [Todo app](https://crunchy000.github.io/js-framework/examples/todo/), built with [Web Awesome](https://webawesome.com) components
- [Feature tour](https://crunchy000.github.io/js-framework/examples/basic/), every attribute plus three web component patterns
- [Conduit](https://crunchy000.github.io/js-framework/examples/conduit/), the [RealWorld](https://github.com/realworld-apps/realworld) Medium clone: feeds, articles, comments, profiles and sign-in, against an API that isn't shaped for the page
- [Conduit on GraphQL](https://crunchy000.github.io/js-framework/examples/conduit-graphql/), the same app with no view API: each page sends its own GraphQL query
- [Beacon](https://crunchy000.github.io/js-framework/examples/marketing/), a marketing site whose pages are built from a Contentful-style CMS
- [Benchmark](https://crunchy000.github.io/js-framework/examples/benchmark/), drawing and updating 10, 100 and 1,000 todos

## The idea: regions

jsonx assumes your API is shaped for the page. Instead of small resources that the browser has to stitch together, each endpoint answers with the **whole view, ready to draw**, like a server-side partial render but in JSON.

An element with a template is a **region**. The template can sit inside it, as above, or elsewhere on the page with `jx-template="#id"`. Three rules do the rest:

1. **A region loads itself.** A `<wa-card>` can't be clicked, so its default trigger is `load`.
2. **Results re-render the region.** A button inside a region doesn't need `jx-target` or `jx-template`. Whatever it calls, the response is drawn with the region's template.
3. **A region is a form without the `<form>`.** Every request from inside it sends the region's named controls, so a hidden `<input name="filter">` tells the server the current filter on every click.

Errors are part of the view too: if the title is empty, the todo server sends the same view with an `error` field, and the template shows it with `jx-if="error"`. Keep half-typed text in the view as well (the todo API echoes the title back as `draft`), so the server's view is always the truth.

## GraphQL

GraphQL is the other way to get page-shaped data without a view API: the page asks for exactly what it shows. [Conduit on GraphQL](examples/conduit-graphql/) works this way.

```html
<script type="text/graphql" id="query">
  query Article($slug: String!) { ...View }
</script>
<script type="text/graphql" id="view">
  fragment View on Query {
    viewer { username }
    article(slug: $slug) { title favoritesCount viewerHasFavorited createdAt(format: LONG) }
  }
</script>
<script type="text/graphql" id="favorite">
  mutation Favorite($slug: String!) { favoriteArticle(slug: $slug) { query { ...View } } }
</script>

<div jx-query="#query, #view" jx-vals='{"slug": ":slug"}'>
  <template>
    <input type="hidden" name="slug" value="{{article.slug}}">
    <h1>{{article.title}}</h1>
    <wa-button jx-query="#favorite, #view" jx-select="favoriteArticle.query">Favorite ({{article.favoritesCount}})</wa-button>
  </template>
</div>
```

- **The region's controls are the variables.** Form values are text, so jsonx reads the query's `$offset: Int` declarations and converts `"10"` to `10` and `"true"` to `true`.
- **A mutation can ask for the view again.** If every mutation's answer includes `query` (the whole Query type), a button can re-select the page's fragment in the same round trip, and `jx-select` draws just that part. Each action is one request, and the region redraws like it does with a view API.
- **GraphQL errors** (`{ errors: [...] }`, sent with status 200) are shown like any other error.
- **The schema still matters.** Fields clients usually want, like `viewerHasFavorited`, `createdAt(format: LONG)` and page buttons on lists, keep templates logic-free. Lists also echo their arguments (`scope`, `offset`), so a tab or hidden input can show what the server used.

## Templates

A template is plain HTML inside a `<template>` tag, plus four rules:

| You write | What it does |
|---|---|
| `{{title}}` | Prints a value, between tags or inside an attribute value. Always HTML-escaped, so user text is safe. Dotted names work: `{{stats.done}}`. |
| `jx-each="todos"` | Repeats this element for each item in the list. Inside it, names refer to the item first, then the outer view. Items with an `id` are tracked by it, so adding or removing one only adds or removes that row. |
| `jx-if="error"`, `jx-if="!todos"` | Shows this element only if the value is there (or, with `!`, only if it's missing, false, or an empty list). |
| `checked="{{done}}"`, `value="{{draft}}"` | When an attribute's whole value is one `{{name}}`, it's smart: if the element has a property with that name, the live property is set, so form controls always show the view. Otherwise `true`/`false` adds or removes the attribute, and anything else becomes its text. |
| `class:done="{{done}}"` | Turns the class `done` on or off. |

Reuse a template inside another with `<template jx-use="#todo-item"></template>`. A `{{name}}` inside a `<textarea>` becomes its value.

That's the whole language. There's no other logic on purpose: if the page needs to know something, like which filter button is highlighted, the server works it out and sends it.

**How it's fast.** jsonx reads each template once and turns it into a [Lit](https://lit.dev) template, with a "hole" wherever a value goes. On every update Lit only touches the holes whose values changed: no HTML parsing, no comparing trees, and unchanged elements (including web components, focus and scroll position) are left completely alone. See [the benchmark](examples/benchmark/).


### A template that loads itself

Put the request on the `<template>` itself, and it loads and draws right where it is, with no wrapper element to write:

```html
<template jx-get="/api/stats">
  <p>{{done}} of {{total}} done</p>
</template>
```

(jsonx swaps the template for a `<jx-view>` element with the same attributes. It takes no space in the layout.)

### Reusable HTML in .jx files

`<template src="nav.jx"></template>` pulls in a file of plain HTML. Use it for anything shared between pages, like a navigation bar or a list partial. The file can hold anything a page can: templates that load themselves, partials for `jx-use`, and GraphQL queries.

```html
<!-- nav.jx -->
<header class="site-nav">
  <template jx-get="/view/nav">
    <a href="index.html">Home</a>
    <a jx-if="signedIn" href="settings.html">Settings</a>
  </template>
</header>
```

Each file is fetched once. Nothing on the page is wired until every file is in, so a page's templates can use partials from them straight away. `<template src="row.jx" jx-get="/api/rows">` uses the file as that template's content instead. Conduit and Conduit on GraphQL share their nav bar and article list this way.

## Benchmark

[The benchmark](examples/benchmark/) draws a list of Web Awesome todos, then ticks one, and times each until the browser has drawn the next frame. It compares jsonx with the simple approach of rebuilding the list's HTML with `innerHTML`. One run in headless Chrome:

| Todos | First draw, jsonx | First draw, innerHTML | Tick one, jsonx | Tick one, innerHTML |
|---|---|---|---|---|
| 10 | 19 ms | 19 ms | 14 ms | 17 ms |
| 100 | 50 ms | 97 ms | 3 ms | 118 ms |
| 1,000 | 645 ms | 497 ms | 15 ms | 460 ms |

The first draw costs about the same either way, because creating the components is most of the work. Updates are where jsonx wins: ticking one todo in a list of 1,000 changes one checkbox instead of rebuilding 2,000 components. Run it in your own browser for your own numbers.

## Try it locally

Serve the folder with any static server, for example `npx serve .`, and open `examples/todo/`. There's no build step: each example's `mock-api.js` pretends to be a JSON server by intercepting `fetch` calls to `.../api/...`. (A static server is needed because jsonx is a JavaScript module.)

```html
<script type="module" src="jsonx.js"></script>
```

## Files

| File | What it is |
|---|---|
| `jsonx.js` | The framework: wiring, triggers, values and requests (heavily commented). Read this first. |
| `templates.js` | The template language, compiled to Lit. |
| `vendor/lit-html/` | lit-html 3.3.1 and its `repeat` directive (BSD-3-Clause, see `vendor/lit-html/LICENSE.txt`). |
| `examples/todo/` | The Web Awesome todo app, with its mock API. |
| `examples/basic/` | The feature tour, with three demo web components in `components.js`. |
| `examples/conduit/` | The RealWorld app: one HTML file per page and no page script. `view-api.js` is a pretend backend-for-frontend that turns the RealWorld API (`mock-api.js`) into page-shaped views. |
| `examples/conduit-graphql/` | Conduit again, talking GraphQL. Queries live in the pages; `graphql-server.js` is a pretend GraphQL server (the real graphql-js, in `vendor/`) over the RealWorld mock. |
| `examples/marketing/` | A marketing site in one HTML file. `cms-api.js` is a pretend Contentful (entries, links, rich text) and `view-api.js` turns its entries into page sections. |
| `examples/benchmark/` | Times jsonx against rebuilding the list with `innerHTML`. |
| `index.html` | The GitHub Pages home page. |
| `.github/workflows/pages.yml` | Publishes the site to GitHub Pages on every push to `main`. |

## Attributes

| Attribute | What it does | Default |
|---|---|---|
| `jx-get`, `jx-post`, `jx-put`, `jx-patch`, `jx-delete` | The URL to call, and with which HTTP method. It can use `{{name}}` when it's inside a template. | (required) |
| `jx-trigger` | The event that starts the request. Any event name works, including custom events. Add `delay:300ms` to wait until events stop (good for search boxes), or `from:#other` to listen on another element. Use `keydown[key=Enter]` to fire only for one key. Use `load` to run once on page load. List several with commas. | depends on the element, see below |
| `jx-template` | Selector of a `<template>` that draws the JSON, for when it isn't inside the element. An element with a template is a region. | the template inside, or the region's |
| `jx-target` | Where the result goes: a CSS selector, `this`, or `closest <selector>`. | the region, or else the element itself |
| `jx-swap` | `prop:<name>` sets a property on the target instead of drawing a template (good for components that take data). `none` calls the API and draws nothing. | draw the template |
| `jx-include` | Also send the values of other elements, e.g. `jx-include="#filter"`. | none |
| `jx-vals` | Extra JSON to send, e.g. `jx-vals='{"filter": "{{name}}"}'`. | none |
| `jx-query` | Makes it a GraphQL request: the query comes from these `<script type="text/graphql">` elements (several, for fragments), and the values become its variables. Sent to `jsonx.graphql`, `/graphql` by default. | |
| `jx-operation` | Which operation to run, when the script holds several. | |
| `jx-select` | Draw only part of the answer, e.g. `jx-select="favoriteArticle.query"`. | the whole answer |
| `jx-then` | After the request works, go to this page. `:name` is filled from the server's answer, e.g. `jx-then="article.html?slug=:article.slug"`. | stay |
| `jx-refresh` | After the request works, reload these regions the way they were last loaded, e.g. `jx-refresh="#comments"` or `jx-refresh="closest [jx-template]"`. For APIs that answer with one thing instead of the whole view. | none |
| `jx-region` | Makes an element a region with no URL: it draws its template once, with an empty view. Good for a sign-in form. | |

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

**Values from the page address.** On `article.html?slug=hello`, `jx-get="/view/article/:slug"` calls `/view/article/hello`. A `:name` the address doesn't have becomes empty.

**Dotted names build nested JSON.** `name="user.email"` and `name="user.password"` send `{"user": {"email": …, "password": …}}`, which is what APIs like RealWorld expect.

## Errors

When a request fails and the server sends JSON, jsonx redraws the region with its last view plus three fields, so the template can show what went wrong:

| Field | What it holds |
|---|---|
| `error` | One message for the whole thing: the server's `error` or `message`, or the field errors joined up. |
| `errors` | A list for `jx-each`. `{"errors": {"email": ["can't be blank"]}}` becomes `[{field: "email", message: "can't be blank", text: "email can't be blank"}]`. |
| `fieldErrors` | The same by field, e.g. `{{fieldErrors.email}}`, to show a message next to its input. |

The next successful answer replaces the view, so the errors go away by themselves. What you typed stays, because the inputs aren't bound to the view. jsonx also fires `jx:error`, for page code.

## APIs that aren't shaped for the page

The todo app's API sends the whole view on every answer. Most real APIs don't: they're about things (articles, comments), and favouriting an article answers with just that article.

The jsonx answer is a small **view API** in front of it, often called a backend-for-frontend. It runs on your server, calls the real API, and answers with page-shaped views: dates written out, "is this mine?" decided, buttons labelled, page buttons counted. Every action answers with the whole view again. [Conduit](examples/conduit/), the RealWorld app, works this way, and its pages have no script at all:

```
browser (jsonx)  --GET /view/home?tab=feed-->  view API  --GET /api/articles/feed-->  RealWorld API
```

The view API also keeps the sign-in token, the way a real one keeps it in a server-side session behind a cookie, so the browser never handles it. In the demo it's `view-api.js`, running in the browser like the other mocks.

If you can't add a view API, jsonx has three tools for working with the real one from the page:

- **`jx-refresh="#comments"`** reloads regions after a change, the way they were last loaded.
- **`jx:beforeRender`** lets page code reshape the data: set `event.detail.data`.
- **`jsonx.headers`** adds headers, like a token, to every request. It can be an object, or a function that's asked each time. Page code that runs before jsonx can set `window.jsonx = { headers: … }` first.

[Beacon](examples/marketing/), the marketing site, does the same with a Contentful-style CMS. Editors stack section entries (hero, features, pricing, FAQ...) into pages. The view API resolves the links between entries and turns rich text into blocks, and answers with a list of sections, each naming its kind: `{ hero: {...}, pricing: null, ... }`. The page is one HTML file with a template per kind of section, `<section jx-each="hero">`. A `jx-each` on a single object draws it once, with its fields in scope.

Article bodies are Markdown, but Conduit shows them as plain paragraphs: templates never insert raw HTML, so an article can't inject anything into the page.

## Events

jsonx fires DOM events you can listen to from page code. They bubble and cross shadow DOM boundaries.

| Event | When | `event.detail` |
|---|---|---|
| `jx:beforeRequest` | Just before `fetch`. Call `event.preventDefault()` to cancel. | `{ url, options }` |
| `jx:beforeRender` | Just before drawing. Set `event.detail.data` to change what's drawn. | `{ data, url, target, source }` |
| `jx:afterRender` | After the page is updated. If the swap removed the element that made the request, this fires on the target's parent instead. | `{ data, target, source }` |
| `jx:error` | The request failed or returned an error status. If the server's JSON has an `error` field, that's the message. | `{ error }` (with `error.status` and `error.data`) |

## Web components

There are three ways jsonx and web components work together. The feature tour has one of each, and the todo app uses Web Awesome's `<wa-input>`, `<wa-checkbox>` and `<wa-button>` the same way you'd use native controls.

1. **Components that fire events.** `jx-trigger` accepts any event name, so `<star-rating jx-post="/api/feedback" jx-trigger="rating-changed">` works. jsonx reads the component's `name` attribute and `value` property, like an `<input>`. Components inside a form that are [form-associated](https://developer.mozilla.org/en-US/docs/Web/API/ElementInternals) are picked up by the form automatically.
2. **Components that take JSON as a property.** `jx-swap="prop:stats"` skips templates and does `target.stats = data`. The component decides how to draw itself. This is often the cleanest fit, because components usually want data, not HTML.
3. **Components that use jsonx inside their shadow DOM.** Call `jsonx.process(this.shadowRoot)` once in `connectedCallback`. After that, `jx-target` and `jx-template` look inside the component's shadow root first (then fall back to the page), so a component can ship its own private templates. jsonx also watches that shadow root for new elements.

## Web components

There are three ways jsonx and web components work together. The feature tour has one of each, and the todo app uses Web Awesome's `<wa-input>`, `<wa-checkbox>` and `<wa-button>` the same way you'd use native controls.

1. **Components that fire events.** `jx-trigger` accepts any event name, so `<star-rating jx-post="/api/feedback" jx-trigger="rating-changed">` works. jsonx reads the component's `name` attribute and `value` property, like an `<input>`.
2. **Components that take JSON as a property.** `jx-swap="prop:stats"` skips templates and does `target.stats = data`. The component decides how to draw itself. Inside a template, `stats="{{stats}}"` does the same, because the component has a `stats` property.
3. **Components that use jsonx inside their shadow DOM.** Call `jsonx.process(this.shadowRoot)` once in `connectedCallback`. After that, `jx-target` and `jx-template` look inside the component's shadow root first (then fall back to the page), so a component can ship its own private templates.

## How it works

1. **Find and wire.** On page load, find every element with a `jx-<method>` attribute and add an event listener for its trigger. A `MutationObserver` does the same for elements added later. For a web component whose code hasn't loaded yet, jsonx waits for `customElements.whenDefined()` first, so it can tell whether the component is a button or a form control.
2. **Request.** When the event fires, collect the values, build the `fetch` call, and send it.
3. **Render.** The first time a template is used, `templates.js` compiles it into a Lit template (and caches it). Lit then draws the JSON into the target, or updates what's already there.
4. **Wire again.** Run step 1 on the new content, so `jx-` attributes inside the template work too. That's how each todo's checkbox and Delete button work.

## Design choices, and why

- **JSON instead of HTML from the server.** htmx expects the server to return HTML. jsonx moves rendering into the browser, so the same API can also serve a mobile app or other clients. The trade-off is that templates now live in the page.
- **Our own tiny template language.** Lit is fast but has rules about where values can go. Writing templates as real HTML and compiling them means those rules never show up: every `{{name}}` lands somewhere valid, and there's less to learn than EJS or Mustache.
- **Templates in `<template>` tags.** The browser parses them as real HTML without showing or running them, which is exactly what the compiler needs.
- **No build step, one dependency (lit-html).** Easy to read, easy to change.

## Ideas for what to build next

- `jx-indicator="#spinner"` to show a separate loading element.
- `jx-confirm="Are you sure?"` before a delete.
- `jx-push-url` to update the address bar, so the back button works.
- Polling: `jx-trigger="every 5s"`.
- Publishing to npm.

## Publishing

Every push to `main` publishes the site to GitHub Pages using `.github/workflows/pages.yml`. There's no build step: the workflow just copies `index.html`, `jsonx.js`, `templates.js`, `vendor/` and `examples/`.
