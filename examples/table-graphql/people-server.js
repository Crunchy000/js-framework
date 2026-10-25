/*
 * people-server.js — a pretend GraphQL server for the people table, running in
 * the browser with the real graphql-js. In real life this runs on a server.
 *
 * The page has no script: it sends one query, and jsonx draws the answer. So
 * the schema has the fields a table needs, the way GitHub's API has
 * `viewerHasStarred`: each column says which arrow it shows and which order a
 * click asks for, and the page list says which page is current.
 */
import { graphql, buildSchema } from "../conduit-graphql/vendor/graphql-16.9.0.min.js";

const schema = buildSchema(`
  type Query {
    people(sort: PersonSort = NAME, order: Order = ASC, search: String, page: Int = 1, perPage: Int = 20): PersonPage!
  }

  enum PersonSort { NAME TEAM CITY JOINED }
  enum Order { ASC DESC }

  "One page of people, with everything a table shows around it."
  type PersonPage {
    rows: [Person!]!
    "The arguments that were used, so controls can show them."
    sort: PersonSort!
    order: Order!
    search: String!
    page: Int!
    perPage: Int!
    "How many match, and which of them are on this page (from 1)."
    total: Int!
    from: Int!
    to: Int!
    columns: [Column!]!
    pages: [PageLink!]!
    previous: Int
    next: Int
  }

  type Person { id: ID! name: String! team: String! city: String! joined: Int! }

  "A column header: clicking it sorts by this column, or flips the order if it's already sorted."
  type Column { sort: PersonSort! label: String! arrow: String! nextOrder: Order! active: Boolean! }

  "A page button. Long lists show the first, last and nearby pages, with gaps between."
  type PageLink { number: Int, label: String!, current: Boolean!, gap: Boolean! }
`);

// 2,000 made-up people, the same on every visit.
const FIRST = ["Ada", "Alan", "Grace", "Linus", "Margaret", "Dennis", "Barbara", "Ken", "Frances", "Tim", "Radia", "Edsger", "Hedy", "John", "Katherine", "Donald"];
const LAST = ["Lovelace", "Turing", "Hopper", "Torvalds", "Hamilton", "Ritchie", "Liskov", "Thompson", "Allen", "Berners-Lee", "Perlman", "Dijkstra", "Lamarr", "McCarthy", "Johnson", "Knuth"];
const TEAMS = ["Design", "Engineering", "Sales", "Support", "Research"];
const CITIES = ["London", "Paris", "Berlin", "Madrid", "Rome", "Oslo", "Dublin", "Lisbon", "Vienna", "Prague"];
let seed = 7;
const pick = (list) => list[Math.floor(((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648) * list.length)];
const YEARS = Array.from({ length: 16 }, (_, i) => 2010 + i);
const everyone = Array.from({ length: 2000 }, (_, i) => ({
  id: String(i + 1), name: pick(FIRST) + " " + pick(LAST), team: pick(TEAMS), city: pick(CITIES), joined: pick(YEARS)
}));

const LABELS = { NAME: "Name", TEAM: "Team", CITY: "City", JOINED: "Joined" };

function people({ sort, order, search, page, perPage }) {
  perPage = Math.min(100, Math.max(5, perPage));
  const words = (search || "").toLowerCase().split(/\s+/).filter(Boolean);
  const key = sort.toLowerCase();
  const found = everyone
    .filter((p) => words.every((w) => (p.name + " " + p.team + " " + p.city).toLowerCase().includes(w)))
    .sort((a, b) => (a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : a.id - b.id) * (order === "ASC" ? 1 : -1));
  const pageCount = Math.max(1, Math.ceil(found.length / perPage));
  page = Math.min(Math.max(1, page), pageCount);
  const start = (page - 1) * perPage;
  return {
    rows: found.slice(start, start + perPage),
    sort, order, search: search || "", page, perPage,
    total: found.length,
    from: found.length ? start + 1 : 0,
    to: Math.min(start + perPage, found.length),
    columns: Object.keys(LABELS).map((s) => ({
      sort: s, label: LABELS[s], active: s === sort,
      arrow: s === sort ? (order === "ASC" ? "↑" : "↓") : "",
      nextOrder: s === sort && order === "ASC" ? "DESC" : "ASC"
    })),
    pages: pageLinks(page, pageCount),
    previous: page > 1 ? page - 1 : null,
    next: page < pageCount ? page + 1 : null
  };
}

// 1 … 4 5 [6] 7 8 … 40
function pageLinks(page, count) {
  const links = [];
  for (let n = 1; n <= count; n++) {
    if (n === 1 || n === count || Math.abs(n - page) <= 2) links.push({ number: n, label: String(n), current: n === page, gap: false });
    else if (!links[links.length - 1].gap) links.push({ number: null, label: "…", current: false, gap: true });
  }
  return links;
}

// --- Answering POST /graphql ------------------------------------------------------

const realFetch = window.fetch;
window.fetch = function (input, options) {
  const url = new URL(typeof input === "string" ? input : input.url, location.href);
  if (!/\/graphql$/.test(url.pathname)) return realFetch(input, options);
  const request = JSON.parse(options.body);
  return graphql({ schema, source: request.query, rootValue: { people }, variableValues: request.variables, operationName: request.operationName })
    .then((result) => new Promise((resolve) => setTimeout(() => resolve(
      new Response(JSON.stringify(result), { status: 200, headers: { "Content-Type": "application/json" } })), 120)));
};
