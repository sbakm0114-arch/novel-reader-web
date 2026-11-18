// Thin front proxy on pages.dev (reachable for her) -> novel-reader Worker.
// Plus: a second book source in the subscription, "来福推荐", listing the
// books I picked for her, grouped by recommendation date (added 2026-11-18).
// Plus: H / non-H zones on the main source's explore page (2026-11-18):
// books carrying a "spicy" marker tag are filtered out of the non-H zone
// (served via /flt/search) and gathered into an H zone (/zone/list).
const PROD = "https://novel.absdjkl.ccwu.cc";

// Recommendation registry: append one entry per book per batch.
// date = the day the batch was pushed to her (Asia/Shanghai).
const RECS = [
  { date: "2026-11-18", title: "定海浮生录", author: "非天夜翔" },
  { date: "2026-11-18", title: "一剑霜寒", author: "语笑阑珊" },
  { date: "2026-11-18", title: "穿成万人迷的炮灰竹马", author: "妾在山阳" },
];

// "Spicy" marker tags: a catalog book carrying any of these counts as H-zone.
const SPICY = ["氛围:暗黑重口", "关系:NP", "关系:NTR", "设定:双性", "人设:小倌"];
const SPICY_SET = new Set(SPICY);
const SPICY_LABELS = { "氛围:暗黑重口": "暗黑重口", "关系:NP": "NP", "关系:NTR": "NTR", "设定:双性": "双性", "人设:小倌": "小倌" };
function isSpicy(b) { return (b.tags || []).some(t => SPICY_SET.has(t)); }

const RULES = {
  ruleBookInfo: { author: "$.author", intro: "$.intro", kind: "$.tags", name: "$.title", tocUrl: "$.tocUrl" },
  ruleContent: { content: "$.text" },
  ruleExplore: { author: "$.author", bookList: "$.books[*]", bookUrl: "$.url", kind: "$.tags", name: "$.title" },
  ruleSearch: { author: "$.author", bookList: "$.books[*]", bookUrl: "$.url", kind: "$.tags", name: "$.title" },
  ruleToc: { chapterList: "$.chapters[*]", chapterName: "$.title", chapterUrl: "$.url" },
};

function dateLabel(d) {
  const m = d.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return d + "推荐";
  return parseInt(m[2], 10) + "月" + parseInt(m[3], 10) + "日推荐";
}

function recSource(origin) {
  const dates = [...new Set(RECS.map(r => r.date))].sort().reverse();
  const kinds = [{ title: "📚 全部推荐", url: origin + "/rec/list?page={{page}}", style: { layout_flexGrow: 1, layout_wrapBefore: true } }];
  for (const d of dates) {
    kinds.push({ title: "📅 " + dateLabel(d), url: origin + "/rec/list?date=" + d + "&page={{page}}", style: { layout_flexGrow: 1, layout_wrapBefore: true } });
  }
  return {
    bookSourceGroup: "自建",
    bookSourceName: "来福推荐",
    bookSourceType: 0,
    bookSourceUrl: origin + "/rec",
    enabled: true,
    enabledExplore: true,
    exploreUrl: JSON.stringify(kinds),
    searchUrl: origin + "/rec/list?q={{key}}&page={{page}}",
    ...RULES,
  };
}

async function recList(u, origin) {
  const date = u.searchParams.get("date");
  const q = u.searchParams.get("q");
  const page = parseInt(u.searchParams.get("page") || "1", 10);
  if (page > 1) return { total: 0, page, books: [] };
  const entries = RECS.filter(r => (!date || r.date === date) && (!q || r.title.includes(q) || (r.author || "").includes(q)));
  const seen = new Set();
  const books = [];
  for (const e of entries) {
    try {
      const resp = await fetch(PROD + "/api/search?q=" + encodeURIComponent(e.title) + "&page=1", { headers: { "x-pub-origin": origin } });
      const data = await resp.json();
      let cands = (data.books || []).filter(b => b.title === e.title);
      if (!cands.length) cands = (data.books || []).filter(b => (b.title || "").includes(e.title));
      for (const b of cands) {
        if (seen.has(b.id)) continue;
        seen.add(b.id);
        books.push(b);
      }
    } catch (err) { /* skip unreachable entry */ }
  }
  return { total: books.length, page: 1, books };
}

// Non-H zone: same production search, spicy books removed page by page.
async function fltSearch(u, origin) {
  const resp = await fetch(PROD + "/api/search" + u.search, { headers: { "x-pub-origin": origin } });
  const data = await resp.json();
  data.books = (data.books || []).filter(b => !isSpicy(b));
  return data;
}

// H zone: merge the production searches for every spicy marker tag.
async function zoneList(u, origin) {
  const page = parseInt(u.searchParams.get("page") || "1", 10);
  const seen = new Set();
  const all = [];
  for (const tag of SPICY) {
    for (let p = 1; p <= 6; p++) {
      try {
        const resp = await fetch(PROD + "/api/search?tag=" + encodeURIComponent(tag) + "&page=" + p, { headers: { "x-pub-origin": origin } });
        const data = await resp.json();
        const bs = data.books || [];
        if (!bs.length) break;
        for (const b of bs) { if (!seen.has(b.id)) { seen.add(b.id); all.push(b); } }
        if (bs.length < 20) break;
      } catch (e) { break; }
    }
  }
  all.sort((a, b) => a.id - b.id);
  return { total: all.length, page, books: all.slice((page - 1) * 20, page * 20) };
}

function fltify(url) { return typeof url === "string" ? url.replace("/api/search", "/flt/search") : url; }

// Rebuild the main source's explore page: non-H zone on top (all original
// tiles, filtered), H zone at the bottom. Any failure -> source unchanged.
function transformKinds(src, origin) {
  try {
    const kinds = JSON.parse(src.exploreUrl);
    if (!Array.isArray(kinds) || kinds.length < 2) return src;
    const banner = { layout_flexGrow: 1, layout_wrapBefore: true };
    const out = [];
    out.push({ title: "📂 非H区", url: origin + "/flt/search?page={{page}}", style: banner });
    out.push({ ...kinds[0], url: fltify(kinds[0].url) });
    out.push({ ...kinds[1], url: fltify(kinds[1].url) });
    for (const k of kinds.slice(2)) {
      // No author section on the explore page (2026-11-18, her call):
      // authors keep multiplying; she finds their books via search instead.
      if (k.title === "📂 作者" || (k.url || "").includes("author=")) continue;
      out.push({ ...k, url: fltify(k.url) });
    }
    out.push({ title: "📂 H区", url: origin + "/zone/list?zone=spicy&page={{page}}", style: banner });
    out.push({ title: "🔞 H区全部", url: origin + "/zone/list?zone=spicy&page={{page}}", style: banner });
    for (const tag of SPICY) {
      out.push({ title: SPICY_LABELS[tag] || tag, url: origin + "/api/search?tag=" + encodeURIComponent(tag) + "&page={{page}}", style: { layout_flexGrow: 1, layout_wrapBefore: false } });
    }
    return { ...src, exploreUrl: JSON.stringify(out) };
  } catch (e) { return src; }
}

async function sourceArray(origin, withRec) {
  const resp = await fetch(PROD + "/legado-source.json", { headers: { "x-pub-origin": origin } });
  const body = await resp.text();
  try {
    const arr = JSON.parse(body);
    if (Array.isArray(arr)) {
      const out = arr.map(s => (s && s.bookSourceName === "来福推荐") ? s : transformKinds(s, origin));
      if (withRec) out.push(recSource(origin));
      return { json: JSON.stringify(out), status: 200 };
    }
  } catch (e) { /* fall through to raw body */ }
  return { json: body, status: resp.status };
}

function jsonResp(obj, status) {
  return new Response(JSON.stringify(obj), { status: status || 200, headers: { "content-type": "application/json; charset=utf-8" } });
}

export default {
  async fetch(request) {
    const u = new URL(request.url);
    if (u.pathname === "/subscription.json") {
      const r = await sourceArray(u.origin, true);
      return new Response(r.json, { status: r.status, headers: { "content-type": "application/json; charset=utf-8" } });
    }
    if (u.pathname === "/legado-source.json") {
      const r = await sourceArray(u.origin, false);
      return new Response(r.json, { status: r.status, headers: { "content-type": "application/json; charset=utf-8" } });
    }
    if (u.pathname === "/rec/list") return jsonResp(await recList(u, u.origin));
    if (u.pathname === "/flt/search") return jsonResp(await fltSearch(u, u.origin));
    if (u.pathname === "/zone/list") return jsonResp(await zoneList(u, u.origin));
    const target = PROD + u.pathname + u.search;
    const headers = new Headers(request.headers);
    headers.set("x-pub-origin", u.origin);
    headers.delete("host");
    const init = { method: request.method, headers, redirect: "follow" };
    if (request.method !== "GET" && request.method !== "HEAD") init.body = request.body;
    return fetch(target, init);
  }
};
