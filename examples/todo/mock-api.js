/*
 * mock-api.js — a pretend JSON server for the todo app.
 *
 * It replaces window.fetch so requests to .../api/... are answered in the browser.
 * Todos are saved in localStorage, so they survive a page refresh.
 * Swap this file out for a real server and the page doesn't need to change.
 */
(function () {
  "use strict";

  var STORAGE_KEY = "jsonx-todos";

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
  function nextId() {
    return todos.reduce(function (max, t) { return Math.max(max, t.id); }, 0) + 1;
  }
  function find(id) {
    return todos.find(function (t) { return t.id === Number(id); });
  }

  // Each route: [method, path pattern, handler(match, body, query)].
  // A handler returns plain data (status 200) or [status, data].
  var routes = [
    ["GET", /^\/api\/todos$/, function (m, body, query) {
      var filter = query.get("filter") || "all";
      return todos.filter(function (t) {
        return filter === "all" || (filter === "done" ? t.done : !t.done);
      });
    }],

    ["POST", /^\/api\/todos$/, function (m, body) {
      var title = (body.title || "").trim();
      if (!title) return [400, { error: "Title is required" }];
      var todo = { id: nextId(), title: title, done: false };
      todos.push(todo);
      save();
      return [201, todo];
    }],

    ["PUT", /^\/api\/todos\/(\d+)$/, function (m, body) {
      var todo = find(m[1]);
      if (!todo) return [404, { error: "Not found" }];
      if (body.toggle) todo.done = !todo.done;
      save();
      return todo;
    }],

    ["DELETE", /^\/api\/todos\/completed$/, function () {
      todos = todos.filter(function (t) { return !t.done; });
      save();
      return { ok: true };
    }],

    ["DELETE", /^\/api\/todos\/(\d+)$/, function (m) {
      todos = todos.filter(function (t) { return t.id !== Number(m[1]); });
      save();
      return [204, null];
    }],

    ["GET", /^\/api\/stats$/, function () {
      var done = todos.filter(function (t) { return t.done; }).length;
      return {
        total: todos.length,
        done: done,
        open: todos.length - done,
        percent: todos.length ? Math.round((done / todos.length) * 100) : 0
      };
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
    var body = options.body ? JSON.parse(options.body) : {};

    for (var i = 0; i < routes.length; i++) {
      var match = routes[i][0] === method && path.match(routes[i][1]);
      if (!match) continue;
      var result = routes[i][2](match, body, url.searchParams);
      var hasStatus = Array.isArray(result) && typeof result[0] === "number";
      var status = hasStatus ? result[0] : 200;
      var data = hasStatus ? result[1] : result;
      return later(status === 204
        ? new Response(null, { status: 204 })
        : new Response(JSON.stringify(data), { status: status, headers: { "Content-Type": "application/json" } }));
    }
    return later(new Response(JSON.stringify({ error: "No route" }), { status: 404 }));
  };

  // A short wait, like a real network, so the loading state is visible.
  function later(response) {
    return new Promise(function (resolve) { setTimeout(function () { resolve(response); }, 150); });
  }
})();
