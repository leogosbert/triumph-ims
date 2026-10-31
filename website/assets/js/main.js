/* TRIUMPH website: layout, content from config/catalogue, and all the small interactions. */
(function () {
  const C = window.TRIUMPH || { contact: {}, media: {}, img: {} };
  const CAT = window.TRIUMPH_CATALOGUE || { categories: [], items: [] };
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const finePointer = matchMedia("(hover: hover) and (pointer: fine)").matches;
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const icon = (n) => `<svg aria-hidden="true"><use href="#i-${n}"/></svg>`;

  /** Photo URL at a sensible size (Pexels resizes on the fly; local files are used as they are). */
  function photo(key, w = 900) {
    const url = C.img[key] || key;
    if (!url) return "";
    if (/images\.pexels\.com/.test(url)) return `${url.split("?")[0]}?auto=compress&cs=tinysrgb&w=${w}`;
    return url;
  }
  window.TRIUMPH_PHOTO = photo;

  /* Phones: no pinch zoom. The viewport tag covers Android; iPhone Safari ignores it for pinch, so stop it here.
     One finger still scrolls. Double-tap zoom is off in site.css (touch-action: manipulation). */
  ["gesturestart", "gesturechange", "gestureend"].forEach((t) => document.addEventListener(t, (e) => e.preventDefault(), { passive: false }));
  document.addEventListener("touchmove", (e) => { if (e.touches.length > 1 && e.cancelable) e.preventDefault(); }, { passive: false });

  function wireImg(img) {
    if (img.dataset.wired) return;
    img.dataset.wired = "1";
    const ph = img.closest(".ph, .page-hero-bg");
    img.addEventListener("error", () => ph && ph.classList.add("no-img"));
    if (img.dataset.img) {
      const w = Number(img.dataset.w || 900);
      img.src = photo(img.dataset.img, w);
      img.srcset = `${photo(img.dataset.img, Math.round(w / 2))} ${Math.round(w / 2)}w, ${photo(img.dataset.img, w)} ${w}w, ${photo(img.dataset.img, w * 2)} ${w * 2}w`;
      img.sizes = img.dataset.sizes || "(max-width: 640px) 100vw, 50vw";
    }
  }

  /* ---------- Loader ---------- */
  // The intro plays once per visit; moving between pages skips it.
  const root = document.documentElement;
  const loader = $(".loader");
  const hideLoader = () => loader && loader.classList.add("done");
  if (root.classList.contains("seen")) hideLoader();
  window.addEventListener("load", () => setTimeout(hideLoader, 250));
  setTimeout(hideLoader, 2600);
  try {
    sessionStorage.setItem("t-seen", "1");
  } catch (e) {}

  const yr = $("[data-year]");
  if (yr) yr.textContent = new Date().getFullYear();

  /* ---------- Contact details from config ---------- */
  const ct = C.contact || {};
  const wa = (ct.whatsapp || "").replace(/\D/g, "");
  const setRow = (key, text, href) => {
    const row = $(`[data-contact="${key}"]`);
    if (!row || !text) return;
    row.hidden = false;
    const a = $("a", row);
    const span = $("span:not(.ico)", row);
    if (a && href) {
      a.href = href;
      if (key !== "whatsapp") a.textContent = text;
    } else if (span) span.textContent = text;
  };
  setRow("phone", ct.phone, ct.phone ? `tel:${ct.phone.replace(/[^\d+]/g, "")}` : "");
  setRow("email", ct.email, ct.email ? `mailto:${ct.email}` : "");
  setRow("whatsapp", wa ? "WhatsApp" : "", wa ? `https://wa.me/${wa}` : "");
  setRow("address", ct.address);
  setRow("hours", ct.hours);
  const fabWa = $("[data-wa]");
  if (fabWa && wa) {
    fabWa.hidden = false;
    fabWa.href = `https://wa.me/${wa}?text=${encodeURIComponent("Hello TRIUMPH, I would like a quote for ")}`;
  } else document.body.classList.add("no-wa");
  const map = $("[data-map]");
  if (map && ct.mapQuery) {
    map.innerHTML = `<iframe title="Map" loading="lazy" referrerpolicy="no-referrer-when-downgrade" style="width:100%;height:220px;border:0;border-radius:18px;filter:saturate(.8) hue-rotate(-10deg)" src="https://www.google.com/maps?q=${encodeURIComponent(ct.mapQuery)}&output=embed"></iframe>`;
  }
  const fc = $("[data-footer-contact]");
  if (fc) {
    if (ct.phone) fc.insertAdjacentHTML("afterbegin", `<li><a href="tel:${esc(ct.phone.replace(/[^\d+]/g, ""))}">${esc(ct.phone)}</a></li>`);
    if (ct.email) fc.insertAdjacentHTML("afterbegin", `<li><a href="mailto:${esc(ct.email)}">${esc(ct.email)}</a></li>`);
    if (ct.address) fc.insertAdjacentHTML("beforeend", `<li>${esc(ct.address)}</li>`);
  }
  const soc = $("[data-socials]");
  if (soc) {
    ["linkedin", "instagram", "facebook"].forEach((k) => {
      if (ct[k]) soc.insertAdjacentHTML("beforeend", `<a class="btn btn-glass" style="padding:10px" href="${esc(ct[k])}" target="_blank" rel="noopener" aria-label="${k}">${icon(k)}</a>`);
    });
  }

  /* ---------- Supply cards ---------- */
  const cards = $("[data-supply-cards]");
  if (cards) {
    const blurbs = {
      chemicals: "Process, water-treatment and cleaning chemicals with full safety data sheets.",
      lubricants: "Engine, hydraulic, gear and compressor oils and greases from trusted brands.",
      spares: "Bearings, seals, belts, pumps, valves and filters to keep plant running.",
      ppe: "Helmets, boots, gloves, coveralls and fall protection for every worker.",
      electrical: "Cables, motors, switchgear and industrial lighting.",
      tools: "Hand and power tools, welding supplies, abrasives and lifting gear.",
      general: "Office, cleaning, packaging and building materials in one order.",
    };
    cards.innerHTML = CAT.categories
      .map((c, i) => {
        const items = CAT.items.filter((x) => x.c === c.id);
        return `<a class="supply tilt reveal" style="--d:${i % 3}" href="/products.html#${c.id}">
          <span class="tag">${icon(c.icon)}</span>
          <div class="ph"><img data-img="${c.img}" data-w="700" data-sizes="(max-width: 640px) 100vw, 33vw" alt="" loading="lazy"/></div>
          <div class="supply-body">
            <h3>${esc(c.name)}</h3>
            <p>${esc(blurbs[c.id] || "")}</p>
            <ul class="ticks">${items.slice(0, 4).map((x) => `<li>${esc(x.n)}</li>`).join("")}</ul>
            <span class="more">${items.length} product ranges ${icon("arrow")}</span>
          </div>
        </a>`;
      })
      .join("") +
      `<a class="supply supply-cta reveal" style="--d:1" href="/contact.html">
        <div class="supply-body">
          <span class="tag" style="position:static;margin-bottom:18px">${icon("search")}</span>
          <h3>Can't see what you need?</h3>
          <p>Sourcing is our job. Send us a part number, brand or specification and we will find it, locally or abroad.</p>
          <span class="more">Ask us to source it ${icon("arrow")}</span>
        </div>
      </a>`;
  }

  /* ---------- Industries ---------- */
  const IND = [
    { id: "mining", name: "Mining", sub: "Gold, coal and minerals", icon: "pick", img: "mining", text: "Open-pit and underground mines run hard, around the clock. We keep fleets, crushers and processing plants supplied.", ticks: ["Heavy-duty lubricants", "Crusher & pump spares", "Mining reagents", "PPE for every shift", "Filters & seals"] },
    { id: "sugar", name: "Sugar processing", sub: "Estates and mills", icon: "leaf", img: "sugar", text: "Crushing season leaves no room for delays. We stock up mills ahead of time and react fast during the campaign.", ticks: ["Process chemicals", "Lime & flocculants", "Mill bearings & chains", "Food-grade lubricants", "Boiler water treatment"] },
    { id: "oilgas", name: "Oil & gas", sub: "Upstream and downstream", icon: "flame", img: "refinery", text: "Strict specifications and safety rules. We supply documented, certified products for plants, depots and pipelines.", ticks: ["Valves & fittings", "Gaskets & seals", "Flame-retardant PPE", "Turbine & compressor oils", "Explosion-proof lighting"] },
    { id: "cement", name: "Cement", sub: "Kilns, mills and quarries", icon: "factory", img: "cement", text: "Abrasive dust and high heat wear plant out fast. We supply the parts and lubricants that last.", ticks: ["Kiln & mill lubricants", "Grinding aids", "Conveyor belts & idlers", "Dust masks & respirators", "Gearbox parts"] },
    { id: "manufacturing", name: "Manufacturing", sub: "Factories and plants", icon: "gear", img: "gears", text: "Production lines need steady supply of spares, consumables and safety gear. We keep them coming.", ticks: ["Motors & drives", "Bearings & belts", "Cleaning chemicals", "Tools & consumables", "Packaging"] },
    { id: "construction", name: "Construction", sub: "Sites and contractors", icon: "crane", img: "ppe", text: "From site set-up to handover, we supply materials, tools and PPE so the work never waits.", ticks: ["Building materials", "Lifting equipment", "Power tools", "Safety boots & helmets", "Fuel & lubricants"] },
  ];
  const tabs = $("[data-ind-tabs]");
  const stage = $("[data-ind-stage]");
  if (tabs && stage) {
    tabs.innerHTML = IND.map((x, i) => `<button class="ind-tab" role="tab" id="tab-${x.id}" aria-controls="pan-${x.id}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}"><span class="ico">${icon(x.icon)}</span><span><b>${esc(x.name)}</b><small>${esc(x.sub)}</small></span></button>`).join("");
    stage.innerHTML = IND.map(
      (x, i) => `<div class="ind-panel${i === 0 ? " on" : ""}" role="tabpanel" id="pan-${x.id}" aria-labelledby="tab-${x.id}">
        <div class="ph"><img data-img="${x.img}" data-w="1400" data-sizes="(max-width: 1080px) 100vw, 70vw" alt="" loading="lazy"/></div>
        <div class="glass-card ind-info"><h3>${esc(x.name)}</h3><p>${esc(x.text)}</p><ul class="ticks">${x.ticks.map((t) => `<li>${esc(t)}</li>`).join("")}</ul></div>
      </div>`,
    ).join("");
    let cur = 0;
    let timer;
    const show = (i, focus) => {
      cur = (i + IND.length) % IND.length;
      $$(".ind-tab", tabs).forEach((t, j) => {
        t.setAttribute("aria-selected", j === cur);
        t.tabIndex = j === cur ? 0 : -1;
      });
      $$(".ind-panel", stage).forEach((p, j) => p.classList.toggle("on", j === cur));
      const t = $$(".ind-tab", tabs)[cur];
      if (focus) t.focus();
      if (getComputedStyle(tabs).display === "flex") tabs.scrollTo({ left: t.offsetLeft - 8, behavior: reduced ? "auto" : "smooth" });
    };
    const auto = () => {
      clearInterval(timer);
      if (!reduced) timer = setInterval(() => show(cur + 1), 6500);
    };
    tabs.addEventListener("click", (e) => {
      const b = e.target.closest(".ind-tab");
      if (!b) return;
      show($$(".ind-tab", tabs).indexOf(b));
      clearInterval(timer);
    });
    tabs.addEventListener("keydown", (e) => {
      if (["ArrowDown", "ArrowRight"].includes(e.key)) (e.preventDefault(), show(cur + 1, true));
      if (["ArrowUp", "ArrowLeft"].includes(e.key)) (e.preventDefault(), show(cur - 1, true));
      clearInterval(timer);
    });
    new IntersectionObserver((en) => en.forEach((x) => (x.isIntersecting ? auto() : clearInterval(timer))), { threshold: 0.3 }).observe(stage);
  }

  /* ---------- Video reel + lightbox ---------- */
  const reel = $("[data-reel]");
  const reelItems = (C.media && C.media.reel) || [];
  if (reel && reelItems.length) {
    const tile = (r, i, main) => `<button class="${main ? "reel-main" : "reel-item"} reveal${main ? " left" : " right"}" style="--d:${i}" data-video="${esc(r.video)}" aria-label="Play video: ${esc(r.title)}">
        <img src="${esc(r.poster)}" alt="" loading="lazy" onerror="this.style.opacity=0"/>
        ${finePointer ? `<video muted loop playsinline preload="none" data-preview="${esc(r.video)}"></video>` : ""}
        <span class="shade"></span>
        <span class="play">${icon("play")}</span>
        <span class="cap"><b>${esc(r.title)}</b><small>${esc(r.note || "")}</small></span>
      </button>`;
    reel.innerHTML = tile(reelItems[0], 0, true) + `<div class="reel-side">${reelItems.slice(1).map((r, i) => tile(r, i + 1, false)).join("")}</div>`;
    // Hover preview on laptops: the clip starts playing quietly under the cursor.
    $$("[data-preview]", reel).forEach((v) => {
      const b = v.closest("button");
      b.addEventListener("mouseenter", () => {
        if (!v.src) v.src = v.dataset.preview;
        v.play().catch(() => {});
      });
      b.addEventListener("mouseleave", () => v.pause());
    });
  }
  /* ---------- Photo wall (Gallery page) ---------- */
  const photos = $("[data-photos]");
  if (photos) {
    const PICS = [
      ["mining", "Open-pit mining"], ["drums", "Lubricant drums ready for dispatch"], ["sugar", "Sugar cane harvest"],
      ["engineer", "Engineer on site"], ["refinery", "Refinery at dusk"], ["bearings", "Bearings and mechanical spares"],
      ["cement", "Cement plant"], ["helmet", "Safety first"], ["tanks", "Storage tanks"], ["warehouse", "Warehouse stock"],
      ["mechanic", "Maintenance crew"], ["truck", "Delivery to site"],
    ].filter(([k]) => C.img[k]);
    photos.innerHTML = PICS.map(
      ([k, cap], i) => `<button class="photo reveal" style="--d:${i % 4}" data-zoom="${k}" data-cap="${esc(cap)}" aria-label="View photo: ${esc(cap)}">
        <span class="ph"><img data-img="${k}" data-w="700" data-sizes="(max-width: 640px) 50vw, 25vw" alt="${esc(cap)}" loading="lazy"/></span>
        <span class="cap">${esc(cap)}</span>
      </button>`,
    ).join("");
  }

  const lb = $("[data-lightbox]");
  if (lb) {
    const v = $("video", lb);
    const fig = $("figure", lb);
    const close = () => {
      lb.classList.remove("open");
      v.pause();
      document.body.style.overflow = "";
    };
    document.addEventListener("click", (e) => {
      const b = e.target.closest("[data-video], [data-zoom]");
      if (!b) return;
      const isPhoto = !!b.dataset.zoom;
      v.hidden = isPhoto;
      if (fig) fig.hidden = !isPhoto;
      lb.setAttribute("aria-label", isPhoto ? "Photo" : "Video");
      if (isPhoto) {
        v.pause();
        $("img", fig).src = photo(b.dataset.zoom, 1800);
        $("img", fig).alt = b.dataset.cap || "";
        $("figcaption", fig).textContent = b.dataset.cap || "";
      } else {
        v.src = b.dataset.video;
        v.play().catch(() => {});
      }
      lb.classList.add("open");
      document.body.style.overflow = "hidden";
      $(".lightbox-close", lb).focus();
    });
    lb.addEventListener("click", (e) => (e.target === lb || e.target.closest(".lightbox-close")) && close());
    document.addEventListener("keydown", (e) => e.key === "Escape" && lb.classList.contains("open") && close());
  }

  /* ---------- Hero media ---------- */
  const hp = $("[data-hero-poster]");
  const hv = $("[data-hero-video]");
  const hero = C.media && C.media.hero;
  if (hp && hero) {
    hp.addEventListener("load", () => hp.classList.add("on"));
    hp.src = hero.poster;
    const conn = navigator.connection || {};
    const okForVideo = hv && hero.video && !reduced && !conn.saveData && !/(^|-)2g$/.test(conn.effectiveType || "") && innerWidth >= 760;
    if (okForVideo) {
      hv.addEventListener("playing", () => {
        hv.classList.add("on");
        hp.classList.remove("on");
      });
      setTimeout(() => {
        hv.src = hero.video;
        hv.play().catch(() => {});
      }, 900);
    }
  }

  /* ---------- Quote form: categories + basket from the Products page ---------- */
  const checks = $("[data-cat-checks]");
  // The category boxes are written in the HTML (not here) so Netlify Forms sees the field and keeps it.
  let basket = [];
  try {
    basket = JSON.parse(localStorage.getItem("triumph-basket") || "[]");
  } catch (e) {}
  const note = $("[data-basket-note]");
  const field = $("[data-basket-field]");
  if (note && field && basket.length) {
    note.classList.add("show");
    note.innerHTML = `<b>${basket.length} product range${basket.length > 1 ? "s" : ""} from the catalogue:</b> ${basket.map(esc).join(", ")}`;
    field.value = basket.join("; ");
    const cats = new Set(basket.map((n) => (CAT.items.find((x) => x.n === n) || {}).c));
    $$("input[name=categories]", checks).forEach((i) => {
      const c = CAT.categories.find((x) => x.name === i.value);
      if (c && cats.has(c.id)) i.checked = true;
    });
  }
  const form = $("form[name=quote]");
  if (form) form.addEventListener("submit", () => {
    try {
      localStorage.removeItem("triumph-basket");
    } catch (e) {}
  });

  /* ---------- Images ---------- */
  $$("img[data-img], .ph img").forEach(wireImg);

  /* ---------- Reveal on scroll ---------- */
  const io = new IntersectionObserver(
    (en) =>
      en.forEach((x) => {
        if (x.isIntersecting) {
          x.target.classList.add("in");
          io.unobserve(x.target);
        }
      }),
    { threshold: 0.12, rootMargin: "0px 0px -6% 0px" },
  );
  // A fast flick can skip past an element between two frames, so scrolling also reveals anything already passed.
  let pending = [];
  const watch = (el) => {
    io.observe(el);
    pending.push(el);
  };
  const sweep = () => {
    if (!pending.length) return;
    const lim = innerHeight * 0.94;
    pending = pending.filter((el) => {
      if (el.classList.contains("in")) return false;
      if (el.getBoundingClientRect().top < lim) {
        el.classList.add("in");
        io.unobserve(el);
        return false;
      }
      return true;
    });
  };
  $$(".reveal:not(.in), .ph").forEach(watch);
  window.TRIUMPH_REVEAL = (root) => {
    $$(".reveal:not(.in), .ph", root).forEach(watch);
    $$("img[data-img]", root).forEach(wireImg);
    if (finePointer && !reduced) $$(".tilt", root).forEach(tilt);
  };

  /* ---------- Count-up ---------- */
  const countIO = new IntersectionObserver((en) =>
    en.forEach((x) => {
      if (!x.isIntersecting) return;
      countIO.unobserve(x.target);
      const end = Number(x.target.dataset.count);
      if (reduced) return;
      const t0 = performance.now();
      const step = (t) => {
        const k = Math.min(1, (t - t0) / 1400);
        x.target.textContent = Math.round(end * (1 - Math.pow(1 - k, 3)));
        if (k < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }),
  );
  $$("[data-count]").forEach((el) => countIO.observe(el));

  /* ---------- Header, progress, back to top, process line ---------- */
  const header = $(".header");
  const bar = $(".progress");
  const top = $(".fab-top");
  const steps = $("[data-steps]");
  let lastY = scrollY;
  let ticking = false;
  const onScroll = () => {
    ticking = false;
    sweep();
    const y = scrollY;
    const max = document.documentElement.scrollHeight - innerHeight;
    const p = max > 0 ? y / max : 0;
    bar && bar.style.setProperty("--p", p.toFixed(4));
    if (header) {
      header.classList.toggle("scrolled", y > 30);
      header.classList.toggle("hide", y > 500 && y > lastY + 4 && !document.body.classList.contains("menu-open"));
      if (y < lastY - 4) header.classList.remove("hide");
    }
    if (top) {
      top.classList.toggle("show", y > 700);
      top.style.setProperty("--p", p.toFixed(4));
    }
    if (steps) {
      const r = steps.getBoundingClientRect();
      const vertical = innerWidth <= 820;
      const k = Math.max(0, Math.min(1, (innerHeight * 0.75 - r.top) / (r.height * (vertical ? 1 : 0.6) + innerHeight * 0.25)));
      steps.style.setProperty("--sp", k.toFixed(3));
      const list = $$(".step", steps);
      list.forEach((s, i) => s.classList.toggle("lit", k >= (i + 0.5) / list.length - 0.02 || k >= 0.999));
    }
    lastY = y;
  };
  addEventListener("scroll", () => {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(onScroll);
    }
  }, { passive: true });
  onScroll();
  top && top.addEventListener("click", () => scrollTo({ top: 0, behavior: reduced ? "auto" : "smooth" }));

  /* ---------- Nav: sliding pill on the current page ---------- */
  const nav = $(".nav");
  const pill = nav && $(".nav-pill", nav);
  const placePill = (a, instant) => {
    if (!pill) return;
    if (instant) pill.style.transition = "none";
    if (!a) pill.style.setProperty("--o", 0);
    else {
      pill.style.setProperty("--x", `${a.offsetLeft}px`);
      pill.style.setProperty("--w", `${a.offsetWidth}px`);
      pill.style.setProperty("--o", 1);
    }
    if (instant) {
      void pill.offsetWidth;
      pill.style.transition = "";
    }
  };
  if (nav) {
    const links = $$("a", nav);
    const active = $('a[aria-current="page"]', nav);
    // The pill starts where it was on the last page and glides over to this one.
    let from = null;
    try {
      from = links.find((a) => a.getAttribute("href") === sessionStorage.getItem("t-pill"));
      sessionStorage.setItem("t-pill", active ? active.getAttribute("href") : "");
    } catch (e) {}
    const start = () => {
      placePill(from || active, true);
      requestAnimationFrame(() => requestAnimationFrame(() => placePill(active)));
    };
    document.fonts && document.fonts.status !== "loaded" ? document.fonts.ready.then(start) : start();
    links.forEach((a) => a.addEventListener("mouseenter", () => placePill(a)));
    nav.addEventListener("mouseleave", () => placePill(active));
    addEventListener("resize", () => placePill(active, true));
  }

  /* ---------- Page transitions ---------- */
  // Browsers with cross-page view transitions animate in CSS (site.css). Others get a curtain that
  // sweeps over the page on the way out and lifts off the next page on the way in.
  if (!("onpagereveal" in window)) {
    if (root.classList.contains("arrive")) setTimeout(() => root.classList.remove("arrive"), 1200);
    const page = (p) => p.replace(/(index)?\.html$/, "").replace(/\/$/, "") || "/";
    document.addEventListener("click", (e) => {
      const a = e.target.closest("a[href]");
      if (!a || reduced || e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      if (a.target || a.hasAttribute("download")) return;
      const u = new URL(a.href, location.href);
      if (u.origin !== location.origin || page(u.pathname) === page(location.pathname)) return;
      e.preventDefault();
      try {
        sessionStorage.setItem("t-nav", "1");
      } catch (err) {}
      root.classList.add("leaving");
      setTimeout(() => location.assign(u.href), 430);
    });
    // Coming back with the browser's Back button can show the page as it was left, curtain and all.
    addEventListener("pageshow", (e) => e.persisted && root.classList.remove("leaving", "arrive"));
  }

  /* ---------- Mobile menu ---------- */
  const mb = $(".menu-btn");
  const mm = $(".mobile-menu");
  if (mb && mm) {
    const set = (open) => {
      document.body.classList.toggle("menu-open", open);
      mb.setAttribute("aria-expanded", open);
      mb.setAttribute("aria-label", open ? "Close menu" : "Open menu");
      document.body.style.overflow = open ? "hidden" : "";
    };
    mb.addEventListener("click", () => set(!document.body.classList.contains("menu-open")));
    mm.addEventListener("click", (e) => e.target.closest("a") && set(false));
    document.addEventListener("keydown", (e) => e.key === "Escape" && set(false));
  }

  /* ---------- 3D tilt cards ---------- */
  function tilt(el) {
    if (el.dataset.tilt) return;
    el.dataset.tilt = "1";
    let raf = 0;
    el.addEventListener("pointermove", (e) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const r = el.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width;
        const y = (e.clientY - r.top) / r.height;
        el.classList.add("tilting");
        el.style.setProperty("--ry", `${(x - 0.5) * 12}deg`);
        el.style.setProperty("--rx", `${(0.5 - y) * 10}deg`);
        el.style.setProperty("--gx", `${x * 100}%`);
        el.style.setProperty("--gy", `${y * 100}%`);
      });
    });
    el.addEventListener("pointerleave", () => {
      cancelAnimationFrame(raf);
      el.classList.remove("tilting");
      el.style.setProperty("--rx", "0deg");
      el.style.setProperty("--ry", "0deg");
    });
  }
  if (finePointer && !reduced) {
    $$(".tilt").forEach(tilt);

    /* Magnetic buttons */
    $$(".magnetic").forEach((b) => {
      b.addEventListener("pointermove", (e) => {
        const r = b.getBoundingClientRect();
        b.style.setProperty("--mx", `${(e.clientX - r.left - r.width / 2) * 0.18}px`);
        b.style.setProperty("--my", `${(e.clientY - r.top - r.height / 2) * 0.28}px`);
      });
      b.addEventListener("pointerleave", () => {
        b.style.setProperty("--mx", "0px");
        b.style.setProperty("--my", "0px");
      });
    });

    /* Soft glow that follows the cursor */
    const glow = $(".cursor-glow");
    if (glow) {
      let gx = -999, gy = -999, tx = -999, ty = -999, on = false;
      addEventListener("pointermove", (e) => {
        tx = e.clientX;
        ty = e.clientY;
        if (!on) {
          on = true;
          gx = tx;
          gy = ty;
          document.body.classList.add("has-cursor");
          loop();
        }
      }, { passive: true });
      document.addEventListener("pointerleave", () => document.body.classList.remove("has-cursor"));
      function loop() {
        gx += (tx - gx) * 0.12;
        gy += (ty - gy) * 0.12;
        glow.style.setProperty("--cx", `${gx}px`);
        glow.style.setProperty("--cy", `${gy}px`);
        requestAnimationFrame(loop);
      }
    }
  }

  /* ---------- Toast (used by the Products page) ---------- */
  window.TRIUMPH_TOAST = (msg) => {
    let t = $(".toast");
    if (!t) {
      t = document.createElement("div");
      t.className = "toast";
      t.setAttribute("role", "status");
      document.body.append(t);
    }
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(t._h);
    t._h = setTimeout(() => t.classList.remove("show"), 2200);
  };
})();
