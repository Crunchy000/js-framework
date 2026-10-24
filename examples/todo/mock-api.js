/*
 * mock-api.js — a pretend JSON server for the todo app.
 *
 * It replaces window.fetch so requests to .../api/... are answered in the browser.
 * Todos are saved in localStorage, so they survive a page refresh.
 *
 * The API is shaped for the page, not the database: every endpoint answers with
 * the WHOLE view, ready to render, like a server-side partial but in JSON:
 *
 *   {
 *     filter: "all",                                // which filter button is selected
 *     filters: [{ name, label, selected, variant, appearance }, ...],  // ready-made buttons
 *     todos:  [{ id, title, done }, ...],           // already filtered
 *     stats:  { total, done, open, percent },       // already counted
 *     draft:  "Buy mi"                              // what's typed in the new-todo box
 *     error:  "Title is required"                   // only when something went wrong
 *   }
 *
 * So the page never has to work anything out: it just draws what it's given.
 * jsonx templates have no logic beyond <jx-if> and <jx-each>, so everything the page
 * shows, like which filter button is highlighted, is worked out here.
 */
(function () {
  "use strict";

  var STORAGE_KEY = "jsonx-todos-v2";
  var FILTERS = ["all", "active", "done"];

  var todos = load() || [
    { id: 1, title: "Try jsonx with Web Awesome", done: true },
    { id: 2, title: "Add a todo of your own", done: false },
    { id: 3, title: "Tick something off", done: false }
  ];

  function load() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch (e) { return null; }
  }
  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(todos)); } catch (e) { /* private mode */ }
  }

  // Builds the view the page renders.
  // `values` is what the page sent: the region's controls, so `filter` and `title`.
  // Echoing the typed title back as `draft` means a re-render never wipes it,
  // and after a successful add we send an empty draft to clear the box.
  function view(values, error, draft) {
    var filter = values.filter;
    if (FILTERS.indexOf(filter) === -1) filter = "all";
    var done = todos.filter(function (t) { return t.done; }).length;
    var result = {
      filter: filter,
      filters: FILTERS.map(function (name) {
        var selected = name === filter;
        return {
          name: name,
          label: name[0].toUpperCase() + name.slice(1),
          selected: selected,
          variant: selected ? "brand" : "neutral",
          appearance: selected ? "accent" : "outlined"
        };
      }),
      todos: todos.filter(function (t) {
        return filter === "all" || (filter === "done" ? t.done : !t.done);
      }),
      stats: {
        total: todos.length,
        done: done,
        open: todos.length - done,
        percent: todos.length ? Math.round((done / todos.length) * 100) : 0
      }
    };
    result.draft = draft === undefined ? (values.title || "") : draft;
    if (error) result.error = error;
    return result;
  }

  // Each route: [method, path pattern, handler(match, values)] -> view.
  // `values` holds the query string (GET/DELETE) or JSON body (POST).
  var routes = [
    ["GET", /^\/api\/todos$/, function (m, values) {
      return view(values);
    }],

    ["POST", /^\/api\/todos$/, function (m, values) {
      var title = (values.title || "").trim();
      // A problem is just part of the view: the page shows `error` like anything else.
      if (!title) return view(values, "Title is required");
      var id = todos.reduce(function (max, t) { return Math.max(max, t.id); }, 0) + 1;
      todos.push({ id: id, title: title, done: false });
      save();
      return view(values, null, "");
    }],

    ["POST", /^\/api\/todos\/(\d+)\/toggle$/, function (m, values) {
      todos.forEach(function (t) { if (t.id === Number(m[1])) t.done = !t.done; });
      save();
      return view(values);
    }],

    ["DELETE", /^\/api\/todos\/completed$/, function (m, values) {
      todos = todos.filter(function (t) { return !t.done; });
      save();
      return view(values);
    }],

    ["DELETE", /^\/api\/todos\/(\d+)$/, function (m, values) {
      todos = todos.filter(function (t) { return t.id !== Number(m[1]); });
      save();
      return view(values);
    }]
  ];

  var realFetch = window.fetch.bind(window);

  window.fetch = function (input, options) {
    options = options || {};
    var url = new URL(typeof input === "string" ? input : input.url, location.href);
    var at = url.pathname.indexOf("/api/");
    if (at === -1) return realFetch(input, options);

    // Works wherever the page is hosted, e.g. /js-framework/examples/todo/api/todos
    var path = url.pathname.slice(at);
    var method = (options.method || "GET").toUpperCase();
    var values = Object.fromEntries(url.searchParams);
    if (options.body) Object.assign(values, JSON.parse(options.body));

    for (var i = 0; i < routes.length; i++) {
      var match = routes[i][0] === method && path.match(routes[i][1]);
      if (!match) continue;
      return later(json(200, routes[i][2](match, values)));
    }
    return later(json(404, { error: "No route for " + method + " " + path }));
  };

  function json(status, data) {
    return new Response(JSON.stringify(data), { status: status, headers: { "Content-Type": "application/json" } });
  }

  // A short wait, like a real network, so the loading state is visible.
  function later(response) {
    return new Promise(function (resolve) { setTimeout(function () { resolve(response); }, 150); });
  }
})();
