// ── HWPX(한글) 템플릿 채우기 엔진 ──────────────────────────────
// 브라우저(DOMParser)와 Node(@xmldom/xmldom) 양쪽에서 동작하도록 DOM 표준 API만 사용.
//
// 템플릿 section0.xml 의 <hp:t> 안에 아래 마커를 적어두면 data 로 채운다.
//   {{key}}          단순 치환. 값에 줄바꿈(\n)이 있으면 <hp:lineBreak/> 로 변환
//   {{~key}}         서식 치환. 값 안의 **굵게** 구간을 같은 문단의 {{~bold}} 런 서식으로 분리
//                    ({{~bold}} 런은 서식 견본용이라 채운 뒤 삭제)
//   {{*list}}        문단 반복. data.list(문자열 배열) 항목마다 해당 문단을 복제
//   {{#list.field}}  표 행 반복. data.list(객체 배열) 항목마다 해당 행을 복제
//                    — 반복 행이 2개 이상이면 첫 행=윗선 견본, 마지막 행=아랫선 견본으로 보고
//                      행 위치에 맞는 테두리(borderFill)를 header.xml 에 합성해 붙인다.
// 값이 바뀐 문단은 <hp:linesegarray>(줄 배치 캐시)를 지워 한글이 열 때 다시 계산하게 한다.

export const HP_NS = 'http://www.hancom.co.kr/hwpml/2011/paragraph';
export const HH_NS = 'http://www.hancom.co.kr/hwpml/2011/head';

const MARK_RE = /\{\{([#*~]?)([\w.]+)\}\}/g;

function kids(el, local) {
  const out = [];
  for (let c = el.firstChild; c; c = c.nextSibling) {
    if (c.nodeType === 1 && c.localName === local) out.push(c);
  }
  return out;
}

function descendants(el, ns, local) {
  return Array.from(el.getElementsByTagNameNS(ns, local));
}

// 문단 자신의 텍스트 (중첩 표 안의 문단은 제외)
function ownText(p) {
  return kids(p, 'run').map(r => kids(r, 't').map(t => t.textContent).join('')).join('');
}

function closest(el, local) {
  let n = el.parentNode;
  while (n && n.nodeType === 1) {
    if (n.localName === local) return n;
    n = n.parentNode;
  }
  return null;
}

function dropLineSeg(p) {
  kids(p, 'linesegarray').forEach(ls => p.removeChild(ls));
}

// <hp:t> 한 개의 텍스트를 교체. 줄바꿈은 <hp:lineBreak/> 로.
function setTText(t, text) {
  const doc = t.ownerDocument;
  while (t.firstChild) t.removeChild(t.firstChild);
  String(text).split('\n').forEach((line, i) => {
    if (i > 0) t.appendChild(doc.createElementNS(HP_NS, 'hp:lineBreak'));
    if (line) t.appendChild(doc.createTextNode(line));
  });
}

// 텍스트 노드 안의 마커를 resolver 결과로 치환. 치환이 일어나면 true.
function replaceMarkersIn(t, resolve) {
  let changed = false;
  const texts = [];
  for (let c = t.firstChild; c; c = c.nextSibling) if (c.nodeType === 3) texts.push(c);
  texts.forEach(node => {
    const src = node.nodeValue;
    if (!src.includes('{{')) return;
    const out = src.replace(MARK_RE, (m, kind, key) => {
      const v = resolve(kind, key);
      if (v === undefined) return m;
      changed = true;
      return v == null ? '' : String(v);
    });
    if (out === src) return;
    if (!out.includes('\n')) { node.nodeValue = out; return; }
    // 줄바꿈 포함 → 텍스트 노드를 [텍스트, lineBreak, 텍스트 …] 로 분할
    const doc = t.ownerDocument;
    out.split('\n').forEach((line, i) => {
      if (i > 0) t.insertBefore(doc.createElementNS(HP_NS, 'hp:lineBreak'), node);
      if (line) t.insertBefore(doc.createTextNode(line), node);
    });
    t.removeChild(node);
  });
  return changed;
}

function fillMarkers(root, resolve) {
  descendants(root, HP_NS, 't').forEach(t => {
    if (replaceMarkersIn(t, resolve)) {
      const p = closest(t, 'p');
      if (p) dropLineSeg(p);
    }
  });
}

// ── borderFill 합성 (표 행 반복용) ──────────────────────────────
class BorderFills {
  constructor(headerDoc) {
    this.doc = headerDoc;
    this.container = headerDoc ? descendants(headerDoc, HH_NS, 'borderFills')[0] : null;
    this.byId = {};
    this.cache = {};
    if (!this.container) return;
    kids(this.container, 'borderFill').forEach(bf => { this.byId[bf.getAttribute('id')] = bf; });
    this.nextId = Math.max(0, ...Object.keys(this.byId).map(Number)) + 1;
  }
  // base 의 좌우/배경 + topSrc 의 윗선 + bottomSrc 의 아랫선
  combine(baseId, topId, bottomId) {
    if (topId === baseId && bottomId === baseId) return baseId;
    if (!this.container) return baseId;
    const key = `${baseId}|${topId}|${bottomId}`;
    if (this.cache[key]) return this.cache[key];
    const base = this.byId[baseId], top = this.byId[topId], bottom = this.byId[bottomId];
    if (!base || !top || !bottom) return baseId;
    const nb = base.cloneNode(true);
    const swap = (local, src) => {
      const cur = kids(nb, local)[0];
      const rep = kids(src, local)[0];
      if (cur && rep) nb.replaceChild(rep.cloneNode(true), cur);
    };
    swap('topBorder', top);
    swap('bottomBorder', bottom);
    const id = String(this.nextId++);
    nb.setAttribute('id', id);
    this.container.appendChild(nb);
    this.container.setAttribute('itemCnt', String(kids(this.container, 'borderFill').length));
    this.byId[id] = nb;
    this.cache[key] = id;
    return id;
  }
}

function rowCells(tr) { return kids(tr, 'tc'); }

function expandRowLoops(sectionDoc, data, fills) {
  descendants(sectionDoc, HP_NS, 'tbl').forEach(tbl => {
    const rows = kids(tbl, 'tr');
    let listName = null;
    const tpl = rows.filter(tr => {
      const m = /\{\{#(\w+)\./.exec(descendants(tr, HP_NS, 't').map(t => t.textContent).join(''));
      if (m) listName = listName || m[1];
      return !!m;
    });
    if (!tpl.length) return;

    const items = Array.isArray(data[listName]) && data[listName].length ? data[listName] : [{}];
    const first = tpl[0], last = tpl[tpl.length - 1];
    const firstCells = rowCells(first), lastCells = rowCells(last);
    const n = items.length;

    items.forEach((item, i) => {
      const clone = first.cloneNode(true);
      if (tpl.length > 1) {
        const topRow = i === 0 ? firstCells : lastCells;           // 첫 행만 견본 윗선(이중선 등)
        const bottomRow = i === n - 1 ? lastCells : firstCells;    // 마지막 행만 견본 아랫선
        rowCells(clone).forEach((tc, c) => {
          const baseId = firstCells[c]?.getAttribute('borderFillIDRef');
          const topId = (topRow[c] || firstCells[c])?.getAttribute('borderFillIDRef');
          const botId = (bottomRow[c] || firstCells[c])?.getAttribute('borderFillIDRef');
          if (baseId) tc.setAttribute('borderFillIDRef', fills.combine(baseId, topId, botId));
        });
      }
      fillMarkers(clone, (kind, key) => {
        if (kind !== '#') return undefined;
        const [ln, field] = key.split('.');
        if (ln !== listName) return undefined;
        return item[field] ?? '';
      });
      tbl.insertBefore(clone, first);
    });
    tpl.forEach(tr => tbl.removeChild(tr));

    // 행 주소·행 수·표 높이 재계산
    const newRows = kids(tbl, 'tr');
    let height = 0;
    newRows.forEach((tr, r) => {
      let rowH = 0;
      rowCells(tr).forEach(tc => {
        const addr = kids(tc, 'cellAddr')[0];
        if (addr) addr.setAttribute('rowAddr', String(r));
        const span = kids(tc, 'cellSpan')[0];
        const sz = kids(tc, 'cellSz')[0];
        if (sz && (!span || span.getAttribute('rowSpan') === '1')) {
          rowH = Math.max(rowH, Number(sz.getAttribute('height')) || 0);
        }
      });
      height += rowH;
    });
    tbl.setAttribute('rowCnt', String(newRows.length));
    const sz = kids(tbl, 'sz')[0];
    if (sz && height) sz.setAttribute('height', String(height));
    const holder = closest(tbl, 'p');
    if (holder) dropLineSeg(holder);
  });
}

function expandParagraphLoops(sectionDoc, data) {
  descendants(sectionDoc, HP_NS, 'p').forEach(p => {
    const m = /\{\{\*(\w+)\}\}/.exec(ownText(p));
    if (!m) return;
    const name = m[1];
    const items = Array.isArray(data[name]) && data[name].length ? data[name] : [''];
    items.forEach(item => {
      const clone = p.cloneNode(true);
      kids(clone, 'run').forEach(r => kids(r, 't').forEach(t => {
        replaceMarkersIn(t, (kind, key) => (kind === '*' && key === name ? item : undefined));
      }));
      dropLineSeg(clone);
      p.parentNode.insertBefore(clone, p);
    });
    p.parentNode.removeChild(p);
  });
}

// {{~key}} — **굵게** 구간을 같은 문단의 {{~bold}} 견본 런 서식으로 분리
function expandRichRuns(sectionDoc, data) {
  descendants(sectionDoc, HP_NS, 'p').forEach(p => {
    const runs = kids(p, 'run');
    const boldRun = runs.find(r => kids(r, 't').some(t => t.textContent.includes('{{~bold}}')));
    runs.forEach(run => {
      const t = kids(run, 't').find(t => /\{\{~(\w+)\}\}/.test(t.textContent));
      if (!t || run === boldRun) return;
      const m = /\{\{~(\w+)\}\}/.exec(t.textContent);
      const before = t.textContent.slice(0, m.index);
      const after = t.textContent.slice(m.index + m[0].length);
      const value = before + String(data[m[1]] ?? '') + after;
      const boldCharPr = boldRun ? boldRun.getAttribute('charPrIDRef') : run.getAttribute('charPrIDRef');
      const parts = value.split('**');
      parts.forEach((part, i) => {
        if (!part) return;
        const nr = run.cloneNode(true);
        if (i % 2 === 1) nr.setAttribute('charPrIDRef', boldCharPr);
        setTText(kids(nr, 't')[0], part);
        p.insertBefore(nr, run);
      });
      p.removeChild(run);
      dropLineSeg(p);
    });
    if (boldRun) { p.removeChild(boldRun); dropLineSeg(p); }
  });
}

// sectionDoc / headerDoc: 파싱된 XML Document. 제자리에서 수정한다.
export function fillHwpxSection(sectionDoc, headerDoc, data) {
  const fills = new BorderFills(headerDoc);
  expandRowLoops(sectionDoc, data, fills);
  expandParagraphLoops(sectionDoc, data);
  expandRichRuns(sectionDoc, data);
  fillMarkers(sectionDoc, (kind, key) => {
    if (kind) return undefined;
    return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : undefined;
  });
}

// XMLSerializer 는 XML 선언을 떨어뜨리므로 원본 선언을 붙여 돌려준다.
export function serializeXml(doc, XMLSerializerImpl) {
  const body = new XMLSerializerImpl().serializeToString(doc).replace(/^<\?xml[^>]*\?>\s*/, '');
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>' + body;
}
