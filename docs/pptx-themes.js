// 발표자료 디자인 템플릿 3벌 (보고서형·발표형·행사형).
// 화면(브라우저)과 집 PC 브릿지(node)가 같은 디자인을 쓰도록 둘 다에서 불러올 수 있게 만든다.
// buildDeck(P, doc): P = new PptxGenJS(), doc = { template, title, subtitle, sections:[{heading, bullets, table:{headers,rows}, note}] }
(function (root) {
  const FONT = "맑은 고딕";
  const W = 10, H = 5.625; // 16:9 (인치)

  const THEMES = {
    // 보고서형: 흰 바탕, 촘촘한 글, 쪽 번호. 투자 보고서·재무 정리용
    report: {
      bg: "FFFFFF", ink: "1F2328", muted: "6B7280", accent: "A8562A", line: "D9DCE1", tableHead: "A8562A", tableAlt: "F6F1EC",
      headSize: 24, bulletSize: 15, tableSize: 12,
      cover(P, s, doc, t) {
        s.background = { color: t.bg };
        s.addShape(P.ShapeType.rect, { x: 0, y: 0, w: W, h: 0.14, fill: { color: t.accent }, line: { color: t.accent } });
        s.addShape(P.ShapeType.rect, { x: 0.8, y: 2.05, w: 0.9, h: 0.06, fill: { color: t.accent }, line: { color: t.accent } });
        s.addText(doc.title || "", { x: 0.8, y: 2.2, w: 8.4, h: 1.1, fontSize: 36, bold: true, color: t.ink, fontFace: FONT });
        if (doc.subtitle) s.addText(doc.subtitle, { x: 0.8, y: 3.3, w: 8.4, h: 0.5, fontSize: 15, color: t.muted, fontFace: FONT });
        s.addShape(P.ShapeType.line, { x: 0.8, y: 5.0, w: 8.4, h: 0, line: { color: t.line, width: 0.75 } });
        s.addText("보고서", { x: 0.8, y: 5.05, w: 3, h: 0.35, fontSize: 10, color: t.muted, fontFace: FONT });
      },
      page(P, s, sec, n, total, t) {
        s.background = { color: t.bg };
        s.addText(sec.heading || "", { x: 0.6, y: 0.35, w: 8.8, h: 0.6, fontSize: t.headSize, bold: true, color: t.ink, fontFace: FONT });
        s.addShape(P.ShapeType.rect, { x: 0.6, y: 0.98, w: 0.7, h: 0.05, fill: { color: t.accent }, line: { color: t.accent } });
        s.addShape(P.ShapeType.line, { x: 0.6, y: 5.15, w: 8.8, h: 0, line: { color: t.line, width: 0.75 } });
        s.addText(`${n} / ${total}`, { x: 8.2, y: 5.18, w: 1.2, h: 0.3, fontSize: 10, color: t.muted, fontFace: FONT, align: "right" });
        return { x: 0.7, y: 1.25, w: 8.6, bottom: 5.05, bulletColor: t.accent };
      },
    },
    // 발표형: 남색 표지, 큰 글씨, 장 번호 강조. 설명·발표용
    pitch: {
      bg: "FFFFFF", ink: "14213D", muted: "5C677D", accent: "2A9D8F", line: "DDE3EA", tableHead: "14213D", tableAlt: "EEF6F5",
      headSize: 28, bulletSize: 19, tableSize: 14,
      cover(P, s, doc, t) {
        s.background = { color: "14213D" };
        s.addShape(P.ShapeType.rect, { x: 0.7, y: 1.7, w: 0.12, h: 2.0, fill: { color: t.accent }, line: { color: t.accent } });
        s.addText(doc.title || "", { x: 1.05, y: 1.65, w: 8.2, h: 1.3, fontSize: 40, bold: true, color: "FFFFFF", fontFace: FONT, valign: "top" });
        if (doc.subtitle) s.addText(doc.subtitle, { x: 1.05, y: 3.05, w: 8.2, h: 0.6, fontSize: 17, color: "C9D3E0", fontFace: FONT });
      },
      page(P, s, sec, n, total, t) {
        s.background = { color: t.bg };
        s.addShape(P.ShapeType.rect, { x: 0, y: 0, w: 0.28, h: H, fill: { color: "14213D" }, line: { color: "14213D" } });
        s.addText(String(n).padStart(2, "0"), { x: 0.55, y: 0.3, w: 1.1, h: 0.8, fontSize: 34, bold: true, color: t.accent, fontFace: FONT });
        s.addText(sec.heading || "", { x: 1.6, y: 0.38, w: 7.9, h: 0.75, fontSize: t.headSize, bold: true, color: t.ink, fontFace: FONT, valign: "middle" });
        return { x: 0.75, y: 1.4, w: 8.75, bottom: 5.25, bulletColor: t.accent };
      },
    },
    // 행사형: 크림색 바탕, 동그란 색 장식, 부드러운 색. 어린이집·모임·행사 안내용
    event: {
      bg: "FFF8EC", ink: "4A3B2A", muted: "8A7560", accent: "F28C28", line: "F1DDBF", tableHead: "F28C28", tableAlt: "FFF1DC",
      headSize: 26, bulletSize: 18, tableSize: 13,
      cover(P, s, doc, t) {
        s.background = { color: t.bg };
        s.addShape(P.ShapeType.ellipse, { x: 7.4, y: -0.9, w: 3.4, h: 3.4, fill: { color: "F28C28", transparency: 25 }, line: { color: "F28C28", transparency: 100 } });
        s.addShape(P.ShapeType.ellipse, { x: -0.9, y: 3.6, w: 2.8, h: 2.8, fill: { color: "7BC67E", transparency: 30 }, line: { color: "7BC67E", transparency: 100 } });
        s.addShape(P.ShapeType.ellipse, { x: 8.3, y: 4.3, w: 0.9, h: 0.9, fill: { color: "4FB3E8", transparency: 20 }, line: { color: "4FB3E8", transparency: 100 } });
        s.addShape(P.ShapeType.ellipse, { x: 1.2, y: 0.7, w: 0.55, h: 0.55, fill: { color: "FFD166" }, line: { color: "FFD166" } });
        s.addText(doc.title || "", { x: 1.0, y: 1.75, w: 8.0, h: 1.3, fontSize: 40, bold: true, color: t.ink, fontFace: FONT, align: "center" });
        if (doc.subtitle) s.addText(doc.subtitle, { x: 1.0, y: 3.05, w: 8.0, h: 0.6, fontSize: 17, color: t.muted, fontFace: FONT, align: "center" });
      },
      page(P, s, sec, n, total, t) {
        s.background = { color: t.bg };
        ["F28C28", "7BC67E", "4FB3E8"].forEach((c, i) => s.addShape(P.ShapeType.ellipse, { x: 0.6 + i * 0.32, y: 0.3, w: 0.2, h: 0.2, fill: { color: c }, line: { color: c } }));
        s.addShape(P.ShapeType.roundRect, { x: 0.55, y: 0.6, w: 8.9, h: 0.8, fill: { color: "FFFFFF" }, line: { color: t.line, width: 1 }, rectRadius: 0.25 });
        s.addText(sec.heading || "", { x: 0.8, y: 0.6, w: 8.4, h: 0.8, fontSize: t.headSize, bold: true, color: t.ink, fontFace: FONT, valign: "middle" });
        s.addShape(P.ShapeType.ellipse, { x: 9.0, y: 4.75, w: 1.4, h: 1.4, fill: { color: "FFD166", transparency: 40 }, line: { color: "FFD166", transparency: 100 } });
        return { x: 0.75, y: 1.65, w: 8.5, bottom: 5.2, bulletColor: t.accent };
      },
    },
  };

  function buildDeck(P, doc) {
    const t = THEMES[doc.template] || THEMES.report;
    P.layout = "LAYOUT_16x9";
    t.cover(P, P.addSlide(), doc, t);
    const secs = doc.sections || [];
    secs.forEach((sec, i) => {
      const s = P.addSlide();
      const box = t.page(P, s, sec, i + 1, secs.length, t);
      let y = box.y;
      const bullets = sec.bullets || [];
      const hasTable = sec.table?.headers?.length;
      if (bullets.length) {
        const h = Math.min(hasTable ? 1.7 : 3.4, (t.bulletSize / 36) * bullets.length + 0.25);
        s.addText(bullets.map((b) => ({ text: String(b), options: { bullet: { code: "25CF", color: box.bulletColor }, breakLine: true } })),
          { x: box.x, y, w: box.w, h, fontSize: hasTable ? Math.max(13, t.bulletSize - 3) : t.bulletSize, color: t.ink, fontFace: FONT, lineSpacingMultiple: 1.2, valign: "top", paraSpaceAfter: 4 });
        y += h + 0.12;
      }
      if (hasTable) {
        const head = sec.table.headers.map((h) => ({ text: String(h), options: { bold: true, color: "FFFFFF", fill: { color: t.tableHead } } }));
        const body = (sec.table.rows || []).map((r, ri) => r.map((c) => ({ text: String(c), options: ri % 2 ? { fill: { color: t.tableAlt } } : {} })));
        s.addTable([head, ...body], { x: box.x, y, w: box.w, fontSize: t.tableSize, color: t.ink, fontFace: FONT, border: { type: "solid", pt: 0.5, color: t.line }, valign: "middle", rowH: 0.34, autoPage: false });
      }
      if (sec.note) s.addText(sec.note, { x: box.x, y: box.bottom - 0.4, w: box.w, h: 0.35, fontSize: 11, color: t.muted, fontFace: FONT, italic: true });
    });
    return P;
  }

  root.buildDeck = buildDeck;
  root.DECK_TEMPLATES = Object.keys(THEMES);
  if (typeof module !== "undefined" && module.exports) module.exports = { buildDeck, DECK_TEMPLATES: Object.keys(THEMES) };
})(typeof window !== "undefined" ? window : globalThis);
