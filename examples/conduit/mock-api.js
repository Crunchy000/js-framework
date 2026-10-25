/*
 * mock-api.js — a pretend RealWorld ("Conduit") server, running in the browser.
 *
 * It follows the RealWorld API spec (github.com/realworld-apps/realworld,
 * specs/api/openapi.yml), so the pages should work against a real RealWorld
 * backend too: remove this file and serve the pages next to your server's /api/.
 *
 * Everything is kept in localStorage, so your articles survive a refresh.
 * "Reset demo data" on the settings page clears it.
 *
 * Like most APIs, and unlike our todo API, this one is shaped around things
 * (articles, comments, profiles), not around pages. app.js adapts it.
 */
(function () {
  "use strict";

  var KEY = "conduit-db-v2"; // v2: article bodies are Markdown

  function seed() {
    var users = [
      { email: "demo@conduit.dev", password: "password123", username: "demo", bio: "I write about tiny frameworks.", image: null, following: ["ada"] },
      { email: "ada@conduit.dev", password: "password123", username: "ada", bio: "Mathematician. First programmer.", image: null, following: [] },
      { email: "grace@conduit.dev", password: "password123", username: "grace", bio: "Rear admiral. Found the first bug.", image: null, following: ["ada"] }
    ];
    var texts = [
      ["ada", "Notes on the Analytical Engine", "Why a machine can do more than arithmetic", "The engine weaves algebraic patterns just as the loom weaves flowers and leaves.\n\nIt might act upon other things besides number.", ["history", "computing"]],
      ["grace", "The first actual bug", "A moth, a relay, and a logbook", "We found a moth stuck in **relay 70** of the Mark II.\n\nIt was taped into the logbook, with a note:\n\n> First actual case of bug being found.\n\nArticles can mix in a little HTML too: the moth is now in the <mark>Smithsonian</mark>.", ["history", "debugging"]],
      ["demo", "Why JSON views beat HTML partials", "Same API for the web and for apps", "Send the **whole view** as JSON, shaped for the page, and let a small template draw it.\n\n## Why\n\n- The same API serves the web and mobile apps\n- The server still decides what the page shows\n- Templates stay plain HTML\n\nRead more in the [jsonx README](https://github.com/crunchy000/js-framework).", ["jsonx", "webdev"]],
      ["grace", "It's easier to ask forgiveness", "On getting things done in big organisations", "It's easier to ask forgiveness than it is to get permission.", ["leadership"]],
      ["ada", "Imagination is the discovering faculty", "On science and poetry", "Imagination is the discovering faculty, pre-eminently.\n\nIt is that which penetrates into the unseen worlds around us.", ["science"]],
      ["demo", "Web components and templates", "Using Web Awesome with jsonx", "Web components are just elements, so templates can use them like any other tag.\n\nForm controls are picked up by name, the same as inputs.", ["jsonx", "webcomponents"]],
      ["grace", "Writing a compiler", "Teaching computers to speak English", "I had a running compiler and nobody would touch it. They told me computers could only do arithmetic.", ["computing", "compilers"]],
      ["ada", "That brain of mine", "More than merely mortal", "That brain of mine is something more than merely mortal, as time will show.", ["history"]],
      ["demo", "Keyed lists in five minutes", "Why rows need an id", "When each row has an `id`, adding one row only adds one row.\n\n```html\n<jx-each items=\"todos\">\n  <li>{{title}}</li>\n</jx-each>\n```\n\nWithout ids, rows are matched by position.", ["jsonx", "performance"]],
      ["grace", "Nanoseconds", "A foot of wire", "A nanosecond is the distance light travels in a billionth of a second: about a foot.", ["computing", "science"]],
      ["ada", "The science of operations", "A new name for a new subject", "The science of operations is a science of itself, and has its own abstract truth and value.", ["computing", "science"]],
      ["demo", "Hello, Conduit", "My first article", "This whole app is a few HTML templates and one small script.\n\n### Markdown and HTML, safely\n\nArticle bodies are **Markdown**, and they can hold *some* HTML, like <kbd>Ctrl</kbd> + <kbd>C</kbd>.\n\nAnything dangerous is removed before it's drawn. This article tries four attacks, and none of them work:\n\n<img src=\"x\" onerror=\"document.body.dataset.hacked = 'yes'\" alt=\"a broken image, harmless\">\n\n<script>document.body.dataset.hacked = 'yes'</script>\n\n[A link that tries to run code](javascript:document.body.dataset.hacked='yes')\n\n<button jx-post=\"/view/logout\">A button that tries to sign you out</button>", ["jsonx"]]
    ];
    var start = Date.parse("2026-09-01T10:00:00Z");
    var articles = texts.map(function (t, i) {
      var date = new Date(start + i * 2.3 * 86400000).toISOString();
      return { slug: slugify(t[1]), author: t[0], title: t[1], description: t[2], body: t[3], tagList: t[4], createdAt: date, updatedAt: date, favoritedBy: i % 3 === 0 ? ["demo"] : (i % 2 ? ["ada", "grace"] : []) };
    });
    var comments = [
      { id: 1, slug: articles[0].slug, author: "grace", body: "Still the best description of programming I know.", createdAt: articles[0].createdAt },
      { id: 2, slug: articles[2].slug, author: "ada", body: "So the template is the loom, and the JSON the thread?", createdAt: articles[2].createdAt }
    ];
    return { users: users, articles: articles, comments: comments, nextComment: 3 };
  }

  var db;
  try { db = JSON.parse(localStorage.getItem(KEY)); } catch (e) { db = null; }
  if (!db) db = seed();
  function save() { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { /* private mode */ } }
  window.resetConduitData = function () { db = seed(); save(); };

  function slugify(title) {
    return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "article";
  }
  function findUser(name) { return db.users.find(function (u) { return u.username === name; }); }

  // --- The JSON shapes from the spec ---------------------------------------

  function userJson(u) {
    return { user: { email: u.email, token: "mock-jwt." + btoa(u.username), username: u.username, bio: u.bio, image: u.image } };
  }
  function profileJson(u, me) {
    return { username: u.username, bio: u.bio, image: u.image, following: !!me && me.following.indexOf(u.username) !== -1 };
  }
  function articleJson(a, me, withBody) {
    var json = {
      slug: a.slug, title: a.title, description: a.description, tagList: a.tagList.slice(),
      createdAt: a.createdAt, updatedAt: a.updatedAt,
      favorited: !!me && a.favoritedBy.indexOf(me.username) !== -1,
      favoritesCount: a.favoritedBy.length,
      author: profileJson(findUser(a.author), me)
    };
    if (withBody) json.body = a.body;
    return json;
  }
  function commentJson(c, me) {
    return { id: c.id, createdAt: c.createdAt, updatedAt: c.createdAt, body: c.body, author: profileJson(findUser(c.author), me) };
  }
  function list(articles, query, me) {
    var limit = Number(query.get("limit")) || 20;
    var offset = Number(query.get("offset")) || 0;
    articles = articles.slice().sort(function (a, b) { return b.createdAt < a.createdAt ? -1 : 1; });
    return {
      articles: articles.slice(offset, offset + limit).map(function (a) { return articleJson(a, me, false); }),
      articlesCount: articles.length
    };
  }
  function invalid(errors) { return [422, { errors: errors }]; }
  function blank(fields, object) {
    var errors = {};
    fields.forEach(function (f) { if (!object || !String(object[f] || "").trim()) errors[f] = ["can't be blank"]; });
    return Object.keys(errors).length ? errors : null;
  }

  // --- Routes: [method, path, needs sign-in?, handler(match, body, query, me)] ---

  var routes = [
    ["POST", /^\/api\/users\/login$/, false, function (m, body) {
      var errors = blank(["email", "password"], body.user);
      if (errors) return invalid(errors);
      var u = db.users.find(function (u) { return u.email === body.user.email && u.password === body.user.password; });
      if (!u) return [401, { errors: { "email or password": ["is invalid"] } }];
      return userJson(u);
    }],
    ["POST", /^\/api\/users$/, false, function (m, body) {
      var errors = blank(["username", "email", "password"], body.user);
      if (errors) return invalid(errors);
      var taken = {};
      if (findUser(body.user.username)) taken.username = ["has already been taken"];
      if (db.users.some(function (u) { return u.email === body.user.email; })) taken.email = ["has already been taken"];
      if (Object.keys(taken).length) return [409, { errors: taken }];
      var u = { email: body.user.email, password: body.user.password, username: body.user.username, bio: null, image: null, following: [] };
      db.users.push(u); save();
      return [201, userJson(u)];
    }],
    ["GET", /^\/api\/user$/, true, function (m, body, q, me) { return userJson(me); }],
    ["PUT", /^\/api\/user$/, true, function (m, body, q, me) {
      var changes = body.user || {};
      if (changes.username && changes.username !== me.username && findUser(changes.username)) {
        return [409, { errors: { username: ["has already been taken"] } }];
      }
      ["email", "bio", "image", "password"].forEach(function (f) {
        if (changes[f] !== undefined && (f !== "password" || changes[f])) me[f] = changes[f] || (f === "email" ? me.email : null);
      });
      if (changes.username && changes.username !== me.username) {
        var old = me.username;
        db.articles.forEach(function (a) {
          if (a.author === old) a.author = changes.username;
          a.favoritedBy = a.favoritedBy.map(function (n) { return n === old ? changes.username : n; });
        });
        db.comments.forEach(function (c) { if (c.author === old) c.author = changes.username; });
        db.users.forEach(function (u) { u.following = u.following.map(function (n) { return n === old ? changes.username : n; }); });
        me.username = changes.username;
      }
      save();
      return userJson(me);
    }],

    ["GET", /^\/api\/profiles\/([^/]+)$/, false, function (m, body, q, me) {
      var u = findUser(decodeURIComponent(m[1]));
      return u ? { profile: profileJson(u, me) } : [404, { errors: { profile: ["not found"] } }];
    }],
    ["POST", /^\/api\/profiles\/([^/]+)\/follow$/, true, function (m, body, q, me) {
      var u = findUser(decodeURIComponent(m[1]));
      if (!u) return [404, { errors: { profile: ["not found"] } }];
      if (me.following.indexOf(u.username) === -1) me.following.push(u.username);
      save();
      return { profile: profileJson(u, me) };
    }],
    ["DELETE", /^\/api\/profiles\/([^/]+)\/follow$/, true, function (m, body, q, me) {
      var u = findUser(decodeURIComponent(m[1]));
      if (!u) return [404, { errors: { profile: ["not found"] } }];
      me.following = me.following.filter(function (n) { return n !== u.username; });
      save();
      return { profile: profileJson(u, me) };
    }],

    ["GET", /^\/api\/articles\/feed$/, true, function (m, body, q, me) {
      return list(db.articles.filter(function (a) { return me.following.indexOf(a.author) !== -1; }), q, me);
    }],
    ["GET", /^\/api\/articles$/, false, function (m, body, q, me) {
      var tag = q.get("tag"), author = q.get("author"), favorited = q.get("favorited");
      return list(db.articles.filter(function (a) {
        return (!tag || a.tagList.indexOf(tag) !== -1) &&
          (!author || a.author === author) &&
          (!favorited || a.favoritedBy.indexOf(favorited) !== -1);
      }), q, me);
    }],
    ["POST", /^\/api\/articles$/, true, function (m, body, q, me) {
      var errors = blank(["title", "description", "body"], body.article);
      if (errors) return invalid(errors);
      var slug = slugify(body.article.title);
      if (db.articles.some(function (a) { return a.slug === slug; })) slug += "-" + Date.now().toString(36);
      var now = new Date().toISOString();
      var a = { slug: slug, author: me.username, title: body.article.title, description: body.article.description, body: body.article.body, tagList: body.article.tagList || [], createdAt: now, updatedAt: now, favoritedBy: [] };
      db.articles.push(a); save();
      return [201, { article: articleJson(a, me, true) }];
    }],
    ["GET", /^\/api\/articles\/([^/]+)$/, false, function (m, body, q, me) {
      var a = db.articles.find(function (a) { return a.slug === m[1]; });
      return a ? { article: articleJson(a, me, true) } : [404, { errors: { article: ["not found"] } }];
    }],
    ["PUT", /^\/api\/articles\/([^/]+)$/, true, function (m, body, q, me) {
      var a = db.articles.find(function (a) { return a.slug === m[1]; });
      if (!a) return [404, { errors: { article: ["not found"] } }];
      if (a.author !== me.username) return [403, { errors: { article: ["is not yours"] } }];
      var changes = body.article || {};
      var errors = {};
      ["title", "description", "body"].forEach(function (f) {
        if (changes[f] !== undefined && !String(changes[f]).trim()) errors[f] = ["can't be blank"];
      });
      if (Object.keys(errors).length) return invalid(errors);
      ["title", "description", "body", "tagList"].forEach(function (f) { if (changes[f] !== undefined) a[f] = changes[f]; });
      a.updatedAt = new Date().toISOString();
      save();
      return { article: articleJson(a, me, true) };
    }],
    ["DELETE", /^\/api\/articles\/([^/]+)$/, true, function (m, body, q, me) {
      var a = db.articles.find(function (a) { return a.slug === m[1]; });
      if (!a) return [404, { errors: { article: ["not found"] } }];
      if (a.author !== me.username) return [403, { errors: { article: ["is not yours"] } }];
      db.articles = db.articles.filter(function (x) { return x !== a; });
      db.comments = db.comments.filter(function (c) { return c.slug !== a.slug; });
      save();
      return [204, null];
    }],

    ["POST", /^\/api\/articles\/([^/]+)\/favorite$/, true, function (m, body, q, me) {
      var a = db.articles.find(function (a) { return a.slug === m[1]; });
      if (!a) return [404, { errors: { article: ["not found"] } }];
      if (a.favoritedBy.indexOf(me.username) === -1) a.favoritedBy.push(me.username);
      save();
      return { article: articleJson(a, me, true) };
    }],
    ["DELETE", /^\/api\/articles\/([^/]+)\/favorite$/, true, function (m, body, q, me) {
      var a = db.articles.find(function (a) { return a.slug === m[1]; });
      if (!a) return [404, { errors: { article: ["not found"] } }];
      a.favoritedBy = a.favoritedBy.filter(function (n) { return n !== me.username; });
      save();
      return { article: articleJson(a, me, true) };
    }],

    ["GET", /^\/api\/articles\/([^/]+)\/comments$/, false, function (m, body, q, me) {
      return { comments: db.comments.filter(function (c) { return c.slug === m[1]; })
        .sort(function (a, b) { return a.createdAt < b.createdAt ? 1 : -1; })
        .map(function (c) { return commentJson(c, me); }) };
    }],
    ["POST", /^\/api\/articles\/([^/]+)\/comments$/, true, function (m, body, q, me) {
      var errors = blank(["body"], body.comment);
      if (errors) return invalid(errors);
      var c = { id: db.nextComment++, slug: m[1], author: me.username, body: body.comment.body, createdAt: new Date().toISOString() };
      db.comments.push(c); save();
      return [201, { comment: commentJson(c, me) }];
    }],
    ["DELETE", /^\/api\/articles\/([^/]+)\/comments\/(\d+)$/, true, function (m, body, q, me) {
      var c = db.comments.find(function (c) { return c.id === Number(m[2]); });
      if (!c) return [404, { errors: { comment: ["not found"] } }];
      if (c.author !== me.username) return [403, { errors: { comment: ["is not yours"] } }];
      db.comments = db.comments.filter(function (x) { return x !== c; });
      save();
      return [204, null];
    }],

    ["GET", /^\/api\/tags$/, false, function () {
      var counts = {};
      db.articles.forEach(function (a) { a.tagList.forEach(function (t) { counts[t] = (counts[t] || 0) + 1; }); });
      return { tags: Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a] || (a < b ? -1 : 1); }) };
    }]
  ];

  // --- Answering fetch() ------------------------------------------------------

  var realFetch = window.fetch.bind(window);

  window.fetch = function (input, options) {
    options = options || {};
    var url = new URL(typeof input === "string" ? input : input.url, location.href);
    if (url.pathname.indexOf("/api/") === -1) return realFetch(input, options);

    var path = url.pathname.slice(url.pathname.indexOf("/api/"));
    var method = (options.method || "GET").toUpperCase();
    var body = options.body ? JSON.parse(options.body) : {};
    var auth = (options.headers || {}).Authorization || "";
    var me = db.users.find(function (u) { return auth === "Token mock-jwt." + btoa(u.username); }) || null;

    for (var i = 0; i < routes.length; i++) {
      var route = routes[i];
      var match = route[0] === method && path.match(route[1]);
      if (!match) continue;
      if (route[2] && !me) return later(401, { errors: { token: [auth ? "is invalid" : "is missing"] } });
      var result = route[3](match, body, url.searchParams, me);
      return Array.isArray(result) ? later(result[0], result[1]) : later(200, result);
    }
    return later(404, { errors: { route: ["not found: " + method + " " + path] } });
  };

  function later(status, data) {
    var response = status === 204
      ? new Response(null, { status: 204 })
      : new Response(JSON.stringify(data), { status: status, headers: { "Content-Type": "application/json" } });
    return new Promise(function (resolve) { setTimeout(function () { resolve(response); }, 120); });
  }
})();
