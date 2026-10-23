/*
 * mock-api.js — a pretend RealWorld ("Conduit") server, just the sign-in part.
 *
 * It follows the RealWorld API spec (github.com/realworld-apps/realworld,
 * specs/api/openapi.yml), so this page should work against a real RealWorld
 * backend too: remove mock-api.js and put your server in front of the /api/ URLs.
 *
 *   POST /api/users/login   { user: { email, password } }  ->  { user: { email, token, username, bio, image } }
 *   GET  /api/user          with "Authorization: Token <jwt>" -> { user: {...} }
 *
 * Unlike our todo API, this one is shaped around things, not pages, and its
 * errors come per field: { errors: { "email or password": ["is invalid"] } }.
 */
(function () {
  "use strict";

  var users = [
    { email: "demo@conduit.dev", password: "password123", username: "demo", bio: "I write about tiny frameworks.", image: null }
  ];

  function publicUser(u) {
    return { user: { email: u.email, token: "mock-jwt." + btoa(u.email), username: u.username, bio: u.bio, image: u.image } };
  }

  var routes = [
    ["POST", /^\/api\/users\/login$/, function (m, body) {
      var login = body.user;
      if (!login) return [422, { errors: { body: ["must hold a user object"] } }];
      var errors = {};
      if (!login.email) errors.email = ["can't be blank"];
      if (!login.password) errors.password = ["can't be blank"];
      if (Object.keys(errors).length) return [422, { errors: errors }];
      var found = users.find(function (u) { return u.email === login.email && u.password === login.password; });
      if (!found) return [401, { errors: { "email or password": ["is invalid"] } }];
      return publicUser(found);
    }],

    ["GET", /^\/api\/user$/, function (m, body, headers) {
      var auth = headers.Authorization || "";
      if (!auth) return [401, { errors: { token: ["is missing"] } }];
      var found = users.find(function (u) { return auth === "Token mock-jwt." + btoa(u.email); });
      if (!found) return [401, { errors: { token: ["is invalid"] } }];
      return publicUser(found);
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
    var headers = options.headers || {};

    for (var i = 0; i < routes.length; i++) {
      var match = routes[i][0] === method && path.match(routes[i][1]);
      if (!match) continue;
      var result = routes[i][2](match, body, headers);
      var status = Array.isArray(result) ? result[0] : 200;
      return later(json(status, Array.isArray(result) ? result[1] : result));
    }
    return later(json(404, { errors: { route: ["not found: " + method + " " + path] } }));
  };

  function json(status, data) {
    return new Response(JSON.stringify(data), { status: status, headers: { "Content-Type": "application/json" } });
  }
  function later(response) {
    return new Promise(function (resolve) { setTimeout(function () { resolve(response); }, 250); });
  }
})();
