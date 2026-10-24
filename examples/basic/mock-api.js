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

  var likes = 0;

  // Changes every time it's asked, so "Refresh stats" visibly does something.
  var stats = { total: 5, done: 1 };

  var users = [
    { id: 1, name: "Ada Lovelace", role: "Mathematician", pioneer: true },
    { id: 2, name: "Alan Turing", role: "Computer scientist", pioneer: true },
    { id: 3, name: "Grace Hopper", role: "Rear admiral", pioneer: true },
    { id: 4, name: "Linus Torvalds", role: "Kernel hacker", pioneer: false },
    { id: 5, name: "Margaret Hamilton", role: "Apollo software lead", pioneer: true },
    { id: 6, name: "Tim Berners-Lee", role: "Inventor of the web", pioneer: false }
  ];

  // Each route: [method, url pattern, handler(match, body, query)] -> data or [status, data].
  // Like the todo app, each answer is shaped for the page that shows it.
  var routes = [
    ["GET", /^\/api\/likes$/, function () {
      return { likes: likes, label: likes === 1 ? "1 like" : likes + " likes" };
    }],

    ["POST", /^\/api\/likes$/, function () {
      likes++;
      return { likes: likes, label: likes === 1 ? "1 like" : likes + " likes" };
    }],

    ["POST", /^\/api\/broken$/, function () {
      return [500, { error: "The server had a problem (on purpose)" }];
    }],

    ["GET", /^\/api\/users$/, function (m, body, query) {
      var q = (query.get("q") || "").toLowerCase();
      return {
        query: q,
        users: users.filter(function (u) { return u.name.toLowerCase().indexOf(q) !== -1; })
      };
    }],

    ["GET", /^\/api\/users\/(\d+)$/, function (m) {
      var user = users.find(function (u) { return u.id === Number(m[1]); });
      return user || [404, { error: "Not found" }];
    }],

    ["GET", /^\/api\/stats$/, function () {
      stats.done = (stats.done % stats.total) + 1;
      return { total: stats.total, done: stats.done, open: stats.total - stats.done };
    }],

    ["POST", /^\/api\/likes\/reset$/, function () {
      likes = 0;
      return [204, null];
    }],

    // Answers with what it was sent, so you can see how values are collected.
    ["POST", /^\/api\/echo$/, function (m, body) {
      return { sent: JSON.stringify(body, null, 2) };
    }],

    ["GET", /^\/api\/time$/, function () {
      return { time: new Date().toLocaleTimeString() };
    }],

    ["POST", /^\/api\/settings$/, function (m, body) {
      var on = body.notify === "on";
      return { notify: on, label: on ? "You'll get emails." : "No emails." };
    }],

    ["POST", /^\/api\/feedback$/, function (m, body) {
      var stars = Number(body.stars);
      return { stars: stars, message: "Thanks! You gave " + stars + (stars === 1 ? " star." : " stars.") };
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
