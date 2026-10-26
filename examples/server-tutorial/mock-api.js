/*
 * mock-api.js — the pretend server for the tutorial.
 *
 * It replaces window.fetch, so any request to /api/... is answered here, in the
 * browser, from in-memory data. Everything resets when you reload the page.
 *
 * Notice that every answer is the whole view for the region that asked, shaped
 * for its template. The page never works anything out: the server does.
 */
(function () {
  "use strict";

  function time() { return new Date().toLocaleTimeString(); }

  // Lesson 2
  var quotes = [
    { text: "Simplicity is prerequisite for reliability.", author: "Edsger Dijkstra" },
    { text: "The best way to predict the future is to invent it.", author: "Alan Kay" },
    { text: "Make it work, make it right, make it fast.", author: "Kent Beck" }
  ];
  var quoteIndex = -1;

  // Lesson 3
  var hellos = { en: "Hello", fr: "Bonjour", es: "Hola" };

  // Lesson 4
  var count = 0;

  // Lesson 5
  var symbols = { GBP: "£", USD: "$", EUR: "€" };
  function tipView(input) {
    var bill = Math.max(0, Number(input.bill) || 0);
    var tip = Number(input.tip) || 15;
    var people = Math.max(1, Math.round(Number(input.people) || 1));
    var currency = symbols[input.currency] ? input.currency : "GBP";
    var total = bill * (1 + tip / 100);
    return {
      bill: bill, tip: String(tip), people: people, currency: currency, symbol: symbols[currency],
      total: total.toFixed(2), perPerson: (total / people).toFixed(2)
    };
  }

  // Lesson 6
  var nextId = 4;
  var list = [
    { id: 1, name: "Apples", qty: 6, done: false },
    { id: 2, name: "Bread", qty: 1, done: true },
    { id: 3, name: "Milk", qty: 2, done: false }
  ];
  function listView(draft) {
    return { store: "the corner shop", items: list, tags: ["fresh", "local", "cheap"], draft: draft || "" };
  }

  // Lesson 7
  var step = 0;
  var stepNotes = ["Order placed", "Left the warehouse", "Delivered to your door"];
  function deliveryView() {
    return {
      shipped: step >= 1,
      delivered: step >= 2,
      eta: step === 1 ? "tomorrow" : null,
      notes: stepNotes.slice(1, step + 1).map(function (text, i) { return { id: i + 1, text: text }; })
    };
  }

  // Lesson 8
  var likes = 0;
  var comments = [{ id: 1, text: "Great post!" }];
  function postView() {
    return { title: "Regions inside regions", likes: likes, drawnAt: time() };
  }
  function commentsView(draft) {
    return { comments: comments, count: comments.length, loadedAt: time(), draft: draft || "" };
  }

  // Lesson 12
  var poll = [
    { id: 1, label: "Tabs", votes: 3 },
    { id: 2, label: "Spaces", votes: 5 }
  ];
  function pollView() {
    var total = poll.reduce(function (n, o) { return n + o.votes; }, 0);
    return { options: poll, total: total };
  }

  // Each route: [method, path pattern, handler(match, body, query)] -> data or [status, data].
  var routes = [
    ["GET", /^\/api\/greeting$/, function () {
      return { name: "Ada", inbox: { unread: 3 }, motto: "<b>Values are text</b>, never HTML" };
    }],

    ["GET", /^\/api\/quote$/, function () {
      quoteIndex = (quoteIndex + 1) % quotes.length;
      var q = quotes[quoteIndex];
      return { text: q.text, author: q.author, number: quoteIndex + 1, total: quotes.length };
    }],

    ["POST", /^\/api\/hello$/, function (m, body) {
      var name = (body.name || "").trim() || "stranger";
      return { greeting: (hellos[body.language] || hellos.en) + ", " + name + "!" };
    }],

    ["GET", /^\/api\/counter$/, function () { return { count: count }; }],
    ["POST", /^\/api\/counter\/increment$/, function () { count++; return { count: count }; }],
    ["POST", /^\/api\/counter\/reset$/, function () { count = 0; return { count: count }; }],

    ["GET", /^\/api\/tip$/, function () { return tipView({ bill: 60, tip: 15, people: 3, currency: "GBP" }); }],
    ["POST", /^\/api\/tip$/, function (m, body) { return tipView(body); }],

    ["GET", /^\/api\/list$/, function () { return listView(); }],
    ["POST", /^\/api\/list$/, function (m, body) {
      var name = (body.item || "").trim();
      if (name) list.push({ id: nextId++, name: name, qty: 1, done: false });
      return listView();
    }],
    ["POST", /^\/api\/list\/(\d+)\/toggle$/, function (m) {
      list.forEach(function (item) { if (item.id === Number(m[1])) item.done = !item.done; });
      return listView();
    }],
    ["DELETE", /^\/api\/list\/(\d+)$/, function (m) {
      list = list.filter(function (item) { return item.id !== Number(m[1]); });
      return listView();
    }],

    ["GET", /^\/api\/delivery$/, function () { return deliveryView(); }],
    ["POST", /^\/api\/delivery\/next$/, function () { step = Math.min(step + 1, 2); return deliveryView(); }],
    ["POST", /^\/api\/delivery\/reset$/, function () { step = 0; return deliveryView(); }],

    ["GET", /^\/api\/post$/, function () { return postView(); }],
    ["POST", /^\/api\/post\/like$/, function () { likes++; return postView(); }],
    ["GET", /^\/api\/post\/comments$/, function () { return commentsView(); }],
    ["POST", /^\/api\/post\/comments$/, function (m, body) {
      var text = (body.text || "").trim();
      if (!text) return [422, { error: "Write something first." }];
      comments.push({ id: comments.length + 1, text: text });
      return commentsView();
    }],

    ["POST", /^\/api\/signup$/, function (m, body) {
      var errors = {};
      var email = (body.email || "").trim();
      if (!email) errors.email = ["can't be blank"];
      else if (email.indexOf("@") === -1) errors.email = ["doesn't look like an email address"];
      if (!(Number(body.age) >= 18)) errors.age = ["must be 18 or over"];
      if (Object.keys(errors).length) return [422, { errors: errors }];
      return { done: true, email: email };
    }],
    ["GET", /^\/api\/signup$/, function () { return {}; }],

    ["GET", /^\/api\/poll$/, function () { return pollView(); }],
    ["POST", /^\/api\/poll\/(\d+)\/vote$/, function (m) {
      poll.forEach(function (o) { if (o.id === Number(m[1])) o.votes++; });
      return pollView();
    }],

    ["GET", /^\/api\/team$/, function () {
      return {
        lead: { name: "Grace Hopper", role: "Team lead" },
        members: [
          { id: 1, name: "Alan Turing", role: "Engineer" },
          { id: 2, name: "Katherine Johnson", role: "Engineer" },
          { id: 3, name: "Tim Berners-Lee", role: "Designer" }
        ]
      };
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
      var hasStatus = Array.isArray(result) && typeof result[0] === "number";
      return delay(jsonResponse(hasStatus ? result[0] : 200, hasStatus ? result[1] : result));
    }
    return delay(jsonResponse(404, { error: "No mock route for " + method + " " + path }));
  };

  function jsonResponse(status, data) {
    return new Response(JSON.stringify(data), { status: status, headers: { "Content-Type": "application/json" } });
  }

  // A short wait, like a real network, so you can see the loading state.
  function delay(response) {
    return new Promise(function (resolve) { setTimeout(function () { resolve(response); }, 200); });
  }
})();
