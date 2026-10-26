# jsonx

A tiny htmx-style framework for JSON APIs. Your server sends JSON shaped for the page, a plain HTML template draws it in the browser, and only what changed is updated. It works with web components, and there's no build step.

```html
<wa-card jx:get="api/todos">
  <template>
    <ul>
      <jx-each items="todos">
        <li class:done="{{done}}">
          <wa-checkbox checked="{{done}}" jx:post="api/todos/{{id}}/toggle">{{title}}</wa-checkbox>
        </li>
      </jx-each>
    </ul>
    <jx-if test="!todos">
      <p>Nothing to do.</p>
    </jx-if>
  </template>
</wa-card>
```

The card loads `api/todos` when the page opens and draws it with the template inside it. Ticking a checkbox posts to the server, and the server answers with the whole view again. jsonx then updates only what changed: one checkbox and one class, not the whole list.

**Live demos:** https://crunchy000.github.io/js-framework/

**New to jsonx?** Start with the [tutorial](https://crunchy000.github.io/js-framework/examples/tutorial/): nine live steps, from one variable and a template to components that share state, with the code beside each result. The [server tutorial](https://crunchy000.github.io/js-framework/examples/server-tutorial/) covers loading views from a server.

- [Todo app](https://crunchy000.github.io/js-framework/examples/todo/), built with [Web Awesome](https://webawesome.com) components
- [Todo app, with functions](https://crunchy000.github.io/js-framework/examples/todo-functions/), the same app with no server: plain functions return the view
- [Calculator](https://crunchy000.github.io/js-framework/examples/calculator/), another app built on plain functions
- [Widgets](https://crunchy000.github.io/js-framework/examples/widgets/), components with their own state, lifecycle hooks and form fields, and no page script
- [Café cart](https://crunchy000.github.io/js-framework/examples/cart/), three components sharing one script, with no page script
- [Chat with Echo](https://crunchy000.github.io/js-framework/examples/chat/), a WebSocket chatbot with no page script
- [Data table](https://crunchy000.github.io/js-framework/examples/data-table/), 10,000 rows with search, sort and infinite scroll
- [People, on GraphQL](https://crunchy000.github.io/js-framework/examples/table-graphql/), search, sorting and paging with no script at all
- [Feature tour](https://crunchy000.github.io/js-framework/examples/basic/), one live example per feature, with its code and data
- [Conduit](https://crunchy000.github.io/js-framework/examples/conduit/), the [RealWorld](https://github.com/realworld-apps/realworld) Medium clone: feeds, articles, comments, profiles and sign-in, against an API that isn't shaped for the page
- [Conduit on GraphQL](https://crunchy000.github.io/js-framework/examples/conduit-graphql/), the same app with no view API: each page sends its own GraphQL query
- [Conduit with functions](https://crunchy000.github.io/js-framework/examples/conduit-functions/), the same app again, with its view API as plain functions in the page
- [Beacon](https://crunchy000.github.io/js-framework/examples/marketing/), a marketing site whose pages are built from a Contentful-style CMS
- [Benchmark](https://crunchy000.github.io/js-framework/examples/benchmark/), jsonx against React, htmx and `innerHTML`

## Quick start

There's no build step and nothing to install. Copy `jsonx.js`, `templates.js`, `components.js` and `vendor/` into your site, and load jsonx as a module:

```html
<script type="module" src="jsonx.js"></script>
```

It needs a web server, even locally (`npx serve .`), because it's a JavaScript module. To try the examples, serve this folder and open `examples/tutorial/`. Each example's `mock-api.js` pretends to be the server by answering `fetch` calls to `.../api/...` in the browser.

## The idea: regions

jsonx assumes your API is shaped for the page. Instead of small resources that the browser has to stitch together, each endpoint answers with the **whole view, ready to draw**, like a server-side partial render but in JSON.

An element with a template is a **region**. The template can sit inside it, as above, or elsewhere on the page with `jx:template="#id"`. Three rules do the rest:

1. **A region loads itself.** A `<wa-card>` can't be clicked, so its default trigger is `load`.
2. **Results re-render the region.** A button inside a region doesn't need `jx:target` or `jx:template`. Whatever it calls, the response is drawn with the region's template.
3. **A region is a form without the `<form>`.** Every request from inside it sends the region's named controls, so a hidden `<input name="filter">` tells the server the current filter on every click.

Errors are part of the view too: if the title is empty, the todo server sends the same view with an `error` field, and the template shows it with `<jx-if test="error">`. Keep half-typed text in the view as well (the todo API echoes the title back as `draft`), so the server's view is always the truth.

## Templates

A template is plain HTML inside a `<template>` tag, plus four rules:

| You write | What it does |
|---|---|
| `{{title}}` | Prints a value, between tags or inside an attribute value. Always HTML-escaped, so user text is safe. Dotted names work: `{{stats.done}}`, and `{{.}}` is the current item itself. |
| `<jx-each items="todos">…</jx-each>` | Repeats what's inside for each item in the list. Inside it, names refer to the item first, then the outer view. Items with an `id` are tracked by it, so adding or removing one only adds or removes that row. Given a single object instead of a list, it draws once with the object's fields in scope. |
| `<jx-if test="error">…</jx-if>` | Draws what's inside only if the value is there. `test="!todos"` is the opposite: only if it's missing, false, or an empty list. |
| `<jx-else-if test="…">`, `<jx-else>` | Right after a `<jx-if>` (only spaces and comments between), they draw when the branches before them didn't. |
| `checked="{{done}}"`, `value="{{draft}}"` | When an attribute's whole value is one `{{name}}`, it's smart: if the element has a property with that name, the live property is set, so form controls always show the view. Otherwise `true`/`false` adds or removes the attribute, and anything else becomes its text. |
| `class:done="{{done}}"` | Turns the class `done` on or off. |
| `jx:markdown="{{body}}"`, `jx:html="{{body}}"` | Draws the value as Markdown or HTML inside the element. It's cleaned with [DOMPurify](https://github.com/cure53/DOMPurify) first: no scripts, `onclick=` handlers or `javascript:` links, and nothing jsonx would act on (`jx-` attributes, templates, forms), so the text can't make requests. The libraries ([marked](https://marked.js.org) and DOMPurify, in `vendor/`) load only on pages that use them. |

The `<jx-…>` tags only mark what to repeat or show. They're never put on the page, so they don't affect your layout or CSS (`ul > li` still matches).

```html
<jx-if test="viewer">
  <a href="settings.html">Settings</a>
</jx-if>
<jx-else-if test="loading">
  <wa-spinner></wa-spinner>
</jx-else-if>
<jx-else>
  <a href="login.html">Sign in</a>
</jx-else>
```

**Inside `<table>` and `<select>`, put the logic on the element instead.** The browser's HTML parser moves unknown tags out of tables and selects before jsonx ever sees them, so there you write `<tr jx:each="rows">`, `<option jx:if="x">`, and `jx:else-if="y"` / `jx:else` on the next element. Everywhere else, use the tags.

Reuse a template inside another with `<template jx:use="#todo-item"></template>`. A `{{name}}` inside a `<textarea>` becomes its value.

Everything else is text: `{{name}}` never inserts HTML. That's the whole language. There's no other logic on purpose: if the page needs to know something, like which filter button is highlighted, the server works it out and sends it.

### A template that loads itself

Put the request on the `<template>` itself, and it loads and draws right where it is, with no wrapper element to write:

```html
<template jx:get="/api/stats">
  <p>{{done}} of {{total}} done</p>
</template>
```

(jsonx swaps the template for a `<jx-view>` element with the same attributes. It takes no space in the layout.)

### Reusable HTML in .jx files

`<template src="nav.jx"></template>` pulls in a file of plain HTML. Use it for anything shared between pages, like a navigation bar or a list partial. The file can hold anything a page can: templates that load themselves, partials for `jx:use`, and GraphQL queries.

```html
<!-- nav.jx -->
<header class="site-nav">
  <template jx:get="/view/nav">
    <a href="index.html">Home</a>
    <jx-if test="signedIn">
      <a href="settings.html">Settings</a>
    </jx-if>
  </template>
</header>
```

Each file is fetched once. Nothing on the page is wired until every file is in, so a page's templates can use partials from them straight away. `<template src="row.jx" jx:get="/api/rows">` uses the file as that template's content instead. Conduit and Conduit on GraphQL share their nav bar and article list this way.

## Requests

### Attributes

| Attribute | What it does | Default |
|---|---|---|
| `jx:get`, `jx:post`, `jx:put`, `jx:patch`, `jx:delete` | The URL to call, and with which HTTP method. It can use `{{name}}` when it's inside a template. `fn:name` calls the function `name` instead. | (required) |
| `on:click` | The function to call on a click, like `on:click="add"`, instead of a server. Any event works the same way: `on:submit` for a form, `on:change` for a checkbox or select, and `on:load` runs straight away, so an element with a `<template>` inside fills itself in. See [Functions and shared data](#functions-and-shared-data-optional). | |
| `on:event` modifiers | An element can have several, and modifiers go after a dot: `on:input.delay-300="search"` waits until typing stops, `on:keydown.enter="add"` only listens for that key, and `.once`, `.prevent` and `.stop` do what they say. Not `onclick`: that's the browser's own, and runs as code. | |
| `jx:trigger` | The event that starts the request. Any event name works, including custom events. Add `delay:300ms` to wait until events stop (good for search boxes), or `from:#other` to listen on another element. Use `keydown[key=Enter]` to fire only for one key. Use `load` to run once on page load, and `revealed` to run when the element scrolls into view (a "load more" row). List several with commas. | depends on the element, see below |
| `jx:template` | Selector of a `<template>` that draws the JSON, for when it isn't inside the element. An element with a template is a region. | the template inside, or the region's |
| `jx:target` | Where the result goes: a CSS selector, `this`, or `closest <selector>`. | the region, or else the element itself |
| `jx:swap` | `prop:<name>` sets a property on the target instead of drawing a template (good for components that take data). `none` calls the API and draws nothing. | draw the template |
| `jx:include` | Also send the values of other elements, e.g. `jx:include="#filter"`. | none |
| `jx:vals` | Extra values to send. In a template, name them: `jx:vals="id product"` sends `{"id": 3, "product": "Tea"}`, numbers and all. `todo.id` sends it as `id`, and `filter=name` renames. Or write JSON: `jx:vals='{"page": 1}'`. | none |
| `jx:query` | Makes it a GraphQL request: the query comes from these `<script type="text/graphql">` elements (several, for fragments), and the values become its variables. Sent to `jsonx.graphql`, `/graphql` by default. | |
| `jx:operation` | Which operation to run, when the script holds several. | |
| `jx:select` | Draw only part of the answer, e.g. `jx:select="favoriteArticle.query"`. | the whole answer |
| `jx:then` | After the request works, go to this page. `:name` is filled from the server's answer, e.g. `jx:then="article.html?slug=:article.slug"`. | stay |
| `jx:push-url` | On a region: when a GET (or GraphQL query) from it works, the values it sent go into the address bar, so refresh, back and forward, and shared links show the same view. Write the names into its own request so it can load from the address, e.g. `jx:get="/view/home?tab=:tab&page=:page" jx:push-url`. `jx:push-url="tab page"` keeps just those names. | off |
| `jx:refresh` | After the request works, reload these regions the way they were last loaded, e.g. `jx:refresh="#comments"` or `jx:refresh="closest [jx\:template]"`. For APIs that answer with one thing instead of the whole view. | none |
| `jx:region` | Makes an element a region with no URL: it draws its template once, with an empty view. Good for a sign-in form. | |
| `jx:data` | Makes an element a region that draws the variable with this name, and draws it again after every `fn:` call. On an element with an `fn:` request, it names the data that call changes, so only those regions redraw. See [Functions and shared data](#functions-and-shared-data-optional). | |
| `jx:ws` | Makes an element a region drawn from a WebSocket: every message is JSON, the region's whole view. The region has the class `jx-ws-connecting`, `jx-ws-open` or `jx-ws-closed`, and it reconnects by itself, waiting longer each time (up to 30s). | |
| `jx:ws-send` | Sends the element's values (what a `jx:post` would send) as one JSON message over the socket of the `jx:ws` region around it, or of the one it names (`jx:ws-send="#chat"`). Messages sent while it's reconnecting go once it's back. | |
| `jx:emit` | Fires an event with this name when the element is clicked (or on its `jx:trigger`), with the current item as `event.detail`, or with `jx:detail='{"id": {{id}}}'` instead. For components. | |

### Triggers

You usually don't need `jx:trigger`, because jsonx picks one from the kind of element:

| Element | Default trigger |
|---|---|
| `<form>` | `submit` |
| `<button>`, `<a>`, and button components like `<wa-button>` | `click` |
| `<input>`, `<select>`, `<textarea>`, and form-control components like `<wa-checkbox>` or `<wa-select>` | `change` |
| Anything else: `<div>`, `<ul>`, `<wa-card>`… | `load` |

In short: things you click get `click`, things you change get `change`, and things you can't interact with fill themselves in when the page loads. (A component counts as a form control if it's [form-associated](https://developer.mozilla.org/en-US/docs/Web/API/ElementInternals), which all Web Awesome form controls are.)

Writing a trigger for the element itself replaces the default. Triggers with `from:` listen to *other* elements, so they're added on top of the default. For example, `<ul jx:get="/api/todos" jx:trigger="change from:#filter">` loads with the page **and** reloads when the filter changes.

### What gets sent

The named controls in the element's region (or the fields of its `<form>`), then the element's own `name` and `value`, then the values of any `jx:include` elements, then `jx:vals`. Later ones win, so `jx:vals='{"filter": "done"}'` on a button overrides the hidden filter for that one request. GET and DELETE send them as a query string; POST, PUT and PATCH send a JSON body.

**Values from the page address.** On `article.html?slug=hello`, `jx:get="/view/article/:slug"` calls `/view/article/hello`. A `:name` the address doesn't have becomes empty (or, in `jx:vals`, is left out).

**Keeping the address in step.** Add `jx:push-url` to a region, and tab and page buttons inside it update the address bar as they load. Back and forward load the region again from the address. Conduit's home and profile pages work this way:

```html
<div jx:get="/view/home?tab=:tab&tag=:tag&page=:page" jx:push-url>
```

**Dotted names build nested JSON.** `name="user.email"` and `name="user.password"` send `{"user": {"email": …, "password": …}`, which is what APIs like RealWorld expect. A number makes a list, for repeating rows: `items.0.qty` and `items.1.qty` send `{"items": [{"qty": …}, {"qty": …}]}`.

**Typing is never lost.** A view answers a request, so it can't know about anything typed after that request was sent. Controls changed since then keep what's in them, and the next answer catches up. When answers arrive out of order, only the newest request for the same region is drawn. So live validation (`jx:trigger="input delay:300ms"`) is safe even on a slow connection.

**Live views over a WebSocket.** `jx:ws` makes a region that the server draws whenever it likes: each message is the whole view, and only what changed is updated, so a new chat message adds one row. Typing is kept the same way, so a reply arriving mid-sentence doesn't wipe the box. The [chat demo](examples/chat/) has no page script:

```html
<div jx:ws="/ws/echo">
  <template>
    <p jx:each="messages" class="{{from}}">{{text}}</p>
    <form jx:ws-send><input name="text" value="{{draft}}"></form>
  </template>
</div>
```

### Errors

When a request fails and the server sends JSON, jsonx redraws the region with its last view plus three fields, so the template can show what went wrong:

| Field | What it holds |
|---|---|
| `error` | One message for the whole thing: the server's `error` or `message`, or the field errors joined up. |
| `errors` | A list for `<jx-each>`. `{"errors": {"email": ["can't be blank"]}` becomes `[{field: "email", message: "can't be blank", text: "email can't be blank"}]`. |
| `fieldErrors` | The same by field, e.g. `{{fieldErrors.email}}`, to show a message next to its input. |

The next successful answer replaces the view, so the errors go away by themselves. What you typed stays, because the inputs aren't bound to the view. jsonx also fires `jx:error`, for page code.

### Events

jsonx fires DOM events you can listen to from page code. They bubble and cross shadow DOM boundaries.

| Event | When | `event.detail` |
|---|---|---|
| `jx:beforeRequest` | Just before `fetch`. Call `event.preventDefault()` to cancel. | `{ url, options }` |
| `jx:beforeRender` | Just before drawing. Set `event.detail.data` to change what's drawn. | `{ data, url, target, source }` |
| `jx:afterRender` | After the page is updated. If the swap removed the element that made the request, this fires on the target's parent instead. | `{ data, target, source }` |
| `jx:error` | The request failed or returned an error status. If the server's JSON has an `error` field, that's the message. | `{ error }` (with `error.status` and `error.data`) |

## Functions and shared data (optional)

Views usually come from a server. Two opt-in features let the browser supply them too, for state that never touches a server or for reshaping an API you don't control. [Tutorial step 11](examples/server-tutorial/#s11) shows both. They're plain variables and functions:

```html
<script>
  let cart = { count: 0 };
  function add() { cart.count++; }
</script>

<p>Basket: <span jx:data="cart"><template>{{count}} items</template></span></p>
<button on:click="add">Add</button>
```

**`on:click="name"`** calls the function `name(values)` instead of a server when the element is clicked. Name any event the same way: `on:submit`, `on:change`, `on:input.delay-300`. `on:load="name"` runs straight away, so `<div on:load="show"><template>…</template></div>` is a region drawn from what `show` returns. jsonx only ever listens for the event you name; there's no guessing which one an element means. Anywhere a URL goes, `fn:name` does the same (`jx:get="fn:home?tab=:tab"`), which is how a function-backed region keeps the address in step with `jx:push-url`. It gets the values a request would send, and returns the view or a promise of one. Throw `{ error }` or `{ errors }` to fail, and it's shown like a server's error answer. Return nothing when there's nothing to draw. Templates can't tell the difference, so a region can move from a function to a real URL later. The [todo app with functions](examples/todo-functions/) is the whole todo app this way.

**`jx:data="cart"`** makes a region that draws the variable `cart`. After any action, every `jx:data` region is drawn again from its variable, so a function just changes (or replaces) the data. Regions and rows that didn't change are skipped, but each item still takes about a microsecond to check, so with big lists, name what the button changes: `<button jx:post="fn:add" jx:data="cart">` redraws only the `cart` regions. When other code changes the data, like a timer or a `fetch`, call `jsonx.update()` to redraw.

jsonx finds them by name, so on a page put them in a plain `<script>`, not a module (a module's variables are private). In a `.jx` file, a module is the better way: see [Code in .jx files](#code-in-jx-files). In a module, use `jsonx.functions.add = …` and `jsonx.data.cart = …`, which are looked up first. `jsonx.update("cart", function (cart) { … })` changes one piece of data and redraws its regions.

### Code in .jx files

A `.jx` file can hold ordinary code in a `<script>`. Its top-level variables and functions are what `on:click`, `jx:data` and the file's components see, with nothing to export, and they don't leak into the page: two files can each have their own `count`.

**Inside a component, the script is that component's own code.** It runs once for each element, so two `<my-counter>`s count separately, and the component's props are variables in it:

```html
<template id="my-counter" props="start:number step:number">
  <script>
    let count = start ?? 0;
    function up() { count += step ?? 1; }
  </script>
  <button on:click="up">{{count}}</button>
</template>
```

In a `.jx` file, `<template id="my-counter">` is the same as `jx:component="my-counter"`: an id with a dash names a component (on a page, template ids stay for `jx:template`).

**At the top of the file, it's shared** by everything in the file. The [café cart](examples/cart/) is three components in different parts of the page sharing one script in `cart.jx`. A component's prop that isn't set from outside comes from the shared script, so `<cart-badge>` with `props="count"` shows the cart's count with nothing passed in, and `<cart-badge count="99">` still overrides it.

**Nothing says what a button changes.** After each action, jsonx compares the variables things on the page use with how they were before (lists and objects by their contents, so `items.push()` counts), and redraws only what uses the ones that changed. For changes made outside an `fn:` call, like a timer or a socket, call `jsonx.changed()`. Async functions are fine: change the data after the `await`, not before, and a double click can't lose anything.

**In a component's script:**
- `el` is the element, and `props` its props.
- Functions named `connected`, `disconnected` and `rendered` run at those moments.
- `jx:ref="input"` in the template makes `refs.input` that element.
- Its other functions become element methods too, so `el.reset()` works.

Adding `form` to the template (`<template jx:component="star-rating" form>`) makes the component a form field: its `value` variable is what a form or jsonx sends under its `name`. The [widgets demo](examples/widgets/) has a counter, a countdown that starts and stops with the page, and a star rating inside a form, all in `widgets.jx`.

For `import`, use `<script type="module">` instead, and `export` what the file should see. `jx:data` can name several values: `jx:data="items total"` draws `{ items, total }`.

## Web components

jsonx treats web components like native elements: Web Awesome's `<wa-input>`, `<wa-checkbox>` and `<wa-button>` work the way `<input>` and `<button>` do. There are four ways they fit together, and the [feature tour](examples/basic/) has each.

### Write components as templates

A template can define a web component:

```html
<!-- vote-button.jx -->
<template jx:component="vote-button" props="label votes">
  <style>button { border-radius: 999px; }</style>
  <button jx:emit="vote">{{label}} <strong>{{votes}}</strong></button>
</template>
```

```html
<template src="vote-button.jx"></template>
…
<jx-each items="options">
  <vote-button label="{{label}}" votes="{{votes}}" jx:post="/api/poll/{{id}}/vote" jx:trigger="vote"></vote-button>
</jx-each>
```

- jsonx defines `<vote-button>` as a **LitElement** as soon as it finds the template (on the page, or in a `.jx` file).
- **Props** are reactive properties, and attributes too (`favoritesCount` is the attribute `favorites-count`; a bare attribute means `true`). Attributes are text unless the prop names a type: `props="start:number open:boolean items:json"`. A `{{value}}` in a jsonx template sets the property, so objects and lists can be passed in.
- It draws into **shadow DOM**, so its `<style>` stays inside and `<slot>` works. `jx-` attributes inside work as usual.
- **`jx:emit="vote"`** fires a `vote` event (bubbling, and out of the shadow root) when the element is clicked, or on its `jx:trigger`, with the current item as `event.detail`. Components don't make requests for the page: they fire events, and the page puts the request on the component, with `jx:trigger="vote"`.
- Web components used inside one that load on demand (like Web Awesome's) are introduced to their autoloader, which otherwise can't see into shadow roots.
- Other code can use them like any custom element, and Lit code can subclass them or await `updateComplete`. jsonx needs to be on the page.

Both Conduit apps share `examples/components/article-preview.jx`: the REST version feeds it from its view API, and the GraphQL version from a fragment whose aliases (`favorited: viewerHasFavorited`) match its props.

### Other web components

- **Components that fire events.** `jx:trigger` accepts any event name, so `<star-rating jx:post="/api/feedback" jx:trigger="rating-changed">` works. jsonx sends the component's `name` attribute and `value` property, like an `<input>`. [Form-associated](https://developer.mozilla.org/en-US/docs/Web/API/ElementInternals) components inside a form are picked up by the form.
- **Components that take JSON as a property.** `jx:swap="prop:stats"` skips templates and does `target.stats = data`, and the component draws itself. Inside a template, `stats="{{stats}}"` does the same.
- **Hand-written components that use jsonx inside.** Call `jsonx.process(this.shadowRoot)` once in `connectedCallback`. Then `jx:target` and `jx:template` look inside the shadow root first, so the component can keep private templates.
- **Wrapping a library as a form field.** Conduit's editor uses `<rich-editor name="body" value="{{article.body}}">`, a [Tiptap](https://tiptap.dev) editor in about 230 lines, with a six-button toolbar (`examples/components/rich-editor.js`). It has a `name` and a `value` property, and fires `input` as you type, so jsonx sends it like a textarea and doesn't redraw over your typing. Its value is HTML, which the article page draws with `jx:html`. Images are uploaded, not linked: the image button, paste or drop sends the file to its `upload` address, which answers `{ "url": "…" }` (the demo's pretend API answers with a data: address). Tiptap keeps only the tags its extensions know, so the editor adds images, `<kbd>` and `<mark>`. Anything else in an article, like a `<script>`, is dropped when it's opened in the editor. It's a hand-written element rather than a `.jx` one because Tiptap needs script, and it stays in the page's DOM because text selection inside shadow DOM is unreliable.

## APIs that aren't shaped for the page

### A view API

The todo app's API sends the whole view on every answer. Most real APIs don't: they're about things (articles, comments), and favouriting an article answers with just that article.

The jsonx answer is a small **view API** in front of it, often called a backend-for-frontend. It runs on your server, calls the real API, and answers with page-shaped views: dates written out, "is this mine?" decided, buttons labelled, page buttons counted. Every action answers with the whole view again. [Conduit](examples/conduit/), the RealWorld app, works this way, and its pages have no script at all:

```
browser (jsonx)  --GET /view/home?tab=feed-->  view API  --GET /api/articles/feed-->  RealWorld API
```

The view API also keeps the sign-in token, the way a real one keeps it in a server-side session behind a cookie, so the browser never handles it. In the demo it's `view-api.js`, running in the browser like the other mocks.

Article bodies are HTML, written in a Tiptap editor and drawn with `jx:html` (see Templates). Everything is cleaned first, so an article can't inject anything into the page.

The view API can also live in the page, as plain functions: `jx:get="fn:home"` calls `async function home(values)`, which calls the RealWorld API and returns the same view. [Conduit with functions](examples/conduit-functions/) works this way. You lose the server-side session (the token sits in the browser) and the views only serve this page, but there's nothing to deploy except the page.

If you can't add a view API, jsonx has three tools for working with the real one from the page:

- **`jx:refresh="#comments"`** reloads regions after a change, the way they were last loaded.
- **`jx:beforeRender`** lets page code reshape the data: set `event.detail.data`.
- **`jsonx.headers`** adds headers, like a token, to every request. It can be an object, or a function that's asked each time. Page code that runs before jsonx can set `window.jsonx = { headers: … }` first.

### Beacon, on a CMS

[Beacon](examples/marketing/), the marketing site, does the same with a Contentful-style CMS. Editors stack section entries (hero, features, pricing, FAQ...) into pages. The view API resolves the links between entries and turns rich text into blocks, and answers with a list of sections, each naming its kind: `{ hero: {...}, pricing: null, ... }`. The page is one HTML file with a template per kind of section, `<jx-each items="hero"><section>…`. A `<jx-each>` on a single object draws it once, with its fields in scope.

### GraphQL

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

<div jx:query="#query, #view" jx:vals='{"slug": ":slug"}'>
  <template>
    <input type="hidden" name="slug" value="{{article.slug}}">
    <h1>{{article.title}}</h1>
    <wa-button jx:query="#favorite, #view" jx:select="favoriteArticle.query">Favorite ({{article.favoritesCount}})</wa-button>
  </template>
</div>
```

- **The region's controls are the variables.** Form values are text, so jsonx reads the query's `$offset: Int` declarations and converts `"10"` to `10` and `"true"` to `true`.
- **A mutation can ask for the view again.** If every mutation's answer includes `query` (the whole Query type), a button can re-select the page's fragment in the same round trip, and `jx:select` draws just that part. Each action is one request, and the region redraws like it does with a view API.
- **GraphQL errors** (`{ errors: [...] }`, sent with status 200) are shown like any other error.
- **The schema still matters.** Fields clients usually want, like `viewerHasFavorited`, `createdAt(format: LONG)` and page buttons on lists, keep templates logic-free. Lists also echo their arguments (`scope`, `offset`), so a tab or hidden input can show what the server used.

## Performance

jsonx reads each template once and turns it into a [Lit](https://lit.dev) template, with a "hole" wherever a value goes. On every update Lit only touches the holes whose values changed: no HTML parsing, no comparing trees, and unchanged elements (including web components, focus and scroll position) are left completely alone.

It also skips work that can't change anything. Each new view is compared with the last one, and the parts that are equal reuse the old objects. A list row whose item didn't change, and whose names from outside the item (like `{{filter}}`) didn't either, is skipped without looking at its holes. A view that didn't change at all draws nothing. The one exception is a form control someone has typed in or clicked since the last draw: its row is always drawn, so the control shows the view again.

If you call `jsonx.render(el, data)` yourself, jsonx copies `data` first, so changing your object later and passing it again still works.

[The benchmark](examples/benchmark/) draws and updates 10 to 10,000 todos in jsonx, React, htmx (swap and morph) and plain `innerHTML`, with Web Awesome components or plain HTML. Run it in your own browser for your own numbers. In short: first draws cost about the same everywhere, because creating elements is most of the work, and updates are where jsonx and React pull ahead of re-sending HTML.

### Big lists

At 1,000 rows every action takes about 100 ms. At 10,000 rows the browser itself is the limit: drawing that many table rows takes about a second even in hand-written code, and jsonx takes one and a half to two times that. So don't draw them all: page them, or load more as the person scrolls, like the [data table](examples/data-table/). Each step only adds the new rows, so it stays around 25 ms however long the list gets:

```html
<tbody><tr jx:each="rows">…</tr></tbody>
<jx-if test="more">
  <p jx:get="/api/rows" jx:trigger="revealed" jx:vals='{"limit": {{nextLimit}}}'>Loading more…</p>
</jx-if>
```

## How it works

1. **Find and wire.** On page load, find every element with a `jx-<method>` attribute and add an event listener for its trigger. A `MutationObserver` does the same for elements added later. For a web component whose code hasn't loaded yet, jsonx waits for `customElements.whenDefined()` first, so it can tell whether the component is a button or a form control.
2. **Request.** When the event fires, collect the values, build the `fetch` call, and send it.
3. **Render.** The first time a template is used, `templates.js` compiles it into a Lit template (and caches it). Lit then draws the JSON into the target, or updates what's already there.
4. **Wire again.** Run step 1 on the elements the draw added (not the whole region), so `jx-` attributes inside the template work too. That's how each todo's checkbox and Delete button work.

## Design choices, and why

- **JSON instead of HTML from the server.** htmx expects the server to return HTML. jsonx moves rendering into the browser, so the same API can also serve a mobile app or other clients. The trade-off is that templates now live in the page.
- **Our own tiny template language.** Lit is fast but has rules about where values can go. Writing templates as real HTML and compiling them means those rules never show up: every `{{name}}` lands somewhere valid, and there's less to learn than EJS or Mustache.
- **Templates in `<template>` tags.** The browser parses them as real HTML without showing or running them, which is exactly what the compiler needs.
- **No build step, one dependency (Lit, vendored).** Easy to read, easy to change.

## Files

| File | What it is |
|---|---|
| `jsonx.js` | The framework: wiring, triggers, values and requests (heavily commented). Read this first. |
| `templates.js` | The template language, compiled to Lit. |
| `components.js` | Web components written as templates (`jx:component`). |
| `vendor/lit-html/` | lit-html 3.3.1 and its `repeat` directive (BSD-3-Clause, see `vendor/lit-html/LICENSE.txt`). |
| `vendor/lit-element/` | LitElement 4.2.1, the base class for components (BSD-3-Clause). |
| `vendor/dompurify/`, `vendor/marked/` | DOMPurify 3.4.16 (Apache-2.0 or MPL-2.0) and marked 18.1.0 (MIT), for `jx:markdown` and `jx:html`. Pages that only use `jx:html` don't load marked. |
| `vendor/tiptap/` | Tiptap 3.31.4 with StarterKit and Image, bundled into one file for `<rich-editor>` (MIT, see `vendor/tiptap/LICENSES.txt`). |
| `vendor/react/`, `vendor/htmx/` | React 18.3.1, htmx 2.0.4 and idiomorph 0.3.0, for the benchmark only. |
| `examples/todo/` | The Web Awesome todo app, with its mock API. |
| `examples/todo-functions/` | The same app, with plain `fn:` functions in the page instead of a server. |
| `examples/calculator/` | A calculator built the same way. |
| `examples/widgets/` | Components with their own code: state per element, lifecycle hooks, typed props and a form field, in `widgets.jx`. |
| `examples/cart/` | Three components sharing one script in `cart.jx`, redrawn by change detection. |
| `examples/chat/` | A WebSocket chatbot with no page script. `echo-server.js` is a pretend WebSocket server in the page. |
| `examples/table-graphql/` | A paged, sortable table with no script: one GraphQL query, over a pretend GraphQL server (`people-server.js`). |
| `examples/data-table/` | A 10,000-row table with search, sort and infinite scroll (`jx:trigger="revealed"`), from one plain function. |
| `examples/basic/` | The feature tour: one live example per feature. |
| `examples/components/` | `article-preview.jx`, a component shared by the Conduit apps, and `rich-editor.js`, their Tiptap editor. |
| `examples/tutorial/` | The tutorial: variables, events and components. |
| `examples/server-tutorial/` | The server tutorial: views from a server, with jx:get and jx:post. |
| `examples/conduit/` | The RealWorld app: one HTML file per page and no page script. `view-api.js` is a pretend backend-for-frontend that turns the RealWorld API (`mock-api.js`) into page-shaped views. |
| `examples/conduit-functions/` | Conduit again, with no server of its own: `views.js` holds the view API as plain `fn:` functions that call the RealWorld API. It shares Conduit's styles, mock and article list. |
| `examples/conduit-graphql/` | Conduit again, talking GraphQL. Queries live in the pages; `graphql-server.js` is a pretend GraphQL server (the real graphql-js, in `vendor/`) over the RealWorld mock. |
| `examples/marketing/` | A marketing site in one HTML file. `cms-api.js` is a pretend Contentful (entries, links, rich text) and `view-api.js` turns its entries into page sections. |
| `examples/benchmark/` | Times an update in jsonx, React, htmx (swap and morph) and plain `innerHTML`. |
| `index.html` | The GitHub Pages home page. |
| `.github/workflows/pages.yml` | Publishes the site to GitHub Pages on every push to `main`. |

## Ideas for what to build next

- `jx:indicator="#spinner"` to show a separate loading element.
- `jx:confirm="Are you sure?"` before a delete.
- Polling: `jx:trigger="every 5s"`.
- Publishing to npm.

## Publishing

Every push to `main` publishes the site to GitHub Pages using `.github/workflows/pages.yml`. There's no build step: the workflow copies `index.html`, the top-level `.js` files, `vendor/` and `examples/`.
