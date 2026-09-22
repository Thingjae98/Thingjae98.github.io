// 뉴스: 구글 뉴스 RSS(키 불필요). 제목·매체·시각·요약만 넘기고 요약은 LLM이 한다.
export async function searchNews(q, limit = 8) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=ko&gl=KR&ceid=KR:ko`;
  const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!r.ok) throw new Error("news rss " + r.status);
  const xml = await r.text();
  const items = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const b = m[1];
    const pick = (tag) => (b.match(new RegExp("<" + tag + "(?:\\s[^>]*)?>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</" + tag + ">")) || [])[1] || "";
    items.push({ title: pick("title").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"'), source: pick("source"), at: pick("pubDate"), link: pick("link") });
    if (items.length >= limit) break;
  }
  return items;
}
