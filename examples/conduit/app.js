/*
 * app.js — the little bit of page code Conduit needs, shared by every page.
 *
 * Load it with `defer`, before jsonx.js: it runs first, once the page is parsed.
 *
 * The RealWorld API is shaped around things, not pages, so this file adapts it:
 *   1. it sends the sign-in token with every request
 *   2. it fills :slug-style placeholders in jx-get URLs from the page address
 *   3. it adds what templates can't work out themselves (dates, "is this mine?",
 *      which tab is selected, page numbers) just before each render
 *   4. it saves the token after signing in, and moves to another page after
 *      some actions (data-then="article" and friends)
 */
(function () {
  "use strict";

  var params = Object.fromEntries(new URLSearchParams(location.search));

  function me() {
    try { return JSON.parse(localStorage.getItem("conduitUser")); } catch (e) { return null; }
  }
  function signOut() {
    localStorage.removeItem("jwtToken");
    localStorage.removeItem("conduitUser");
  }

  // Pages like the editor are only for signed-in people.
  if (document.body.hasAttribute("data-needs-sign-in") && !me()) location.replace("login.html");

  // 1. The token goes on every request, as the spec asks: "Authorization: Token <jwt>".
  window.jsonx = {
    headers: function () {
      var token = localStorage.getItem("jwtToken");
      return token ? { Authorization: "Token " + token } : {};
    }
  };

  // 2. jx-get="/api/articles/:slug" on article.html?slug=hello becomes /api/articles/hello.
  //    If the address has no slug (a new article in the editor), the element
  //    becomes a jx-region instead: it draws its template with an empty view.
  ["jx-get", "jx-post", "jx-put", "jx-delete"].forEach(function (attribute) {
    document.querySelectorAll("[" + attribute + "]").forEach(function (el) {
      var missing = false;
      var url = el.getAttribute(attribute).replace(/:(\w+)/g, function (all, name) {
        if (!params[name]) missing = true;
        return encodeURIComponent(params[name] || "");
      });
      if (missing) {
        el.removeAttribute(attribute);
        el.setAttribute("jx-region", "");
      } else {
        el.setAttribute(attribute, url);
      }
    });
  });

  // The home feed starts on "Your feed" when you're signed in.
  var feed = document.querySelector("#feed[data-home]");
  if (feed && me()) feed.setAttribute("jx-get", "/api/articles/feed?limit=10");

  // The editor sends tags as a list: "a, b" becomes ["a", "b"].
  document.addEventListener("jx:beforeRequest", function (event) {
    var options = event.detail.options;
    if (!options.body) return;
    var body = JSON.parse(options.body);
    if (body.article && typeof body.article.tagList === "string") {
      body.article.tagList = body.article.tagList.split(",").map(function (t) { return t.trim(); }).filter(Boolean);
      options.body = JSON.stringify(body);
    }
  });

  // 3. Just before each render, add what the templates need.
  document.addEventListener("jx:beforeRender", function (event) {
    var data = Object.assign({}, event.detail.data);
    var user = me();
    data.me = user;
    data.params = params;

    if (data.article) data.article = article(data.article, user);
    if (data.articles) data.articles = data.articles.map(function (a) { return article(a, user); });
    if (data.comments) data.comments = data.comments.map(function (c) { return mine(dated(c), user); });
    if (data.profile) data.profile = profile(data.profile, user);

    // Which tab is selected, and the page buttons, come from the address the list came from.
    var url = event.detail.url || event.detail.target.__jxUrl;
    if (data.articles && url) {
      var address = new URL(url, location.href);
      var query = address.searchParams;
      data.tab = {
        feed: /\/feed$/.test(address.pathname),
        tag: query.get("tag"),
        favorited: !!query.get("favorited"),
        author: !!query.get("author")
      };
      data.tab.global = !data.tab.feed && !data.tab.tag;
      data.pages = pages(address, data.articlesCount);
    }
    event.detail.data = data;
  });

  function dated(thing) {
    var copy = Object.assign({}, thing);
    copy.date = new Date(thing.createdAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
    return copy;
  }
  function profile(p, user) {
    return Object.assign({}, p, { initial: p.username.slice(0, 1).toUpperCase(), mine: !!user && user.username === p.username });
  }
  function mine(thing, user) {
    thing.author = profile(thing.author, user);
    thing.mine = thing.author.mine;
    return thing;
  }
  function article(a, user) {
    a = mine(dated(a), user);
    a.tags = a.tagList.join(", ");
    // The body is Markdown. We show it as plain paragraphs: templates never
    // insert raw HTML, so an article can't inject anything into the page.
    if (a.body) a.paragraphs = a.body.split(/\n\s*\n/).map(function (text) { return { text: text }; });
    return a;
  }
  function pages(address, count) {
    var limit = Number(address.searchParams.get("limit")) || 20;
    var offset = Number(address.searchParams.get("offset")) || 0;
    var total = Math.ceil(count / limit);
    if (total < 2) return [];
    var list = [];
    for (var i = 0; i < total; i++) {
      var page = new URL(address);
      page.searchParams.set("offset", i * limit);
      list.push({ number: i + 1, url: page.pathname + page.search, current: i * limit === offset });
    }
    return list;
  }

  // 4. After a render: keep a fresh token, and move on if the button says so.
  document.addEventListener("jx:afterRender", function (event) {
    var data = event.detail.data || {};
    if (data.user && data.user.token) {
      localStorage.setItem("jwtToken", data.user.token);
      localStorage.setItem("conduitUser", JSON.stringify(data.user));
    }
    var then = event.detail.source.getAttribute && event.detail.source.getAttribute("data-then");
    if (then === "home") location.href = "index.html";
    if (then === "article") location.href = "article.html?slug=" + encodeURIComponent(data.article.slug);
    if (then === "profile") location.href = "profile.html?username=" + encodeURIComponent(data.user.username);
  });

  // A request the server turned down for want of a sign-in: forget the token and go sign in.
  document.addEventListener("jx:error", function (event) {
    if (event.detail.error.status !== 401) return;
    var onSignInPage = /(login|register)\.html$/.test(location.pathname);
    if (onSignInPage) return; // a wrong password: the form shows the error
    signOut();
    location.href = "login.html";
  });

  document.addEventListener("click", function (event) {
    if (event.target.closest("[data-sign-out]")) {
      signOut();
      location.href = "index.html";
    }
  });

  // The navigation bar, on every page: <conduit-nav></conduit-nav>.
  // A plain web component; it only needs to know who's signed in.
  customElements.define("conduit-nav", class extends HTMLElement {
    connectedCallback() {
      var user = me();
      var page = location.pathname.split("/").pop() || "index.html";
      var link = function (href, label, icon) {
        var current = page === href.split("?")[0] ? ' aria-current="page"' : "";
        return '<a href="' + href + '"' + current + ">" + (icon ? '<wa-icon name="' + icon + '"></wa-icon> ' : "") + label + "</a>";
      };
      var name = user ? user.username.replace(/[&<>"]/g, "") : "";
      this.innerHTML =
        '<nav class="wa-split">' +
          '<a class="brand" href="index.html">conduit</a>' +
          '<div class="wa-cluster wa-gap-l">' +
            link("index.html", "Home") +
            (user
              ? link("editor.html", "New article", "pen-to-square") +
                link("settings.html", "Settings", "gear") +
                link("profile.html?username=" + encodeURIComponent(name), name, "user")
              : link("login.html", "Sign in") + link("register.html", "Sign up")) +
          "</div>" +
        "</nav>";
    }
  });
})();
