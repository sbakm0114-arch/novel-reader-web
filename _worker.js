// Thin front proxy on pages.dev (reachable for her) -> novel-reader Worker.
// Plus: a second book source in the subscription, "来福推荐", listing the
// books I picked for her, grouped by recommendation date (added 2026-11-18).
const PROD = "https://novel.absdjkl.ccwu.cc";

// Recommendation registry: append one entry per book per batch.
// date = the day the batch was pushed to her (Asia/Shanghai).
const RECS = [
  { date: "2026-11-18", title: "定海浮生录", author: "非天夜翔" },
  { date: "2026-11-18", title: "一剑霜寒", author: "语笑阑珊" },
  { date: "2026-11-18", title: "穿成万人迷的炮灰竹马", author: "妾在山阳" },
];

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

export default {
  async fetch(request) {
    const u = new URL(request.url);
    if (u.pathname === "/subscription.json") {
      const headers = new Headers();
      headers.set("x-pub-origin", u.origin);
      const resp = await fetch(PROD + "/legado-source.json", { headers });
      const body = await resp.text();
      try {
        const arr = JSON.parse(body);
        if (Array.isArray(arr)) {
          arr.push(recSource(u.origin));
          return new Response(JSON.stringify(arr), { status: 200, headers: { "content-type": "application/json; charset=utf-8" } });
        }
      } catch (err) { /* fall through to raw body */ }
      return new Response(body, { status: resp.status, headers: { "content-type": "application/json; charset=utf-8" } });
    }
    if (u.pathname === "/rec/list") {
      const data = await recList(u, u.origin);
      return new Response(JSON.stringify(data), { status: 200, headers: { "content-type": "application/json; charset=utf-8" } });
    }
    const target = PROD + u.pathname + u.search;
    const headers = new Headers(request.headers);
    headers.set("x-pub-origin", u.origin);
    headers.delete("host");
    const init = { method: request.method, headers, redirect: "follow" };
    if (request.method !== "GET" && request.method !== "HEAD") init.body = request.body;
    return fetch(target, init);
  }
};
