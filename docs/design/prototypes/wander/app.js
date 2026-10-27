// Independent interaction study: all records and relationships below are fictional.
const notes = {
  love: { date: "2023.03.18", context: "爱情", tag: "生活 / 关系", title: "有些话，我以为不用说", paragraphs: ["昨晚散步，聊到最近有点累。我一直在等一句‘是不是发生了什么’，后来才发现，对方以为我只是想安静走一会儿。", "我没有说需要陪伴，却希望这件事不用说出口。"] },
  family: { date: "2024.01.07", context: "家人", tag: "生活 / 家人", title: "那通没有挂掉的电话", paragraphs: ["跟妈妈打电话，又习惯性地说‘都挺好的’。快挂的时候，还是告诉她，这周其实过得不太好。", "她没有急着给建议，只说，那我们再聊一会儿。", "好像说出一点不开心，也没有我想象中那么让她担心。"] },
  friend: { date: "2024.08.26", context: "朋友", tag: "生活 / 碎片", title: "陪我坐十分钟", paragraphs: ["今天没有再说‘没事，我自己待着就好’，而是问阿宁，能不能陪我坐十分钟。", "我们坐在便利店外面，吃完了一支快化掉的冰淇淋。其实也没聊什么。", "有时候，陪伴不需要一个很大的理由。"] },
  work: { date: "2025.02.12", context: "工作", tag: "工作 / 日常", title: "把求助说得小一点", paragraphs: ["项目卡了两天，消息写了又删。总觉得一问别人，就像承认自己做不好。", "后来把‘能帮我看看吗’改成‘能一起看十分钟这个地方吗’，发出去居然没那么难。", "可能不是所有求助，都意味着把整件事交给别人。"] },
};
const extraParagraphs = ["那天后来还发生了很多小事。经过面包店的时候，门已经关了；街边的树影落在路面上，风不大，走得很慢。现在想起来，我记住的倒不是谈话里的某一句，而是两个人都没有赶着回去。", "我时常会把‘说明白’想成一件很郑重的事，好像一开口就必须把前因后果都整理清楚。但那晚最想说的其实很简单：今天有点难，想有人在身边。", "也许下一次可以只说这一句，不用先替对方判断会不会觉得麻烦。至于能不能被理解，等话说出来以后再看。", "写到这里，楼下有人收起了遮阳伞。今天先记这些。前面的疑问还没有答案，也没有关系。"];
const links = [
  { a: "love", b: "family", hint: "换了一个人，有些需要仍然很难说出口。", qa: "我没有说需要陪伴，却希望这件事不用说出口。", qb: "跟妈妈打电话，又习惯性地说‘都挺好的’。", caveat: "一段是期待对方察觉，一段是担心家人。相近的表达困难，不意味着相同的原因。" },
  { a: "family", b: "friend", hint: "后来的一次，你把需要说得更具体了。", qa: "快挂的时候，还是告诉她，这周其实过得不太好。", qb: "而是问阿宁，能不能陪我坐十分钟。", caveat: "两次发生在不同关系里。可以并读，但不能仅凭这两段判断你已经发生了稳定的变化。" },
  { a: "friend", b: "work", hint: "‘十分钟’也出现在了另一次求助里。", qa: "能不能陪我坐十分钟。", qb: "能一起看十分钟这个地方吗", caveat: "一个需要陪伴，一个需要工作帮助；具体而有限的请求，是可以留意的相似之处。" },
  { a: "family", b: "work", hint: "生活之外，还有一次犹豫着开口的时刻。", qa: "又习惯性地说‘都挺好的’。", qb: "消息写了又删。", caveat: "两段原文都留下了开口前的迟疑。这里没有足够依据把它们解释成同一种心理原因。" },
  { a: "love", b: "friend", hint: "一次等待被察觉，一次主动说了出来。", qa: "我没有说需要陪伴", qb: "能不能陪我坐十分钟。", caveat: "关系对象和场景不同。这是一种阅读角度，不是对关系好坏的判断。" },
];
const concepts = {
  hybrid: { kicker: "A+C / 连读与地图", title: "顺着读，偶尔抬头看看附近。", description: "平时只有连续的原文。想看分支时，展开附近地图；点一篇就回到阅读，关掉则留在原来的位置。", instruction: "先往下读，再试试右上角“附近地图”", tradeoff: "A+C 的分工：正文承载阅读，地图负责定位与拐弯。地图里的原话片段只做路标；选择后直接回到完整原文，无须再打开详情。" },
  flow: { kicker: "A / 顺着读", title: "下一段原文，就在下面。", description: "像读一封很长的信。有关的记录自然接在后面，滚动就能读；只有想拐弯时，才需要选择。", instruction: "往下滚动，留意两篇之间的轻提示", tradeoff: "A 的取舍：日常负担最低，也最适合手机。系统会先安排一条小径，因此需要保留可忽略的岔路，以及自然停下的地方。" },
  pages: { kicker: "B / 翻页并读", title: "让两段时光，坐在一起。", description: "桌面同时摆出两篇原文，翻一页便换一组相邻记录。手机左右轻扫，上一段始终在身旁。", instruction: "用左右箭头或横向滑动翻页，正文可以直接读", tradeoff: "B 的取舍：更容易对照原话，节奏更安静。手机读长文时，要区分上下读正文与左右翻页，学习成本比 A 略高。" },
  map: { kicker: "C / 原文地图", title: "文字已经展开，路由你走。", description: "几篇完整原文散落在同一张小地图上。平移就能读相邻记录，连线只是轻轻提示它们的关系。", instruction: "平移地图读原文；“看全貌”可看局部关系", tradeoff: "C 的取舍：最接近你最初的思维导图想象，分支也最清楚。但空间定位、长文和小屏幕会带来额外负担，更适合作为偶尔打开的地图。" },
};
const $ = (selector, parent = document) => parent.querySelector(selector);
const escapeHTML = (text) => text.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const experience = $("#experience");
let mode = "flow";
let order = ["love", "family", "friend", "work"];
let visited = ["love"];
let longNote = false;
let stopped = false;
let pageIndex = 0;
let overview = false;
let observer;
let previousView;
let previousScroll = 0;
let nearbyOrigin;
let nearbyChoice = null;
let nearbyOverflow = "";
let hybridReturns = [];
const motion = () => matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth";
const announce = (text) => { $("#announcement").textContent = text; };
function noteHTML(id, classes = "", suffix = "main") {
  const n = notes[id];
  const paragraphs = [...n.paragraphs, ...(longNote && id === "love" ? extraParagraphs : [])];
  return `<article class="note ${classes}" data-note="${id}" id="note-${suffix}-${id}" aria-label="${n.date}，${n.context}的记录"><div class="note-meta"><time>${n.date}</time><span class="note-context">${n.context}</span></div><div class="note-body">${paragraphs.map((text) => `<p>${escapeHTML(text)}</p>`).join("")}</div><span class="note-tag"># ${n.tag}</span></article>`;
}
function relation(a, b) { return links.find((link) => (link.a === a && link.b === b) || (link.a === b && link.b === a)); }
function hintHTML(a, b) {
  const edge = relation(a, b);
  if (!edge) return "";
  return `<div class="hint-holder"><details class="connection"><summary>${edge.hint}</summary><div class="evidence"><p>这个角度来自两段原话</p><blockquote>“${edge.qa}”<time>${notes[edge.a].date} · ${notes[edge.a].context}</time></blockquote><blockquote>“${edge.qb}”<time>${notes[edge.b].date} · ${notes[edge.b].context}</time></blockquote><p>${edge.caveat}</p><button type="button" data-action="dismiss-hint">这个提示不贴切</button></div></details></div>`;
}
function intro(text, classes = "") { return `<div class="walk-intro ${classes}"><p>${text}</p><button type="button" class="quiet-button" data-action="shuffle"><span aria-hidden="true">↝</span> 换个起点</button></div>`; }
function endHTML() { return `<div class="stream-end"><span class="end-mark" aria-hidden="true"></span><p>这条小径，先到这里。</p><small>刚才读到的，可以再留一会儿。</small><button type="button" class="quiet-button" data-action="shuffle">去别处看看 <span aria-hidden="true">↝</span></button></div>`; }
function renderFlow() {
  const branchId = order[3];
  return `${intro("从某个普通的日子，开始。")}<div class="reading-stream">${order.slice(0, 3).map((id, index) => `${index ? `<div class="bridge">${hintHTML(order[index - 1], id)}</div>` : ""}${noteHTML(id, "stream-note")}${id === "family" ? `<details class="side-path"><summary><span aria-hidden="true">↳</span> 这里也通向一段${notes[branchId].context}记录</summary>${noteHTML(branchId, "", "branch")}${hintHTML("family", branchId)}</details>` : ""}`).join("")}${endHTML()}</div>`;
}
function renderHybrid() {
  const branchId = order[3];
  return `${intro("顺着这些原话，慢慢读。")}<div class="reading-stream hybrid-stream">${order.slice(0, 3).map((id, index) => `${index ? `${order[index - 1] === "family" ? `<div class="bridge" data-branch-connection hidden>${hintHTML(branchId, id)}</div>` : ""}<div class="bridge" ${order[index - 1] === "family" ? "data-main-connection" : ""}>${hintHTML(order[index - 1], id)}</div>` : ""}${noteHTML(id, "stream-note")}${id === "family" ? `<div class="hybrid-fork"><button type="button" class="quiet-button" data-action="hybrid-map" data-from="family"><span aria-hidden="true">↳</span> 附近还有一段${notes[branchId].context}记录 <span aria-hidden="true">⌁</span></button></div><section class="hybrid-branch" hidden aria-label="从家人记录延伸的岔路"><div class="branch-caption">从家人的这一篇，拐到${notes[branchId].context}</div><div class="bridge">${hintHTML("family", branchId)}</div>${noteHTML(branchId, "stream-note", "branch")}<div class="branch-rejoin">${index < 2 ? "往下，仍然可以顺着读。" : "这条岔路，先到这里。"}</div></section>` : ""}`).join("")}${endHTML()}</div>`;
}
function renderPages() {
  return `${intro("把相邻的两段，放在一起看看。", "pages-intro")}<div class="page-book" tabindex="0" role="region" aria-label="原文书页，左右滑动或使用方向键翻页">${order.map((id, index) => `<section class="page-sheet" data-sheet="${index}">${noteHTML(id)}${index < order.length - 1 ? hintHTML(id, order[index + 1]) : `<p class="eyebrow" style="margin-top:24px">这条小径，先到这里。</p>`}</section>`).join("")}</div><div class="page-controls"><p>原话留在这里，关系慢慢浮现。</p><div class="arrows"><button type="button" class="icon-button" data-action="prev-page" aria-label="翻回上一页">←</button><button type="button" class="icon-button" data-action="next-page" aria-label="翻到下一页">→</button></div></div>`;
}
function renderMap() {
  return `<div class="map-toolbar"><p>关系很近，原文也在身边。</p><div><button type="button" class="quiet-button" data-action="origin">回到起点</button><button type="button" class="quiet-button" data-action="overview" aria-pressed="false">看全貌</button></div></div><div class="map-viewport" tabindex="0" role="region" aria-label="原文关系地图，可横向和纵向滚动"><div class="map-sized"><div class="map-world"><svg class="map-lines" aria-hidden="true"></svg>${order.map((id, i) => `<div class="map-note ${i === 0 ? "is-origin" : ""}" data-map-id="${id}">${noteHTML(id)}<button type="button" class="center-note" data-action="center" data-id="${id}">居中阅读</button></div>`).join("")}<div class="map-bridge" data-edge="0">${hintHTML(order[0], order[1])}</div><div class="map-bridge" data-edge="1">${hintHTML(order[0], order[2])}</div><div class="map-bridge" data-edge="2">${hintHTML(order[1], order[3])}</div></div></div></div><div class="map-footer"><span>读完一篇，也可以停在这里。</span><div><button type="button" class="quiet-button" data-action="pan-left" aria-label="向左移动地图">←</button><button type="button" class="quiet-button" data-action="pan-right" aria-label="向右移动地图">→</button><button type="button" class="quiet-button" data-action="shuffle">换个起点 ↝</button></div></div>`;
}
function mount() {
  observer?.disconnect();
  stopped = false;
  pageIndex = 0;
  overview = false;
  hybridReturns = [];
  $("[data-action=hybrid-back]").hidden = true;
  experience.innerHTML = mode === "hybrid" ? renderHybrid() : mode === "flow" ? renderFlow() : mode === "pages" ? renderPages() : renderMap();
  if (mode === "pages") setupPages();
  if (mode === "map") layoutMap(true);
  observeNotes();
}
function observeNotes() {
  observer?.disconnect();
  observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting || overview) continue;
      const id = entry.target.dataset.note;
      if (!visited.includes(id)) visited.push(id);
    }
  }, { threshold: 0, rootMargin: "-10% 0px -20% 0px" });
  experience.querySelectorAll(".note[data-note]").forEach((node) => observer.observe(node));
}
function setMode(next) {
  mode = concepts[next] ? next : "flow";
  $(".app").dataset.mode = mode;
  $(".app-header [data-action=hybrid-map]").hidden = mode !== "hybrid";
  $("[data-action=trail]").hidden = mode === "hybrid";
  const c = concepts[mode];
  $("#concept-kicker").textContent = c.kicker;
  $("#concept-title").textContent = c.title;
  $("#concept-description").textContent = c.description;
  $("#try-instruction").textContent = c.instruction;
  $("#tradeoff").textContent = c.tradeoff;
  document.querySelectorAll("[data-mode]").forEach((a) => {
    if (a.dataset.mode === mode) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
  visited = [order[0]];
  mount();
}
function currentReadingNote() {
  const sightline = Math.min(innerHeight * .42, 340);
  const visible = [...experience.querySelectorAll(".stream-note")].filter((node) => node.getClientRects().length);
  return visible.reduce((best, node) => {
    const rect = node.getBoundingClientRect();
    const distance = rect.top <= sightline && rect.bottom >= sightline ? 0 : Math.min(Math.abs(rect.top - sightline), Math.abs(rect.bottom - sightline));
    return !best || distance < best.distance ? { node, distance } : best;
  }, null)?.node;
}
function openNearby(fromId) {
  if (stopped) resume();
  const node = fromId ? $(`.hybrid-stream [data-note="${fromId}"]`) : currentReadingNote();
  if (!node) return;
  nearbyOrigin = { id: node.dataset.note, node, top: node.getBoundingClientRect().top, scroll: window.scrollY, focus: document.activeElement, branchOpen: !$(".hybrid-branch").hidden };
  nearbyChoice = null;
  $("#nearby-description").textContent = `正在读${notes[nearbyOrigin.id].context}这篇。点一篇，直接回到原文。`;
  const positions = ["north", "west", "east", "south"];
  $("#nearby-nodes").innerHTML = order.map((id, index) => {
    const isCurrent = id === nearbyOrigin.id;
    const isBranch = index === 3;
    const label = isCurrent ? "正在读" : visited.includes(id) ? "经过这里" : isBranch ? "一条岔路" : "顺着小径";
    const excerpt = notes[id].paragraphs[0].slice(0, 43);
    return `<button type="button" class="nearby-node ${positions[index]} ${isCurrent ? "is-current" : ""}" data-action="hybrid-pick" data-id="${id}" ${isCurrent ? 'aria-current="location"' : ""} aria-label="${notes[id].context}：${notes[id].title}，${label}"><span class="nearby-node-meta"><time>${notes[id].date}</time><span>${notes[id].context}</span></span><span class="nearby-excerpt">${escapeHTML(excerpt)}${notes[id].paragraphs[0].length > 43 ? "…" : ""}</span><span class="nearby-node-state">${isCurrent ? '<span class="current-dot" aria-hidden="true"></span>' : ""}${label}<span aria-hidden="true">${isCurrent ? "" : "↗"}</span></span></button>`;
  }).join("");
  nearbyOverflow = document.documentElement.style.overflow;
  document.documentElement.style.overflow = "hidden";
  $("#nearby-dialog").showModal();
  drawNearbyLines();
}
function drawNearbyLines() {
  if (!$("#nearby-dialog").open) return;
  const rect = $(".nearby-map").getBoundingClientRect();
  const svg = $(".nearby-lines");
  svg.setAttribute("viewBox", `0 0 ${rect.width} ${rect.height}`);
  const center = (id) => { const r = $(`.nearby-node[data-id="${id}"]`).getBoundingClientRect(); return { x: r.x - rect.x + r.width / 2, y: r.y - rect.y + r.height / 2 }; };
  svg.innerHTML = links.map((edge) => {
    const a = center(edge.a), b = center(edge.b);
    const main = order.slice(0, 2).some((id, i) => (id === edge.a && order[i + 1] === edge.b) || (id === edge.b && order[i + 1] === edge.a));
    return `<path class="${main ? "main-path" : "side-path-line"}" d="M${a.x} ${a.y} L${b.x} ${b.y}"/>`;
  }).join("");
}
function setHybridBranch(open) {
  $(".hybrid-branch").hidden = !open;
  const main = $("[data-main-connection]");
  const branch = $("[data-branch-connection]");
  if (main) main.hidden = open;
  if (branch) branch.hidden = !open;
}
function restoreReading(point) {
  setHybridBranch(point.branchOpen);
  const top = point.node.getBoundingClientRect().top + window.scrollY - point.top;
  window.scrollTo({ top, behavior: "instant" });
  const focus = point.focus?.isConnected ? point.focus : point.node;
  if (focus === point.node) focus.setAttribute("tabindex", "-1");
  focus.focus({ preventScroll: true });
}
$("#nearby-dialog").addEventListener("close", () => {
  document.documentElement.style.overflow = nearbyOverflow;
  if (!nearbyOrigin) return;
  const id = nearbyChoice;
  if (!id || id === nearbyOrigin.id) restoreReading(nearbyOrigin);
  else {
    hybridReturns.push(nearbyOrigin);
    const target = $(`.hybrid-stream [data-note="${id}"]`);
    if (target.closest(".hybrid-branch")) setHybridBranch(true);
    $("[data-action=hybrid-back]").hidden = false;
    target.setAttribute("tabindex", "-1");
    target.scrollIntoView({ behavior: "instant", block: "start" });
    target.focus({ preventScroll: true });
    if (!visited.includes(id)) visited.push(id);
    announce(`已回到${notes[id].context}的原文，可以直接接着读。`);
  }
  nearbyOrigin = null;
  nearbyChoice = null;
});
$("#nearby-dialog").addEventListener("click", (event) => {
  if (event.target !== event.currentTarget) return;
  const rect = event.currentTarget.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) event.currentTarget.close();
});
function scrollToNote(id) {
  if (stopped) resume();
  if (mode === "map") centerMap(id);
  else if (mode === "pages") flipTo(order.indexOf(id));
  else {
    const note = $(`[data-note="${id}"]`, experience);
    if (note) {
      const branch = note.closest(".side-path");
      if (branch) branch.open = true;
      note.scrollIntoView({ behavior: motion(), block: "center" });
      note.setAttribute("tabindex", "-1");
      note.focus({ preventScroll: true });
    }
  }
}
function setupPages() {
  const book = $(".page-book");
  const update = () => {
    const sheets = [...book.querySelectorAll(".page-sheet")];
    const step = sheets[1].offsetLeft - sheets[0].offsetLeft;
    pageIndex = Math.round(book.scrollLeft / step);
    $("[data-action=prev-page]").disabled = book.scrollLeft < 3;
    $("[data-action=next-page]").disabled = book.scrollLeft >= book.scrollWidth - book.clientWidth - 3;
  };
  book.addEventListener("scroll", update, { passive: true });
  book.addEventListener("keydown", (event) => {
    if (event.target !== book || !["ArrowRight", "ArrowLeft"].includes(event.key)) return;
    event.preventDefault();
    flipTo(pageIndex + (event.key === "ArrowRight" ? 1 : -1));
  });
  update();
}
function flipTo(index) {
  const book = $(".page-book");
  const sheets = [...book.querySelectorAll(".page-sheet")];
  const step = sheets[1].offsetLeft - sheets[0].offsetLeft;
  book.scrollTo({ left: Math.max(0, Math.min(sheets.length - 1, index)) * step, behavior: motion() });
}
function layoutMap(reset = false) {
  if (mode !== "map" || stopped) return;
  const cards = [...experience.querySelectorAll(".map-note")];
  const width = cards[0].offsetWidth;
  const positions = [{ x: 40, y: 90 }, { x: width + 260, y: 45 }, { x: width + 260, y: 110 + cards[1].offsetHeight }, { x: width * 2 + 480, y: 105 }];
  const worldHeight = Math.max(...cards.map((c, i) => positions[i].y + c.offsetHeight)) + 110;
  const worldWidth = positions[3].x + width + 80;
  const world = $(".map-world");
  world.style.width = `${worldWidth}px`;
  world.style.height = `${worldHeight}px`;
  cards.forEach((c, i) => { c.style.left = `${positions[i].x}px`; c.style.top = `${positions[i].y}px`; });
  const edges = [[0, 1], [0, 2], [1, 3]];
  $(".map-lines").innerHTML = edges.map(([from, to], i) => {
    const a = { x: positions[from].x + width, y: positions[from].y + Math.min(cards[from].offsetHeight / 2, 210) };
    const b = { x: positions[to].x, y: positions[to].y + Math.min(cards[to].offsetHeight / 2, 210) };
    const label = $(`[data-edge="${i}"]`);
    label.style.left = `${a.x + 23}px`;
    label.style.top = `${(a.y + b.y) / 2 - 40}px`;
    return `<path d="M${a.x} ${a.y} C${a.x + 110} ${a.y},${b.x - 110} ${b.y},${b.x} ${b.y}" />`;
  }).join("");
  $(".map-lines").style.width = `${worldWidth}px`;
  $(".map-lines").style.height = `${worldHeight}px`;
  const viewport = $(".map-viewport");
  const scale = overview ? Math.min(viewport.clientWidth / worldWidth, viewport.clientHeight / worldHeight, 1) : 1;
  world.style.transform = `scale(${scale})`;
  $(".map-sized").style.width = `${worldWidth * scale}px`;
  $(".map-sized").style.height = `${worldHeight * scale}px`;
  viewport.classList.toggle("map-overview", overview);
  if (reset || overview) viewport.scrollTo({ left: 0, top: 0, behavior: "instant" });
}
function centerMap(id) {
  if (overview) {
    overview = false;
    $("[data-action=overview]").textContent = "看全貌";
    $("[data-action=overview]").setAttribute("aria-pressed", "false");
    layoutMap();
  }
  const card = $(`[data-map-id="${id}"]`);
  const viewport = $(".map-viewport");
  viewport.scrollTo({ left: card.offsetLeft - (viewport.clientWidth - card.offsetWidth) / 2, top: card.offsetTop - 28, behavior: motion() });
  if (!visited.includes(id)) visited.push(id);
}
function resume() {
  experience.replaceChildren(previousView);
  stopped = false;
  if (mode === "map") layoutMap();
  observeNotes();
  window.scrollTo({ top: previousScroll, behavior: "instant" });
  experience.focus({ preventScroll: true });
}
document.addEventListener("click", (event) => {
  const control = event.target.closest("[data-action]");
  if (!control || control.disabled) return;
  const action = control.dataset.action;
  if (action === "hybrid-map") openNearby(control.dataset.from);
  else if (action === "hybrid-close") $("#nearby-dialog").close();
  else if (action === "hybrid-pick") { nearbyChoice = control.dataset.id; $("#nearby-dialog").close(); }
  else if (action === "hybrid-back") {
    const point = hybridReturns.pop();
    if (point) restoreReading(point);
    control.hidden = hybridReturns.length === 0;
    announce("已回到刚才的位置。");
  } else if (action === "shuffle") {
    order = order[0] === "love" ? ["work", "friend", "family", "love"] : ["love", "family", "friend", "work"];
    visited = [order[0]];
    mount();
    experience.scrollIntoView({ behavior: motion(), block: "start" });
    experience.focus({ preventScroll: true });
    announce("已换一个起点，原文已经在这里。");
  } else if (action === "trail") {
    $("#trail-list").innerHTML = visited.map((id) => `<li><button type="button" data-action="jump" data-id="${id}"><time>${notes[id].date} · ${notes[id].context}</time>${notes[id].title}</button></li>`).join("");
    $("#trail-dialog").showModal();
  } else if (action === "close-trail") $("#trail-dialog").close();
  else if (action === "jump") { $("#trail-dialog").close(); scrollToNote(control.dataset.id); }
  else if (action === "prev-page") flipTo(pageIndex - 1);
  else if (action === "next-page") flipTo(pageIndex + 1);
  else if (action === "origin") centerMap(order[0]);
  else if (action === "center") centerMap(control.dataset.id);
  else if (action === "pan-left" || action === "pan-right") $(".map-viewport").scrollBy({ left: (action === "pan-right" ? 1 : -1) * 330, behavior: motion() });
  else if (action === "overview") {
    overview = !overview;
    control.textContent = overview ? "回到原文" : "看全貌";
    control.setAttribute("aria-pressed", String(overview));
    layoutMap();
  } else if (action === "dismiss-hint") {
    const holder = control.closest(".hint-holder");
    holder.savedHint = holder.innerHTML;
    holder.innerHTML = '<div class="hint-hidden">已收起提示，原文仍在这里。<button type="button" data-action="undo-hint">撤销</button></div>';
    $("button", holder).focus({ preventScroll: true });
    announce("已收起这条提示。可以撤销。");
  } else if (action === "undo-hint") {
    const holder = control.closest(".hint-holder");
    holder.innerHTML = holder.savedHint;
    $("summary", holder).focus({ preventScroll: true });
  } else if (action === "stop" && !stopped) {
    previousScroll = window.scrollY;
    previousView = document.createDocumentFragment();
    while (experience.firstChild) previousView.append(experience.firstChild);
    observer?.disconnect();
    stopped = true;
    experience.innerHTML = '<div class="stopped"><span class="twig" aria-hidden="true">⌁</span><h2>今天，就停在这里。</h2><p>不需要得出什么结论。<br />刚才读到的，已经是一场相遇。</p><button type="button" class="outline-button" data-action="resume">回到刚才</button></div>';
    experience.scrollIntoView({ behavior: motion(), block: "start" });
    $("[data-action=resume]").focus({ preventScroll: true });
  } else if (action === "resume") resume();
});
$("#long-note").addEventListener("change", (event) => { longNote = event.target.checked; mount(); announce(longNote ? "已切换为长记录场景，正文无需展开。" : "已恢复短记录场景。"); });
window.addEventListener("hashchange", () => setMode(location.hash.slice(1)));
window.addEventListener("resize", () => { if (mode === "map") layoutMap(); drawNearbyLines(); });
setMode(location.hash.slice(1));
