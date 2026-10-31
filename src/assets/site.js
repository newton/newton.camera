// Home: pointing at a name brings its work onto the stage.
// Record pages: images fade in once loaded, the corner counter follows the scroll,
// plates / contact sheet switch, and the full-screen viewer. No dependencies.
(() => {
  // Home stage
  const stageImgs = document.querySelectorAll(".stage-img");
  document.querySelectorAll("[data-stage]").forEach((a) => {
    const on = () => stageImgs.forEach((img) => img.classList.toggle("is-on", img.dataset.for === a.dataset.stage));
    a.addEventListener("mouseenter", on);
    a.addEventListener("focus", on);
  });

  // Fade each plate in once its pixels have arrived
  document.querySelectorAll(".plate-img img").forEach((img) => {
    const done = () => img.classList.add("is-loaded");
    if (img.complete && img.naturalWidth) done(); else img.addEventListener("load", done, { once: true });
  });

  // Corner counter
  const counter = document.querySelector(".counter");
  if (counter && "IntersectionObserver" in window) {
    const total = counter.dataset.total;
    const io = new IntersectionObserver((entries) => entries.forEach((e) => {
      if (e.isIntersecting) counter.textContent = `${e.target.id.replace("plate-", "")} / ${total}`;
    }), { rootMargin: "-45% 0px -45% 0px" });
    document.querySelectorAll(".plate").forEach((p) => io.observe(p));
  }

  // View switch
  const views = document.querySelectorAll("[data-view]");
  const links = document.querySelectorAll("[data-view-link]");
  const setView = (v) => {
    views.forEach((el) => (el.hidden = el.dataset.view !== v));
    links.forEach((a) => a.setAttribute("aria-current", String(a.dataset.viewLink === v)));
  };
  links.forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); setView(a.dataset.viewLink); history.replaceState(null, "", a.hash); }));
  if (location.hash === "#contact-sheet") setView("sheet");

  // Viewer
  const box = document.querySelector(".lightbox");
  const plateLinks = document.querySelectorAll(".plate-img");
  if (!box || !plateLinks.length) return;
  const items = [...plateLinks].map((a) => {
    const im = a.querySelector("img");
    return { src: a.href, srcset: im.getAttribute("srcset"), w: im.width, h: im.height, title: a.dataset.title, caption: a.dataset.caption };
  });
  const img = box.querySelector("img");
  const cap = box.querySelector(".lb-caption");
  let i = 0, opener = null;

  const show = (n) => {
    i = (n + items.length) % items.length;
    const it = items[i];
    img.src = it.src; img.srcset = it.srcset; img.sizes = "100vw";
    img.width = it.w; img.height = it.h;
    img.alt = it.title || `Plate ${i + 1}`;
    cap.textContent = [`${i + 1} of ${items.length}`, it.title, it.caption].filter(Boolean).join(". ");
  };
  const open = (n, from) => { opener = from; box.hidden = false; document.body.style.overflow = "hidden"; show(n); box.querySelector(".lb-close").focus(); };
  const close = () => { box.hidden = true; document.body.style.overflow = ""; opener?.focus(); };

  document.querySelectorAll("[data-lightbox]").forEach((a) =>
    a.addEventListener("click", (e) => { e.preventDefault(); open(+a.dataset.index, a); }));
  box.querySelector(".lb-close").addEventListener("click", close);
  box.querySelector(".lb-prev").addEventListener("click", () => show(i - 1));
  box.querySelector(".lb-next").addEventListener("click", () => show(i + 1));
  img.addEventListener("click", () => show(i + 1));
  document.addEventListener("keydown", (e) => {
    if (box.hidden) return;
    if (e.key === "Escape") close();
    if (e.key === "ArrowRight") show(i + 1);
    if (e.key === "ArrowLeft") show(i - 1);
    if (e.key === "Tab") {
      const f = [...box.querySelectorAll("button")];
      const k = f.indexOf(document.activeElement);
      e.preventDefault(); f[(k + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus();
    }
  });
  let x0 = null;
  box.addEventListener("touchstart", (e) => (x0 = e.touches[0].clientX), { passive: true });
  box.addEventListener("touchend", (e) => {
    if (x0 === null) return;
    const dx = e.changedTouches[0].clientX - x0;
    if (Math.abs(dx) > 40) show(i + (dx < 0 ? 1 : -1));
    x0 = null;
  });
})();
