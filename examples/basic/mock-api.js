/*
 * mock-api.js — a pretend JSON server that lives in the browser.
 *
 * It replaces window.fetch so that any request to /api/... is answered from
 * in-memory data. Every other request goes to the real fetch. This means the
 * demo works by just opening index.html, with no server to install.
 *
 * Delete this file (and its <script> tag) when you have a real API.
 */
(function () {
  "use strict";

  var todos = [
    { id: 1, title: "Read the jsonx source", done: true },
    { id: 2, title: "Write an EJS template", done: false },
    { id: 3, title: "Build a web component", done: false }
  ];
  var nextId = 4;

  var users = [
    { id: 1, name: "Ada Lovelace", role: "Mathematician" },
    { id: 2, name: "Alan Turing", role: "Computer scientist" },
    { id: 3, name: "Grace Hopper", role: "Rear admiral" },
    { id: 4, name: "Linus Torvalds", role: "Kernel hacker" },
    { id: 5, name: "Margaret Hamilton", role: "Apollo software lead" },
    { id: 6, name: "Tim Berners-Lee", role: "Inventor of the web" }
  ];

  // Each route: [method, url pattern, handler(match, body, query)] -> data or [status, data]
  var routes = [
    ["GET", /^\/api\/todos$/, function () { return todos; }],

    ["POST", /^\/api\/todos$/, function (m, body) {
      if (!body.title || !body.title.trim()) return [400, { error: "Title is required" }];
      var todo = { id: nextId++, title: body.title.trim(), done: false };
      todos.push(todo);
      return [201, todo];
    }],

    ["PUT", /^\/api\/todos\/(\d+)$/, function (m, body) {
      var todo = todos.find(function (t) { return t.id === Number(m[1]); });
      if (!todo) return [404, { error: "Not found" }];
      if (body.toggle) todo.done = !todo.done;
      return todo;
    }],

    ["DELETE", /^\/api\/todos\/(\d+)$/, function (m) {
      todos = todos.filter(function (t) { return t.id !== Number(m[1]); });
      return [204, null];
    }],

    ["GET", /^\/api\/stats$/, function () {
      var done = todos.filter(function (t) { return t.done; }).length;
      return { total: todos.length, done: done, open: todos.length - done };
    }],

    ["GET", /^\/api\/users$/, function (m, body, query) {
      var q = (query.get("q") || "").toLowerCase();
      return users.filter(function (u) { return u.name.toLowerCase().indexOf(q) !== -1; });
    }],

    ["GET", /^\/api\/users\/(\d+)$/, function (m) {
      var user = users.find(function (u) { return u.id === Number(m[1]); });
      return user || [404, { error: "Not found" }];
    }],

    ["POST", /^\/api\/feedback$/, function (m, body) {
      return { stars: Number(body.stars), message: "Thanks for the feedback!" };
    }]
  ];

  var realFetch = window.fetch.bind(window);

  window.fetch = function (input, options) {
    options = options || {};
    var url = new URL(typeof input === "string" ? input : input.url, location.href);
    if (url.pathname.indexOf("/api/") === -1) return realFetch(input, options);

    var path = url.pathname.slice(url.pathname.indexOf("/api/"));
    var method = (options.method || "GET").toUpperCase();
    var body = options.body ? JSON.parse(options.body) : {};

    for (var i = 0; i < routes.length; i++) {
      var match = routes[i][0] === method && path.match(routes[i][1]);
      if (!match) continue;
      var result = routes[i][2](match, body, url.searchParams);
      // A handler returns either plain data (status 200) or [status, data].
      var hasStatus = Array.isArray(result) && typeof result[0] === "number";
      var status = hasStatus ? result[0] : 200;
      var data = hasStatus ? result[1] : result;
      console.log("[mock-api]", method, path, "->", status);
      return delay(status === 204 ? new Response(null, { status: 204 }) : jsonResponse(status, data));
    }
    return delay(jsonResponse(404, { error: "No mock route for " + method + " " + path }));
  };

  function jsonResponse(status, data) {
    return new Response(JSON.stringify(data), {
      status: status,
      headers: { "Content-Type": "application/json" }
    });
  }

  // A small wait so you can see the loading state, like a real network.
  function delay(response) {
    return new Promise(function (resolve) { setTimeout(function () { resolve(response); }, 250); });
  }
})();
