/*
 * view-api.js — a pretend "backend for frontend": a small server that sits
 * between the pages and the RealWorld API, and answers with page-shaped views.
 *
 * In real life this would run on your server (or an edge function). Here it
 * runs in the browser, like the other mocks, by answering fetch() calls to /view/.
 *
 *   browser (jsonx)  --/view/home-->  this file  --/api/articles-->  RealWorld API
 *
 * Every GET answers with everything one page shows, ready to draw: dates already
 * written out, "is this mine?" already decided, buttons already labelled. Every
 * action (favourite, follow, comment...) answers with the same view again, so
 * the page just redraws. That's jsonx's idea, and why the pages need no script.
 *
 * It also keeps the sign-in token itself, the way a real BFF keeps it in a
 * server-side session behind a cookie, so the browser never handles it.
 */
(function () {
  "use strict";

  var SESSION = "conduit-session"; // stands in for the server's session store
  var PAGE_SIZE = 10;

  // --- Talking to the RealWorld API -----------------------------------------

  var apiFetch = window.fetch; // mock-api.js's fetch: load it before this file

  function api(method, path, body) {
    var token = sessionToken();
    var headers = { "Content-Type": "application/json" };
    if (token) headers.Authorization = "Token " + token;
    return apiFetch("/api" + path, { method: method, headers: headers, body: body ? JSON.stringify(body) : undefined })
      .then(function (response) {
        return (response.status === 204 ? Promise.resolve(null) : response.json()).then(function (data) {
          if (!response.ok) {
            var problem = new Error("RealWorld said " + response.status);
            problem.status = response.status;
            problem.data = data;
            throw problem;
          }
          return data;
        });
      });
  }
  function sessionToken() { try { return localStorage.getItem(SESSION); } catch (e) { return null; } }
  function setSession(token) { if (token) localStorage.setItem(SESSION, token); else localStorage.removeItem(SESSION); }

  // Who's signed in, or null.
  function currentUser() {
    if (!sessionToken()) return Promise.resolve(null);
    return api("GET", "/user").then(function (d) { return d.user; }, function () { setSession(null); return null; });
  }

  // --- Turning RealWorld's things into what the pages show -------------------

  function date(iso) {
    return new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  }
  function person(p, me) {
    return {
      username: p.username, bio: p.bio, image: p.image,
      initial: p.username.slice(0, 1).toUpperCase(),
      url: "profile.html?username=" + encodeURIComponent(p.username),
      mine: !!me && me.username === p.username,
      following: p.following,
      followLabel: (p.following ? "Unfollow " : "Follow ") + p.username,
      followAppearance: p.following ? "filled" : "outlined"
    };
  }
  // `base` is the view the preview is on, for its favourite button.
  function preview(a, me, base) {
    return {
      favoriteUrl: base + "/articles/" + encodeURIComponent(a.slug) + "/favorite",
      slug: a.slug, title: a.title, description: a.description, tagList: a.tagList,
      url: "article.html?slug=" + encodeURIComponent(a.slug),
      date: date(a.createdAt),
      author: person(a.author, me),
      favoritesCount: a.favoritesCount,
      favorited: a.favorited,
      favoriteAppearance: a.favorited ? "filled" : "outlined"
    };
  }
  function fullArticle(a, me) {
    var view = preview(a, me, "/view/article/" + encodeURIComponent(a.slug));
    view.mine = view.author.mine;
    view.favoriteLabel = (a.favorited ? "Unfavorite" : "Favorite") + " (" + a.favoritesCount + ")";
    view.editUrl = "editor.html?slug=" + encodeURIComponent(a.slug);
    view.body = a.body; // HTML: the page draws it with jx:html, cleaned
    return view;
  }
  function pageButtons(count, page) {
    var total = Math.ceil(count / PAGE_SIZE);
    if (total < 2) return [];
    var list = [];
    for (var i = 1; i <= total; i++) list.push({ number: i, current: i === page });
    return list;
  }
  function toggle(on, path) { return api(on ? "DELETE" : "POST", path); }

  // --- The views ---------------------------------------------------------------

  // The home page: tabs, a page of articles, page buttons, popular tags.
  // `values` is what the page sent: its hidden tab, tag and page fields.
  function home(values) {
    return currentUser().then(function (me) {
      var tag = values.tag || "";
      var tab = tag ? "tag" : (values.tab === "feed" && me ? "feed" : (values.tab === "global" || !me ? "global" : "feed"));
      var page = Number(values.page) || 1;
      var query = "?limit=" + PAGE_SIZE + "&offset=" + (page - 1) * PAGE_SIZE + (tab === "tag" ? "&tag=" + encodeURIComponent(tag) : "");
      return Promise.all([api("GET", (tab === "feed" ? "/articles/feed" : "/articles") + query), api("GET", "/tags")]).then(function (r) {
        var tabs = [];
        if (me) tabs.push({ name: "feed", tag: "", label: "Your feed", active: tab === "feed" });
        tabs.push({ name: "global", tag: "", label: "Global feed", active: tab === "global" });
        if (tag) tabs.push({ name: "tag", tag: tag, label: "# " + tag, active: true });
        return {
          tab: tab, tag: tag, page: page, tabs: tabs,
          articles: r[0].articles.map(function (a) { return preview(a, me, "/view/home"); }),
          pages: pageButtons(r[0].articlesCount, page),
          tags: r[1].tags
        };
      });
    });
  }

  function articlePage(slug) {
    return currentUser().then(function (me) {
      return Promise.all([api("GET", "/articles/" + slug), api("GET", "/articles/" + slug + "/comments")]).then(function (r) {
        return {
          signedIn: !!me,
          article: fullArticle(r[0].article, me),
          comments: r[1].comments.map(function (c) {
            return { id: c.id, body: c.body, date: date(c.createdAt), author: person(c.author, me), mine: !!me && c.author.username === me.username };
          }),
          draft: "" // the comment box: empty again after every change
        };
      });
    });
  }

  function profilePage(username, values) {
    return currentUser().then(function (me) {
      var tab = values.tab === "favorited" ? "favorited" : "articles";
      var page = Number(values.page) || 1;
      var query = "?limit=" + PAGE_SIZE + "&offset=" + (page - 1) * PAGE_SIZE +
        (tab === "favorited" ? "&favorited=" : "&author=") + encodeURIComponent(username);
      return Promise.all([api("GET", "/profiles/" + username), api("GET", "/articles" + query)]).then(function (r) {
        return {
          tab: tab, page: page,
          profile: person(r[0].profile, me),
          tabs: [
            { name: "articles", label: "My articles", active: tab === "articles" },
            { name: "favorited", label: "Favorited articles", active: tab === "favorited" }
          ],
          articles: r[1].articles.map(function (a) { return preview(a, me, "/view/profile/" + encodeURIComponent(username)); }),
          pages: pageButtons(r[1].articlesCount, page)
        };
      });
    });
  }

  // --- Routes: [method, path, handler(match, values)] -> view -------------------

  var routes = [
    ["GET", /^\/view\/nav$/, function () {
      return currentUser().then(function (me) {
        return { signedIn: !!me, username: me ? me.username : "", profileUrl: me ? "profile.html?username=" + encodeURIComponent(me.username) : "" };
      });
    }],

    ["GET", /^\/view\/home$/, function (m, v) { return home(v); }],
    ["POST", /^\/view\/home\/articles\/([^/]+)\/favorite$/, function (m, v) {
      return api("GET", "/articles/" + m[1]).then(function (d) { return toggle(d.article.favorited, "/articles/" + m[1] + "/favorite"); })
        .then(function () { return home(v); });
    }],

    ["GET", /^\/view\/article\/([^/]+)$/, function (m) { return articlePage(m[1]); }],
    ["POST", /^\/view\/article\/([^/]+)\/favorite$/, function (m) {
      return api("GET", "/articles/" + m[1]).then(function (d) { return toggle(d.article.favorited, "/articles/" + m[1] + "/favorite"); })
        .then(function () { return articlePage(m[1]); });
    }],
    ["POST", /^\/view\/article\/([^/]+)\/follow$/, function (m) {
      return api("GET", "/articles/" + m[1]).then(function (d) {
        return toggle(d.article.author.following, "/profiles/" + encodeURIComponent(d.article.author.username) + "/follow");
      }).then(function () { return articlePage(m[1]); });
    }],
    ["POST", /^\/view\/article\/([^/]+)\/comments$/, function (m, v) {
      return api("POST", "/articles/" + m[1] + "/comments", { comment: { body: v.comment || "" } })
        .then(function () { return articlePage(m[1]); });
    }],
    ["DELETE", /^\/view\/article\/([^/]+)\/comments\/(\d+)$/, function (m) {
      return api("DELETE", "/articles/" + m[1] + "/comments/" + m[2]).then(function () { return articlePage(m[1]); });
    }],
    ["DELETE", /^\/view\/article\/([^/]+)$/, function (m) {
      return api("DELETE", "/articles/" + m[1]).then(function () { return {}; });
    }],

    ["GET", /^\/view\/profile\/([^/]+)$/, function (m, v) { return profilePage(m[1], v); }],
    ["POST", /^\/view\/profile\/([^/]+)\/follow$/, function (m, v) {
      return api("GET", "/profiles/" + m[1]).then(function (d) { return toggle(d.profile.following, "/profiles/" + m[1] + "/follow"); })
        .then(function () { return profilePage(m[1], v); });
    }],
    ["POST", /^\/view\/profile\/([^/]+)\/articles\/([^/]+)\/favorite$/, function (m, v) {
      return api("GET", "/articles/" + m[2]).then(function (d) { return toggle(d.article.favorited, "/articles/" + m[2] + "/favorite"); })
        .then(function () { return profilePage(m[1], v); });
    }],

    // The editor: an empty form, or the article to change.
    ["GET", /^\/view\/editor$/, function (m, v) {
      return currentUser().then(function (me) {
        if (!me) return { signedIn: false };
        if (!v.slug) return { signedIn: true, isNew: true, article: { title: "", description: "", body: "", tags: "" } };
        return api("GET", "/articles/" + encodeURIComponent(v.slug)).then(function (d) {
          var a = d.article;
          return { signedIn: true, isNew: false, article: { slug: a.slug, title: a.title, description: a.description, body: a.body, tags: a.tagList.join(", ") } };
        });
      });
    }],
    ["POST", /^\/view\/editor$/, function (m, v) {
      var article = {
        title: v.title || "", description: v.description || "", body: v.body || "",
        tagList: (v.tags || "").split(",").map(function (t) { return t.trim(); }).filter(Boolean)
      };
      return (v.slug ? api("PUT", "/articles/" + encodeURIComponent(v.slug), { article: article }) : api("POST", "/articles", { article: article }))
        .then(function (d) { return { article: { slug: d.article.slug } }; });
    }],

    ["GET", /^\/view\/settings$/, function () {
      return currentUser().then(function (me) {
        return me ? { signedIn: true, user: { image: me.image || "", username: me.username, bio: me.bio || "", email: me.email } } : { signedIn: false };
      });
    }],
    ["PUT", /^\/view\/settings$/, function (m, v) {
      var user = { image: v.image || null, username: v.username, bio: v.bio || null, email: v.email };
      if (v.password) user.password = v.password;
      return api("PUT", "/user", { user: user }).then(function (d) {
        setSession(d.user.token);
        return { user: { username: d.user.username } };
      });
    }],

    ["POST", /^\/view\/login$/, function (m, v) {
      return api("POST", "/users/login", { user: { email: v.email || "", password: v.password || "" } }).then(function (d) {
        setSession(d.user.token);
        return { user: { username: d.user.username } };
      });
    }],
    ["POST", /^\/view\/register$/, function (m, v) {
      return api("POST", "/users", { user: { username: v.username || "", email: v.email || "", password: v.password || "" } }).then(function (d) {
        setSession(d.user.token);
        return { user: { username: d.user.username } };
      });
    }],
    ["POST", /^\/view\/logout$/, function () { setSession(null); return {}; }],
    ["POST", /^\/view\/reset$/, function () { setSession(null); window.resetConduitData(); return {}; }]
  ];

  // --- Answering fetch() --------------------------------------------------------

  window.fetch = function (input, options) {
    options = options || {};
    var url = new URL(typeof input === "string" ? input : input.url, location.href);
    var at = url.pathname.indexOf("/view/");
    if (at === -1) return apiFetch(input, options);

    var path = url.pathname.slice(at);
    var method = (options.method || "GET").toUpperCase();
    var values = Object.fromEntries(url.searchParams);
    if (options.body) Object.assign(values, JSON.parse(options.body));

    for (var i = 0; i < routes.length; i++) {
      var match = routes[i][0] === method && path.match(routes[i][1]);
      if (!match) continue;
      return Promise.resolve(routes[i][2](match, values)).then(function (view) {
        return json(200, view);
      }, function (problem) {
        // RealWorld's own errors pass straight through: jsonx shows
        // { errors: { title: ["can't be blank"] } } in the page by itself.
        if (problem.status === 401 && problem.data.errors.token) return json(401, { error: "Please sign in first." });
        if (problem.status) return json(problem.status, problem.data);
        throw problem;
      });
    }
    return Promise.resolve(json(404, { error: "No view for " + method + " " + path }));
  };

  function json(status, data) {
    return new Response(JSON.stringify(data), { status: status, headers: { "Content-Type": "application/json" } });
  }
})();
