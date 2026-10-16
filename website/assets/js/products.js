/* Products page: search, category filter with a gliding pill, and the quote list (kept in this browser). */
(function () {
  const CAT = window.TRIUMPH_CATALOGUE;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const grid = $("[data-grid]");
  const filters = $("[data-filters]");
  const search = $("[data-search]");
  const pill = $(".nav-pill", filters);
  const basketEl = $("[data-basket]");
  const countEl = $("[data-basket-count]");
  const catName = Object.fromEntries(CAT.categories.map((c) => [c.id, c]));

  let basket = [];
  try {
    basket = JSON.parse(localStorage.getItem("triumph-basket") || "[]");
  } catch (e) {}
  const save = () => {
    try {
      localStorage.setItem("triumph-basket", JSON.stringify(basket));
    } catch (e) {}
  };

  let cat = (location.hash || "").slice(1);
  if (!catName[cat]) cat = "";

  filters.insertAdjacentHTML(
    "beforeend",
    `<button data-c="" aria-pressed="${!cat}">All</button>` + CAT.categories.map((c) => `<button data-c="${c.id}" aria-pressed="${cat === c.id}">${esc(c.name)}</button>`).join(""),
  );

  const placePill = (instant) => {
    const b = $('button[aria-pressed="true"]', filters);
    if (!b) return;
    if (instant) pill.style.transition = "none";
    pill.style.setProperty("--x", `${b.offsetLeft}px`);
    pill.style.setProperty("--w", `${b.offsetWidth}px`);
    pill.style.setProperty("--o", 1);
    pill.style.top = `${b.offsetTop}px`;
    pill.style.height = `${b.offsetHeight}px`;
    if (instant) requestAnimationFrame(() => (pill.style.transition = ""));
    const left = b.offsetLeft - filters.clientWidth / 2 + b.offsetWidth / 2;
    filters.scrollTo({ left, behavior: instant ? "auto" : "smooth" });
  };

  function render() {
    const q = (search.value || "").trim().toLowerCase();
    const list = CAT.items.filter((x) => (!cat || x.c === cat) && (!q || `${x.n} ${x.d} ${catName[x.c].name}`.toLowerCase().includes(q)));
    grid.innerHTML = list.length
      ? list
          .map((x, i) => {
            const inB = basket.includes(x.n);
            return `<article class="item" style="--d:${Math.min(i, 16)}">
            <div class="ph"><img data-img="${x.img}" data-w="560" data-sizes="(max-width: 640px) 100vw, 300px" alt="" loading="lazy"/></div>
            <div class="item-body">
              <small class="cat">${esc(catName[x.c].name)}</small>
              <h3>${esc(x.n)}</h3>
              <p>${esc(x.d)}</p>
              <button class="btn btn-ghost btn-sm add${inB ? " added" : ""}" data-add="${esc(x.n)}" aria-pressed="${inB}">${inB ? "Added ✓" : "Add to quote"}</button>
            </div>
          </article>`;
          })
          .join("")
      : `<p class="empty">Nothing matches “${esc(search.value)}”. We source on request, so <a class="grad-text" href="/#quote"><b>ask us for it</b></a>.</p>`;
    window.TRIUMPH_REVEAL && window.TRIUMPH_REVEAL(grid);
  }

  function updateBasket(bump) {
    countEl.textContent = basket.length;
    basketEl.classList.toggle("show", basket.length > 0);
    if (bump) {
      countEl.classList.remove("bump");
      void countEl.offsetWidth;
      countEl.classList.add("bump");
    }
  }

  filters.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    cat = b.dataset.c;
    $$("button", filters).forEach((x) => x.setAttribute("aria-pressed", x === b));
    placePill();
    history.replaceState(null, "", cat ? `#${cat}` : location.pathname);
    render();
  });

  let t;
  search.addEventListener("input", () => {
    clearTimeout(t);
    // A search looks through every category.
    if (search.value.trim() && cat) {
      cat = "";
      $$("button", filters).forEach((x) => x.setAttribute("aria-pressed", x.dataset.c === ""));
      placePill();
      history.replaceState(null, "", location.pathname);
    }
    t = setTimeout(render, 120);
  });

  grid.addEventListener("click", (e) => {
    const b = e.target.closest("[data-add]");
    if (!b) return;
    const n = b.dataset.add;
    const has = basket.includes(n);
    basket = has ? basket.filter((x) => x !== n) : [...basket, n];
    save();
    b.classList.toggle("added", !has);
    b.setAttribute("aria-pressed", !has);
    b.textContent = has ? "Add to quote" : "Added ✓";
    updateBasket(true);
    window.TRIUMPH_TOAST && window.TRIUMPH_TOAST(has ? `Removed ${n}` : `${n} added to your quote list`);
  });

  $("[data-basket-clear]").addEventListener("click", () => {
    basket = [];
    save();
    updateBasket();
    render();
  });

  addEventListener("hashchange", () => {
    const h = location.hash.slice(1);
    const b = $(`button[data-c="${catName[h] ? h : ""}"]`, filters);
    b && b.click();
  });
  addEventListener("resize", () => placePill(true));

  render();
  updateBasket();
  requestAnimationFrame(() => placePill(true));
  document.fonts && document.fonts.ready.then(() => placePill(true));
})();
