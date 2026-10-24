/*
 * cms-api.js — a pretend headless CMS, shaped like Contentful's Content Delivery API.
 *
 *   GET /cms/spaces/beacon/environments/master/entries?content_type=page&fields.slug=home&include=3
 *
 * answers like Contentful does:
 *
 *   { sys: { type: "Array" }, total, skip, limit,
 *     items:    [ { sys: { id, contentType }, fields: { ... } } ],
 *     includes: { Entry: [ ...every entry the items link to... ] } }
 *
 * Fields that point at other entries are links, { sys: { type: "Link", linkType: "Entry", id } },
 * and long text is Contentful "rich text": a JSON tree of nodes, not HTML.
 * Editors build a page by stacking section entries (hero, features, pricing...).
 *
 * The content is written below. A real site would fetch it from cdn.contentful.com.
 */
(function () {
  "use strict";

  // --- Helpers for writing content --------------------------------------------

  var entries = {};
  function entry(id, type, fields, date) {
    entries[id] = { sys: { id: id, type: "Entry", createdAt: date || "2026-09-01T09:00:00Z", contentType: { sys: { type: "Link", linkType: "ContentType", id: type } } }, fields: fields };
    return link(id);
  }
  function link(id) { return { sys: { type: "Link", linkType: "Entry", id: id } }; }

  // Rich text, the way Contentful stores it.
  function text(value, marks) { return { nodeType: "text", value: value, marks: (marks || []).map(function (m) { return { type: m }; }), data: {} }; }
  function bold(value) { return text(value, ["bold"]); }
  function hyperlink(uri, value) { return { nodeType: "hyperlink", data: { uri: uri }, content: [text(value)] }; }
  function p() { return { nodeType: "paragraph", data: {}, content: Array.from(arguments).map(function (c) { return typeof c === "string" ? text(c) : c; }) }; }
  function h2(value) { return { nodeType: "heading-2", data: {}, content: [text(value)] }; }
  function ul() {
    return { nodeType: "unordered-list", data: {}, content: Array.from(arguments).map(function (item) {
      return { nodeType: "list-item", data: {}, content: [p(item)] };
    }) };
  }
  function doc() { return { nodeType: "document", data: {}, content: Array.from(arguments) }; }

  // --- The content --------------------------------------------------------------

  entry("nav", "navigation", {
    brand: "Beacon",
    links: [
      entry("nav-features", "link", { label: "Features", url: "index.html#features" }),
      entry("nav-pricing", "link", { label: "Pricing", url: "index.html?page=pricing" }),
      entry("nav-blog", "link", { label: "Blog", url: "index.html?page=blog" })
    ],
    cta: entry("nav-cta", "link", { label: "Start free", url: "index.html?page=pricing" })
  });

  var startFree = entry("cta-start", "link", { label: "Start free", url: "index.html?page=pricing" });
  var seeDemo = entry("cta-demo", "link", { label: "Read the blog", url: "index.html?page=blog" });

  entry("home", "page", {
    title: "Beacon: status pages your customers actually read",
    slug: "home",
    sections: [
      entry("home-hero", "hero", {
        badge: "New: incident timelines",
        heading: "Tell customers what's happening, before they ask",
        subheading: "Beacon gives your team a beautiful status page, automatic uptime checks and incident updates in one place. Set up in five minutes.",
        primaryCta: startFree,
        secondaryCta: seeDemo
      }),
      entry("home-logos", "logoStrip", { heading: "Trusted by small teams who care", logos: ["Northwind", "Acme Co", "Globex", "Initech", "Umbrella", "Hooli"] }),
      entry("home-features", "featureGrid", {
        anchor: "features",
        heading: "Everything you need when things go wrong",
        intro: "And nothing you don't. Beacon does three things, and does them well.",
        features: [
          entry("f-checks", "feature", { icon: "heart-pulse", title: "Uptime checks", body: "We check your sites every 30 seconds from five regions, and open an incident the moment something fails." }),
          entry("f-page", "feature", { icon: "signal", title: "A status page in minutes", body: "Your logo, your colours, your domain. Customers subscribe by email and get updates as you post them." }),
          entry("f-updates", "feature", { icon: "comments", title: "Updates in one click", body: "Post an update from Slack or your phone. Beacon sends it to the page, to subscribers and to your team." }),
          entry("f-history", "feature", { icon: "chart-line", title: "Honest history", body: "Ninety days of uptime, every incident and every update, so customers can see your track record." }),
          entry("f-teams", "feature", { icon: "users", title: "Made for small teams", body: "On-call rotations without the enterprise price tag. Add your whole team on every plan." }),
          entry("f-api", "feature", { icon: "code", title: "An API for everything", body: "Open incidents from your deploy pipeline, or pull your uptime into your own dashboards." })
        ]
      }),
      entry("home-quote", "testimonial", { quote: "We used to answer the same support ticket fifty times during an outage. Now we post once in Beacon, and the tickets stop.", name: "Priya Raman", role: "Head of Support", company: "Northwind" }),
      entry("home-faq", "faq", {
        heading: "Questions, answered",
        questions: [
          entry("q-trial", "question", { question: "Is there a free plan?", answer: doc(p("Yes. The ", bold("Starter"), " plan is free forever for one status page and five checks. No card needed.")) }),
          entry("q-domain", "question", { question: "Can I use my own domain?", answer: doc(p("On the Team and Business plans, yes: point ", bold("status.yourcompany.com"), " at us and we handle the certificate.")) }),
          entry("q-migrate", "question", { question: "Can I move from another status page tool?", answer: doc(p("We import from the popular tools in a couple of clicks, including your incident history. ", hyperlink("index.html?page=blog", "Read how on our blog."))) })
        ]
      }),
      entry("home-signup", "signup", { heading: "Get the monthly reliability letter", body: "One email a month with what we learned from running status pages for 4,000 teams. No spam." }),
      entry("home-cta", "callToAction", { heading: "Your next outage is coming. Be ready.", body: "Start free in five minutes. Upgrade when you need to.", button: startFree })
    ]
  });

  entry("pricing", "page", {
    title: "Pricing — Beacon",
    slug: "pricing",
    sections: [
      entry("pricing-hero", "hero", { badge: "Simple pricing", heading: "One price per team, not per seat", subheading: "Every plan includes unlimited team members and email subscribers." }),
      entry("pricing-plans", "pricing", {
        heading: "Pick a plan",
        plans: [
          entry("plan-starter", "plan", { name: "Starter", price: "$0", period: "forever", description: "For side projects and trying Beacon out.", features: ["1 status page", "5 uptime checks", "Email updates"], cta: entry("plan-starter-cta", "link", { label: "Start free", url: "#signup" }), highlighted: false }),
          entry("plan-team", "plan", { name: "Team", price: "$29", period: "per month", description: "For growing teams with real customers.", features: ["3 status pages", "50 uptime checks", "Your own domain", "Slack updates"], cta: entry("plan-team-cta", "link", { label: "Try Team free for 14 days", url: "#signup" }), highlighted: true }),
          entry("plan-business", "plan", { name: "Business", price: "$99", period: "per month", description: "For companies where uptime is the product.", features: ["Unlimited status pages", "500 uptime checks", "On-call rotations", "SSO and audit log"], cta: entry("plan-business-cta", "link", { label: "Talk to us", url: "#signup" }), highlighted: false })
        ]
      }),
      link("home-faq"),
      entry("pricing-signup", "signup", { heading: "Not ready yet?", body: "Leave your email and we'll send you one useful letter a month." })
    ]
  });

  entry("blog", "page", {
    title: "Blog — Beacon",
    slug: "blog",
    sections: [
      entry("blog-hero", "hero", { heading: "The Beacon blog", subheading: "Notes on reliability, incidents and talking to customers when things break." }),
      entry("blog-list", "postList", { heading: "Latest posts" })
    ]
  });

  entry("post-first-hour", "blogPost", {
    title: "The first hour of an outage",
    slug: "the-first-hour-of-an-outage",
    date: "2026-10-14",
    author: "Priya Raman",
    excerpt: "What to say, when to say it, and why silence costs you more than the outage.",
    tags: ["incidents", "support"],
    body: doc(
      p("The first hour of an outage decides how customers remember it. Not the fix: the ", bold("silence"), " before it."),
      h2("Post early, even if you know nothing"),
      p("“We're looking into it” is worth posting. It tells customers it isn't them, and it stops the tickets."),
      h2("A simple rhythm"),
      ul("Within 5 minutes: acknowledge.", "Every 30 minutes: an update, even if nothing changed.", "When it's fixed: say so, and say what's next."),
      p("Beacon reminds you when an update is due. ", hyperlink("index.html?page=pricing", "See the plans."))
    )
  }, "2026-10-14T09:00:00Z");
  entry("post-checks", "blogPost", {
    title: "Why we check from five regions",
    slug: "why-we-check-from-five-regions",
    date: "2026-09-30",
    author: "Tom Okafor",
    excerpt: "One failed check is a blip. Three regions agreeing is an outage.",
    tags: ["engineering"],
    body: doc(
      p("Networks are noisy. A single check from a single place fails for all sorts of reasons that have nothing to do with your site."),
      p("So Beacon only opens an incident when ", bold("three of five regions"), " agree. You get fewer false alarms, and your customers never see one.")
    )
  }, "2026-09-30T09:00:00Z");
  entry("post-migrate", "blogPost", {
    title: "Moving your status page in ten minutes",
    slug: "moving-your-status-page-in-ten-minutes",
    date: "2026-09-12",
    author: "Priya Raman",
    excerpt: "Bring your incident history with you. Here's how the import works.",
    tags: ["guides"],
    body: doc(
      p("Paste your old status page's address, and Beacon reads its incident history, components and subscribers."),
      ul("Incidents keep their dates and updates.", "Subscribers get one email explaining the move.", "Your old address can redirect to the new one."),
      p("That's it. Most teams are done before their coffee is.")
    )
  }, "2026-09-12T09:00:00Z");

  // --- Answering queries, the Contentful way -------------------------------------

  // Everything an entry links to, and what those link to, up to `depth` levels.
  function collectIncludes(items, depth) {
    var found = {};
    function walk(value, level) {
      if (!value || typeof value !== "object" || level > depth) return;
      if (value.sys && value.sys.type === "Link" && value.sys.linkType === "Entry") {
        var target = entries[value.sys.id];
        if (target && !found[target.sys.id]) { found[target.sys.id] = target; walk(target.fields, level + 1); }
        return;
      }
      Object.keys(value).forEach(function (k) { walk(value[k], level); });
    }
    items.forEach(function (item) { walk(item.fields, 1); });
    return Object.keys(found).map(function (id) { return found[id]; });
  }

  function query(params) {
    var list = Object.keys(entries).map(function (id) { return entries[id]; });
    params.forEach(function (value, key) {
      if (key === "content_type") list = list.filter(function (e) { return e.sys.contentType.sys.id === value; });
      var field = key.match(/^fields\.(\w+)$/);
      if (field) list = list.filter(function (e) { return String(e.fields[field[1]]) === value; });
    });
    var order = params.get("order");
    if (order) {
      var desc = order[0] === "-";
      var name = order.replace(/^-/, "").replace(/^fields\./, "");
      list.sort(function (a, b) { var x = a.fields[name], y = b.fields[name]; return (x < y ? -1 : x > y ? 1 : 0) * (desc ? -1 : 1); });
    }
    var skip = Number(params.get("skip")) || 0;
    var limit = Number(params.get("limit")) || 100;
    var items = list.slice(skip, skip + limit);
    var include = params.has("include") ? Number(params.get("include")) : 1;
    return { sys: { type: "Array" }, total: list.length, skip: skip, limit: limit, items: items, includes: { Entry: collectIncludes(items, include) } };
  }

  var realFetch = window.fetch.bind(window);
  window.fetch = function (input, options) {
    var url = new URL(typeof input === "string" ? input : input.url, location.href);
    if (!/\/cms\/spaces\/beacon\/environments\/master\/entries$/.test(url.pathname)) return realFetch(input, options);
    var body = JSON.stringify(query(url.searchParams));
    return new Promise(function (resolve) {
      setTimeout(function () { resolve(new Response(body, { status: 200, headers: { "Content-Type": "application/json" } })); }, 80);
    });
  };
})();
