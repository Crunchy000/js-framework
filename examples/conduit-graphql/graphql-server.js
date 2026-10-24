/*
 * graphql-server.js — a pretend GraphQL server for Conduit, running in the browser.
 *
 * It answers POST /graphql with the real graphql-js library, and gets its data from
 * the RealWorld REST mock (../conduit/mock-api.js), the way a GraphQL layer in
 * front of an existing API would. In real life this runs on a server.
 *
 * Unlike the view API in ../conduit, nothing here knows about pages. The schema is
 * about articles, profiles and comments, and each page asks for exactly what it
 * shows. The schema just has the fields clients usually want, the way GitHub's
 * has `viewerHasStarred`: viewerHasFavorited, viewerIsAuthor, createdAt(format: LONG).
 *
 * Every mutation's answer includes `query`, the whole Query type, so a page can
 * ask for its view again in the same round trip: favoriteArticle { query { ...HomeView } }.
 */
import { graphql, buildSchema, GraphQLError } from "./vendor/graphql-16.9.0.min.js";

var schema = buildSchema(`
  type Query {
    "Who's signed in, or null."
    viewer: User
    articles(scope: ArticleScope = GLOBAL, tag: String, offset: Int = 0, limit: Int = 10): ArticleList!
    "The article, or null if no slug is given."
    article(slug: String): Article
    profile(username: String!): Profile
    "Popular tags, most used first."
    tags: [String!]!
    "A tag by name, or null if no name is given."
    tag(name: String): Tag
  }

  "GLOBAL: everyone's articles. FEED: people you follow. TAG: one tag."
  enum ArticleScope { GLOBAL FEED TAG }
  enum ProfileArticles { WRITTEN FAVORITED }
  enum DateFormat { ISO LONG }

  type User { username: String! email: String! bio: String image: String }
  type Tag { name: String! }

  type Profile {
    username: String!
    bio: String
    image: String
    isViewer: Boolean!
    viewerIsFollowing: Boolean!
    articles(filter: ProfileArticles = WRITTEN, offset: Int = 0, limit: Int = 5): ArticleList!
  }

  type Article {
    slug: String!
    title: String!
    description: String!
    body: String
    "The body split at blank lines."
    paragraphs: [Paragraph!]!
    tagList: [String!]!
    "The tags as one string: \\"a, b\\"."
    tags: String!
    createdAt(format: DateFormat = ISO): String!
    favoritesCount: Int!
    viewerHasFavorited: Boolean!
    viewerIsAuthor: Boolean!
    author: Profile!
    comments: [Comment!]!
  }
  type Paragraph { text: String! }

  type Comment {
    id: ID!
    body: String!
    createdAt(format: DateFormat = ISO): String!
    author: Profile!
    viewerIsAuthor: Boolean!
  }

  type ArticleList {
    nodes: [Article!]!
    totalCount: Int!
    "The arguments the list was asked for, so a page can show them."
    offset: Int!
    scope: ArticleScope
    filter: ProfileArticles
    "Page buttons, if there's more than one page."
    pages: [PageLink!]!
  }
  type PageLink { number: Int! offset: Int! current: Boolean! }

  type Mutation {
    login(email: String, password: String): UserPayload!
    register(username: String, email: String, password: String): UserPayload!
    logout: Payload!
    updateSettings(image: String, username: String, bio: String, email: String, password: String): UserPayload!
    favoriteArticle(slug: String!): Payload!
    unfavoriteArticle(slug: String!): Payload!
    followProfile(username: String!): Payload!
    unfollowProfile(username: String!): Payload!
    createArticle(title: String, description: String, body: String, tags: String): ArticlePayload!
    updateArticle(slug: String!, title: String, description: String, body: String, tags: String): ArticlePayload!
    deleteArticle(slug: String!): Payload!
    addComment(slug: String!, body: String): Payload!
    deleteComment(slug: String!, id: ID!): Payload!
  }
  type Payload { query: Query! }
  type UserPayload { user: User! query: Query! }
  type ArticlePayload { article: Article! query: Query! }
`);

// --- The REST API underneath ------------------------------------------------------

var SESSION = "conduit-gql-session"; // stands in for a server-side session behind a cookie
var restFetch = window.fetch;        // mock-api.js's fetch: load it before this file

function session() { try { return localStorage.getItem(SESSION); } catch (e) { return null; } }
function setSession(token) { if (token) localStorage.setItem(SESSION, token); else localStorage.removeItem(SESSION); }

// Calls the RealWorld API. Its errors become GraphQL errors:
// { errors: { title: ["can't be blank"] } } -> a GraphQL error "title can't be blank".
function rest(method, path, body) {
  var headers = { "Content-Type": "application/json" };
  if (session()) headers.Authorization = "Token " + session();
  return restFetch("/api" + path, { method: method, headers: headers, body: body ? JSON.stringify(body) : undefined }).then(function (response) {
    return (response.status === 204 ? Promise.resolve(null) : response.json()).then(function (data) {
      if (response.ok) return data;
      if (response.status === 401 && data.errors && data.errors.token) throw new GraphQLError("Please sign in first.", { extensions: { code: "UNAUTHENTICATED" } });
      var fields = Object.keys((data && data.errors) || {});
      var message = fields.map(function (f) { return f + " " + [].concat(data.errors[f]).join(", "); }).join(", ");
      throw new GraphQLError(message || "Request failed", { extensions: { code: "BAD_USER_INPUT" } });
    });
  });
}

// --- Turning REST answers into GraphQL objects --------------------------------------

function formatDate(iso, format) {
  return format === "LONG" ? new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : iso;
}

function profile(p, ctx) {
  return {
    username: p.username, bio: p.bio, image: p.image,
    viewerIsFollowing: p.following,
    isViewer: function () { return ctx.viewer().then(function (v) { return !!v && v.username === p.username; }); },
    articles: function (args) {
      return list("/articles?" + (args.filter === "FAVORITED" ? "favorited=" : "author=") + encodeURIComponent(p.username), args, ctx);
    }
  };
}

function article(a, ctx) {
  return {
    slug: a.slug, title: a.title, description: a.description, body: a.body || null,
    tagList: a.tagList, tags: a.tagList.join(", "),
    favoritesCount: a.favoritesCount, viewerHasFavorited: a.favorited,
    createdAt: function (args) { return formatDate(a.createdAt, args.format); },
    author: profile(a.author, ctx),
    viewerIsAuthor: function () { return ctx.viewer().then(function (v) { return !!v && v.username === a.author.username; }); },
    paragraphs: function () {
      var body = a.body ? Promise.resolve(a.body) : rest("GET", "/articles/" + a.slug).then(function (d) { return d.article.body; });
      return body.then(function (text) { return text.split(/\n\s*\n/).map(function (t) { return { text: t }; }); });
    },
    comments: function () {
      return rest("GET", "/articles/" + a.slug + "/comments").then(function (d) {
        return d.comments.map(function (c) {
          return {
            id: c.id, body: c.body,
            createdAt: function (args) { return formatDate(c.createdAt, args.format); },
            author: profile(c.author, ctx),
            viewerIsAuthor: function () { return ctx.viewer().then(function (v) { return !!v && v.username === c.author.username; }); }
          };
        });
      });
    }
  };
}

function list(path, args, ctx) {
  var join = path.indexOf("?") === -1 ? "?" : "&";
  return rest("GET", path + join + "limit=" + args.limit + "&offset=" + args.offset).then(function (d) {
    var total = Math.ceil(d.articlesCount / args.limit);
    var pages = [];
    for (var i = 0; total > 1 && i < total; i++) pages.push({ number: i + 1, offset: i * args.limit, current: i * args.limit === args.offset });
    return {
      nodes: d.articles.map(function (a) { return article(a, ctx); }), totalCount: d.articlesCount, pages: pages,
      offset: args.offset, scope: args.scope || null, filter: args.filter || null
    };
  });
}

// --- Resolvers ------------------------------------------------------------------------

function queryRoot(ctx) {
  return {
    viewer: function () { return ctx.viewer(); },
    articles: function (args) {
      if (args.scope === "FEED") return list("/articles/feed", args, ctx);
      if (args.scope === "TAG" && args.tag) return list("/articles?tag=" + encodeURIComponent(args.tag), args, ctx);
      return list("/articles", Object.assign({}, args, { scope: "GLOBAL" }), ctx);
    },
    article: function (args) { if (!args.slug) return null; return rest("GET", "/articles/" + encodeURIComponent(args.slug)).then(function (d) { return article(d.article, ctx); }); },
    profile: function (args) { return rest("GET", "/profiles/" + encodeURIComponent(args.username)).then(function (d) { return profile(d.profile, ctx); }); },
    tags: function () { return rest("GET", "/tags").then(function (d) { return d.tags; }); },
    tag: function (args) { return args.name ? { name: args.name } : null; }
  };
}

function mutationRoot(ctx) {
  var query = queryRoot(ctx);
  function done() { return { query: query }; }
  function signedIn(d) {
    setSession(d.user.token);
    ctx.forget(); // the viewer changed
    return { user: d.user, query: query };
  }
  function articleInput(args) {
    var input = {};
    ["title", "description", "body"].forEach(function (f) { if (args[f] !== undefined) input[f] = args[f] || ""; });
    if (args.tags !== undefined) input.tagList = (args.tags || "").split(",").map(function (t) { return t.trim(); }).filter(Boolean);
    return input;
  }
  return {
    login: function (a) { return rest("POST", "/users/login", { user: { email: a.email || "", password: a.password || "" } }).then(signedIn); },
    register: function (a) { return rest("POST", "/users", { user: { username: a.username || "", email: a.email || "", password: a.password || "" } }).then(signedIn); },
    logout: function () { setSession(null); ctx.forget(); return done(); },
    updateSettings: function (a) {
      var user = { image: a.image || null, username: a.username, bio: a.bio || null, email: a.email };
      if (a.password) user.password = a.password;
      return rest("PUT", "/user", { user: user }).then(signedIn);
    },
    favoriteArticle: function (a) { return rest("POST", "/articles/" + a.slug + "/favorite").then(done); },
    unfavoriteArticle: function (a) { return rest("DELETE", "/articles/" + a.slug + "/favorite").then(done); },
    followProfile: function (a) { return rest("POST", "/profiles/" + encodeURIComponent(a.username) + "/follow").then(done); },
    unfollowProfile: function (a) { return rest("DELETE", "/profiles/" + encodeURIComponent(a.username) + "/follow").then(done); },
    createArticle: function (a) {
      return rest("POST", "/articles", { article: articleInput(a) }).then(function (d) { return { article: article(d.article, ctx), query: query }; });
    },
    updateArticle: function (a) {
      return rest("PUT", "/articles/" + a.slug, { article: articleInput(a) }).then(function (d) { return { article: article(d.article, ctx), query: query }; });
    },
    deleteArticle: function (a) { return rest("DELETE", "/articles/" + a.slug).then(done); },
    addComment: function (a) { return rest("POST", "/articles/" + a.slug + "/comments", { comment: { body: a.body || "" } }).then(done); },
    deleteComment: function (a) { return rest("DELETE", "/articles/" + a.slug + "/comments/" + a.id).then(done); }
  };
}

function context() {
  var viewer = null;
  var ctx = {
    viewer: function () {
      if (!viewer) viewer = session() ? rest("GET", "/user").then(function (d) { return d.user; }, function () { setSession(null); return null; }) : Promise.resolve(null);
      return viewer;
    },
    forget: function () { viewer = null; }
  };
  return ctx;
}

// --- Answering POST /graphql -----------------------------------------------------------

window.fetch = function (input, options) {
  var url = new URL(typeof input === "string" ? input : input.url, location.href);
  if (!/\/graphql$/.test(url.pathname)) return restFetch(input, options);
  var request = JSON.parse(options.body);
  var ctx = context();
  return graphql({
    schema: schema,
    source: request.query,
    // Query and Mutation field names don't overlap, so one root object serves both.
    rootValue: Object.assign(queryRoot(ctx), mutationRoot(ctx)),
    contextValue: ctx,
    variableValues: request.variables,
    operationName: request.operationName
  }).then(function (result) {
    return new Response(JSON.stringify(result), { status: 200, headers: { "Content-Type": "application/json" } });
  });
};
