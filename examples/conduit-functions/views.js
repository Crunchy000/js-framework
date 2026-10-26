/*
 * views.js — Conduit's views, as plain functions in the page.
 *
 * Each function is what a page calls with fn:name. It talks to the RealWorld
 * API, and returns everything that page shows, ready to draw: dates written
 * out, "is this mine?" decided, buttons labelled. Every action (favourite,
 * follow, comment...) returns the same view again, so the page just redraws.
 *
 *   page (jsonx)  --fn:home-->  this file  --fetch /api/articles-->  RealWorld API
 *
 * The other Conduit runs the same code as a view API on a server (view-api.js).
 * Here there's no server of our own: the browser keeps the sign-in token, and
 * these functions only serve this page.
 *
 * A plain script (not a module), so jsonx can find the functions by name.
 */

const API = "/api";        // any RealWorld API; the demo's is mock-api.js
const PAGE_SIZE = 10;

// --- Talking to the RealWorld API ---------------------------------------------

async function api(method, path, body) {
  const headers = { "Content-Type": "application/json" };
  const token = localStorage.getItem("conduit-session");
  if (token) headers.Authorization = "Token " + token;
  const response = await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = response.status === 204 ? null : await response.json();
  // Throwing { status, errors } makes jsonx draw it like a server's error answer.
  if (response.status === 401 && data && data.errors && data.errors.token) throw { status: 401, error: "Please sign in first." };
  if (!response.ok) throw { status: response.status, ...data };
  return data;
}

function signIn(user) {
  localStorage.setItem("conduit-session", user.token);
  return { user: { username: user.username } };
}

async function me() {
  if (!localStorage.getItem("conduit-session")) return null;
  try { return (await api("GET", "/user")).user; }
  catch (e) { localStorage.removeItem("conduit-session"); return null; }
}

// --- Shaping RealWorld's things for the pages -----------------------------------

function date(iso) {
  return new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

function person(p, user) {
  return {
    username: p.username, bio: p.bio, image: p.image,
    initial: p.username.slice(0, 1).toUpperCase(),
    url: "profile.html?username=" + encodeURIComponent(p.username),
    mine: !!user && user.username === p.username,
    following: p.following,
    followLabel: (p.following ? "Unfollow " : "Follow ") + p.username,
    followAppearance: p.following ? "filled" : "outlined"
  };
}

// `favoriteUrl` is what the heart calls, so each page can redraw itself.
function preview(a, user, favoriteUrl) {
  return {
    favoriteUrl: favoriteUrl + (favoriteUrl.includes("?") ? "&" : "?") + "slug=" + encodeURIComponent(a.slug),
    slug: a.slug, title: a.title, description: a.description, tagList: a.tagList,
    url: "article.html?slug=" + encodeURIComponent(a.slug),
    date: date(a.createdAt),
    author: person(a.author, user),
    favoritesCount: a.favoritesCount,
    favorited: a.favorited
  };
}

function pageButtons(count, page) {
  const total = Math.ceil(count / PAGE_SIZE);
  if (total < 2) return [];
  return Array.from({ length: total }, (_, i) => ({ number: i + 1, current: i + 1 === page }));
}

// Favourite or unfavourite, follow or unfollow: whichever it isn't now.
async function flipFavorite(slug) {
  const { article } = await api("GET", "/articles/" + slug);
  await api(article.favorited ? "DELETE" : "POST", "/articles/" + slug + "/favorite");
}

async function flipFollow(username) {
  const { profile } = await api("GET", "/profiles/" + encodeURIComponent(username));
  await api(profile.following ? "DELETE" : "POST", "/profiles/" + encodeURIComponent(username) + "/follow");
}

// --- The nav bar (nav.jx) ----------------------------------------------------------

async function nav() {
  const user = await me();
  return {
    signedIn: !!user,
    username: user ? user.username : "",
    profileUrl: user ? "profile.html?username=" + encodeURIComponent(user.username) : ""
  };
}

// --- Home (index.html) ---------------------------------------------------------------

// `values` holds the page's hidden tab, tag and page fields.
async function home(values) {
  const user = await me();
  const tag = values.tag || "";
  const tab = tag ? "tag" : values.tab === "feed" && user ? "feed" : values.tab === "global" || !user ? "global" : "feed";
  const page = Number(values.page) || 1;
  const query = "?limit=" + PAGE_SIZE + "&offset=" + (page - 1) * PAGE_SIZE + (tab === "tag" ? "&tag=" + encodeURIComponent(tag) : "");
  const [feed, tags] = await Promise.all([
    api("GET", (tab === "feed" ? "/articles/feed" : "/articles") + query),
    api("GET", "/tags")
  ]);
  const tabs = [];
  if (user) tabs.push({ name: "feed", tag: "", label: "Your feed", active: tab === "feed" });
  tabs.push({ name: "global", tag: "", label: "Global feed", active: tab === "global" });
  if (tag) tabs.push({ name: "tag", tag, label: "# " + tag, active: true });
  return {
    tab, tag, page, tabs,
    articles: feed.articles.map((a) => preview(a, user, "fn:favoriteOnHome")),
    pages: pageButtons(feed.articlesCount, page),
    tags: tags.tags
  };
}

async function favoriteOnHome(values) {
  await flipFavorite(values.slug);
  return home(values);
}

// --- An article (article.html?slug=...) ------------------------------------------------

async function article(values) {
  const user = await me();
  const slug = encodeURIComponent(values.slug);
  const [{ article: a }, { comments }] = await Promise.all([
    api("GET", "/articles/" + slug),
    api("GET", "/articles/" + slug + "/comments")
  ]);
  const view = preview(a, user, "fn:favoriteArticle");
  view.mine = view.author.mine;
  view.favoriteLabel = (a.favorited ? "Unfavorite" : "Favorite") + " (" + a.favoritesCount + ")";
  view.favoriteAppearance = a.favorited ? "filled" : "outlined";
  view.editUrl = "editor.html?slug=" + slug;
  view.body = a.body; // HTML: the page draws it with jx:html, cleaned
  return {
    signedIn: !!user,
    article: view,
    comments: comments.map((c) => ({
      id: c.id, body: c.body, date: date(c.createdAt),
      author: person(c.author, user),
      mine: !!user && c.author.username === user.username
    })),
    draft: "" // the comment box: empty again after every change
  };
}

async function favoriteArticle(values) {
  await flipFavorite(encodeURIComponent(values.slug));
  return article(values);
}

async function followAuthor(values) {
  const { article: a } = await api("GET", "/articles/" + encodeURIComponent(values.slug));
  await flipFollow(a.author.username);
  return article(values);
}

async function addComment(values) {
  await api("POST", "/articles/" + encodeURIComponent(values.slug) + "/comments", { comment: { body: values.comment || "" } });
  return article(values);
}

async function deleteComment(values) {
  await api("DELETE", "/articles/" + encodeURIComponent(values.slug) + "/comments/" + values.id);
  return article(values);
}

async function deleteArticle(values) {
  await api("DELETE", "/articles/" + encodeURIComponent(values.slug));
  return {};
}

// --- A profile (profile.html?username=...) ----------------------------------------------

async function profile(values) {
  const user = await me();
  const username = values.username;
  const tab = values.tab === "favorited" ? "favorited" : "articles";
  const page = Number(values.page) || 1;
  const query = "?limit=" + PAGE_SIZE + "&offset=" + (page - 1) * PAGE_SIZE +
    (tab === "favorited" ? "&favorited=" : "&author=") + encodeURIComponent(username);
  const [{ profile: p }, list] = await Promise.all([
    api("GET", "/profiles/" + encodeURIComponent(username)),
    api("GET", "/articles" + query)
  ]);
  return {
    tab, page,
    profile: person(p, user),
    tabs: [
      { name: "articles", label: "My articles", active: tab === "articles" },
      { name: "favorited", label: "Favorited articles", active: tab === "favorited" }
    ],
    articles: list.articles.map((a) => preview(a, user, "fn:favoriteOnProfile?username=" + encodeURIComponent(username))),
    pages: pageButtons(list.articlesCount, page)
  };
}

async function followProfile(values) {
  await flipFollow(values.username);
  return profile(values);
}

async function favoriteOnProfile(values) {
  await flipFavorite(encodeURIComponent(values.slug));
  return profile(values);
}

// --- The editor (editor.html, or editor.html?slug=...) ------------------------------------

async function editor(values) {
  if (!(await me())) return { signedIn: false };
  if (!values.slug) return { signedIn: true, isNew: true, article: { title: "", description: "", body: "", tags: "" } };
  const { article: a } = await api("GET", "/articles/" + encodeURIComponent(values.slug));
  return { signedIn: true, isNew: false, article: { slug: a.slug, title: a.title, description: a.description, body: a.body, tags: a.tagList.join(", ") } };
}

async function saveArticle(values) {
  const article = {
    title: values.title || "", description: values.description || "", body: values.body || "",
    tagList: (values.tags || "").split(",").map((t) => t.trim()).filter(Boolean)
  };
  const saved = values.slug
    ? await api("PUT", "/articles/" + encodeURIComponent(values.slug), { article })
    : await api("POST", "/articles", { article });
  return { article: { slug: saved.article.slug } };
}

// --- Settings, sign in and sign up ------------------------------------------------------------

async function settings() {
  const user = await me();
  if (!user) return { signedIn: false };
  return { signedIn: true, user: { image: user.image || "", username: user.username, bio: user.bio || "", email: user.email } };
}

async function saveSettings(values) {
  const user = { image: values.image || null, username: values.username, bio: values.bio || null, email: values.email };
  if (values.password) user.password = values.password;
  return signIn((await api("PUT", "/user", { user })).user);
}

async function login(values) {
  return signIn((await api("POST", "/users/login", { user: { email: values.email || "", password: values.password || "" } })).user);
}

async function register(values) {
  return signIn((await api("POST", "/users", { user: { username: values.username || "", email: values.email || "", password: values.password || "" } })).user);
}

function logout() {
  localStorage.removeItem("conduit-session");
  return {};
}

function resetDemo() {
  localStorage.removeItem("conduit-session");
  window.resetConduitData();
  return {};
}
