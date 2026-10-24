/*
 * view-api.js — a pretend backend-for-frontend in front of the CMS.
 *
 *   browser (jsonx)  --GET /view/page?slug=pricing-->  this file  --entries?...-->  CMS
 *
 * The CMS answers in its own shape: entries, links between them, and rich text
 * as a JSON tree. This file turns that into what the page draws: the navigation,
 * then a list of sections, each ready for its template. In real life it would
 * run on your server, and cache the CMS's answers.
 *
 * One rule makes the templates simple: every section names every kind,
 *   { hero: {...}, features: null, pricing: null, ... }
 * so the page can write <jx-each items="hero"> and only the right one draws.
 * (A missing name would be looked up in the outer view instead, so we set them all.)
 */
(function () {
  "use strict";

  var CMS = "/cms/spaces/beacon/environments/master/entries";
  var SECTION_KINDS = ["hero", "logos", "features", "testimonial", "faq", "pricing", "signup", "cta", "posts", "article"];
  var BLOCK_KINDS = ["h2", "p", "ul"];

  var cmsFetch = window.fetch; // cms-api.js's fetch: load it before this file

  function cms(params) {
    return cmsFetch(CMS + "?" + new URLSearchParams(params)).then(function (r) { return r.json(); });
  }

  // Swap every link for the entry it points to, using the answer's includes.
  function resolver(answer) {
    var byId = {};
    answer.items.concat(answer.includes.Entry).forEach(function (e) { byId[e.sys.id] = e; });
    function resolve(value) {
      if (Array.isArray(value)) return value.map(resolve).filter(Boolean);
      if (value && value.sys && value.sys.type === "Link") return byId[value.sys.id] ? resolve(byId[value.sys.id]) : null;
      if (value && value.sys && value.fields) {
        var fields = { id: value.sys.id, type: value.sys.contentType.sys.id };
        Object.keys(value.fields).forEach(function (k) {
          var field = value.fields[k];
          fields[k] = field && field.nodeType === "document" ? field : resolve(field);
        });
        return fields;
      }
      return value;
    }
    return resolve;
  }

  // --- Rich text -> blocks the template can draw (never HTML) -------------------

  function kindOf(kinds, kind, value) {
    var object = {};
    kinds.forEach(function (k) { object[k] = null; });
    object[kind] = value;
    return object;
  }
  function parts(nodes) {
    var list = [];
    nodes.forEach(function (node) {
      if (node.nodeType === "text") {
        var marks = node.marks.map(function (m) { return m.type; });
        list.push({ text: node.value, bold: marks.indexOf("bold") !== -1, italic: marks.indexOf("italic") !== -1, href: null });
      } else if (node.nodeType === "hyperlink") {
        parts(node.content).forEach(function (part) { part.href = node.data.uri; list.push(part); });
      }
    });
    return list;
  }
  function blocks(documentNode) {
    if (!documentNode) return [];
    return documentNode.content.map(function (node) {
      if (node.nodeType === "heading-2") return kindOf(BLOCK_KINDS, "h2", { text: parts(node.content).map(function (x) { return x.text; }).join("") });
      if (node.nodeType === "unordered-list") return kindOf(BLOCK_KINDS, "ul", { items: node.content.map(function (li) { return { parts: parts(li.content[0].content) }; }) });
      return kindOf(BLOCK_KINDS, "p", { parts: parts(node.content) });
    });
  }

  // --- Entries -> sections ---------------------------------------------------------

  function linkView(l) { return l ? { label: l.label, url: l.url } : null; }
  function date(iso) { return new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }); }
  function postPreview(post) {
    return { title: post.title, url: "index.html?post=" + encodeURIComponent(post.slug), date: date(post.date), author: post.author, excerpt: post.excerpt, tags: post.tags };
  }

  function section(entry, posts) {
    switch (entry.type) {
      case "hero":
        return ["hero", { badge: entry.badge || null, heading: entry.heading, subheading: entry.subheading, primary: linkView(entry.primaryCta), secondary: linkView(entry.secondaryCta) }];
      case "logoStrip":
        return ["logos", { heading: entry.heading, names: entry.logos }];
      case "featureGrid":
        return ["features", { anchor: entry.anchor || "", heading: entry.heading, intro: entry.intro, items: entry.features.map(function (f) { return { icon: f.icon, title: f.title, body: f.body }; }) }];
      case "testimonial":
        return ["testimonial", { quote: entry.quote, name: entry.name, role: entry.role + ", " + entry.company, initials: entry.name.split(" ").map(function (w) { return w[0]; }).join("") }];
      case "faq":
        return ["faq", { heading: entry.heading, questions: entry.questions.map(function (q) { return { question: q.question, blocks: blocks(q.answer) }; }) }];
      case "pricing":
        return ["pricing", { heading: entry.heading, plans: entry.plans.map(function (plan) {
          return {
            name: plan.name, price: plan.price, period: plan.period, description: plan.description, features: plan.features,
            cta: linkView(plan.cta), highlighted: plan.highlighted,
            buttonVariant: plan.highlighted ? "brand" : "neutral", buttonAppearance: plan.highlighted ? "accent" : "outlined"
          };
        }) }];
      case "signup":
        return ["signup", { heading: entry.heading, body: entry.body }];
      case "callToAction":
        return ["cta", { heading: entry.heading, body: entry.body, button: linkView(entry.button) }];
      case "postList":
        return ["posts", { heading: entry.heading, items: posts.map(postPreview) }];
    }
    return null;
  }

  function sections(list) {
    return list.filter(Boolean).map(function (pair, i) {
      var s = kindOf(SECTION_KINDS, pair[0], pair[1]);
      s.id = i; // so each section is tracked by its place
      return s;
    });
  }

  function navigation() {
    return cms({ content_type: "navigation", include: 2 }).then(function (answer) {
      var nav = resolver(answer)(answer.items[0]);
      return { brand: nav.brand, links: nav.links.map(linkView), cta: linkView(nav.cta) };
    });
  }

  function allPosts() {
    return cms({ content_type: "blogPost", order: "-fields.date", include: 0 }).then(function (answer) {
      return answer.items.map(resolver(answer));
    });
  }

  // GET /view/page?slug=pricing (or ?post=a-blog-post): everything one page shows.
  function page(values) {
    if (values.post) return postPage(values.post);
    var slug = values.slug || "home";
    return Promise.all([navigation(), cms({ content_type: "page", "fields.slug": slug, include: 3 }), allPosts()]).then(function (r) {
      var answer = r[1];
      if (!answer.items.length) return notFound(r[0]);
      var entry = resolver(answer)(answer.items[0]);
      return { nav: r[0], title: entry.title, sections: sections(entry.sections.map(function (e) { return section(e, r[2]); })) };
    });
  }

  function postPage(slug) {
    return Promise.all([navigation(), cms({ content_type: "blogPost", "fields.slug": slug }), cms({ content_type: "signup", include: 0 })]).then(function (r) {
      if (!r[1].items.length) return notFound(r[0]);
      var post = resolver(r[1])(r[1].items[0]);
      var signup = resolver(r[2])(r[2].items[0]);
      return {
        nav: r[0], title: post.title,
        sections: sections([
          ["article", { title: post.title, date: date(post.date), author: post.author, tags: post.tags, blocks: blocks(post.body) }],
          section(signup)
        ])
      };
    });
  }

  function notFound(nav) {
    return { nav: nav, title: "Not found", sections: sections([["hero", { badge: "404", heading: "We couldn't find that page", subheading: "It may have moved.", primary: { label: "Go home", url: "index.html" }, secondary: null }]]) };
  }

  // POST /view/signup: the newsletter form. Its answer is just the form's own view.
  function signup(values) {
    var email = (values.email || "").trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return [422, { errors: { email: [email ? "doesn't look like an email address" : "can't be blank"] } }];
    }
    return { done: true, message: "Thanks! The next letter goes to " + email + "." };
  }

  // --- Answering fetch() ------------------------------------------------------------

  window.fetch = function (input, options) {
    options = options || {};
    var url = new URL(typeof input === "string" ? input : input.url, location.href);
    var at = url.pathname.indexOf("/view/");
    if (at === -1) return cmsFetch(input, options);

    var path = url.pathname.slice(at);
    var method = (options.method || "GET").toUpperCase();
    var values = Object.fromEntries(url.searchParams);
    if (options.body) Object.assign(values, JSON.parse(options.body));

    var result;
    if (method === "GET" && path === "/view/page") result = page(values);
    else if (method === "POST" && path === "/view/signup") result = signup(values);
    else result = [404, { error: "No view for " + method + " " + path }];

    return Promise.resolve(result).then(function (view) {
      var status = Array.isArray(view) ? view[0] : 200;
      return new Response(JSON.stringify(Array.isArray(view) ? view[1] : view), { status: status, headers: { "Content-Type": "application/json" } });
    });
  };
})();
