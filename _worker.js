// Thin front proxy on pages.dev (reachable for her) -> novel-reader Worker.
export default {
  async fetch(request) {
    const u = new URL(request.url);
    const target = "https://novel.absdjkl.ccwu.cc" + u.pathname + u.search;
    const headers = new Headers(request.headers);
    headers.set("x-pub-origin", u.origin);
    headers.delete("host");
    const init = { method: request.method, headers, redirect: "follow" };
    if (request.method !== "GET" && request.method !== "HEAD") init.body = request.body;
    return fetch(target, init);
  }
};
