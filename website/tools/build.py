#!/usr/bin/env python3
"""Builds the website pages from website/src.

Each page is the shared head, header and footer around its own content in src/pages/<name>.html.
Page content can pull in a block from src/sections with {{> name}} and its page banner with {{hero}}.
The built pages are committed, so Netlify publishes the folder as it is (no build step there).

Run from anywhere:  python3 website/tools/build.py
"""
import hashlib
import re
from html import escape
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "src"

SITE = "TRIUMPH General Suppliers Ltd"

# Main menu, in order: (page, label).
NAV = [
    ("index", "Home"),
    ("about", "About"),
    ("products", "Products"),
    ("industries", "Industries"),
    ("services", "Services"),
    ("gallery", "Gallery"),
    ("contact", "Contact"),
]

PAGES = {
    "index": {
        "title": f"{SITE} | Industrial supply in Tanzania",
        "desc": "TRIUMPH General Suppliers Ltd supplies industrial chemicals, oils and lubricants, mechanical spares, PPE and general supplies to mining, sugar, oil & gas, cement and manufacturing companies in Tanzania.",
        "scenes": True,
    },
    "about": {
        "title": f"About us | {SITE}",
        "desc": "Who TRIUMPH General Suppliers Ltd is: a Tanzanian general supply company with a mission to supply quality industrial products on time, at fair prices, with honest service.",
        "hero": {
            "kicker": "About us",
            "h1": 'A supply partner built on <span class="grad-text">trust and timing</span>',
            "lead": "We are a Tanzanian general supply company. Our job is simple: get the right product to your site, on time, with the right paperwork.",
            "img": "warehouse",
        },
    },
    "products": {
        "title": f"Products | {SITE}",
        "desc": "Browse TRIUMPH's product ranges: industrial chemicals, oils and lubricants, mechanical spares, PPE, electrical, tools and general supplies. Add what you need and request one quote.",
        "hero": {
            "kicker": "Products",
            "h1": 'Everything your plant runs on, <span class="grad-text">in one place</span>',
            "lead": "Browse our main product ranges. Add the ones you need to your quote list and send them to us in one request. Don't see it? We source on request.",
            "img": "shelves",
        },
        "scripts": ["/assets/js/products.js"],
    },
    "industries": {
        "title": f"Industries | {SITE}",
        "desc": "The industries TRIUMPH supplies across Tanzania: mining, sugar processing, oil & gas, cement, manufacturing and construction, with a 3D picture of our supply network.",
        "hero": {
            "kicker": "Industries",
            "h1": 'Supply for the industries that <span class="grad-text">power Tanzania</span>',
            "lead": "Mines, sugar estates, refineries, cement plants and factories each run to their own rhythm. See what we supply to each, and how it reaches the site.",
            "img": "mining",
        },
        "scenes": True,
    },
    "services": {
        "title": f"Services | {SITE}",
        "desc": "TRIUMPH services: sourcing and procurement, logistics and delivery, stocking, framework supply contracts, technical advice and urgent supply. How we work and common questions.",
        "hero": {
            "kicker": "Services",
            "h1": 'We find it, buy it, check it and <span class="grad-text">bring it to site</span>',
            "lead": "More than a supplier: a supply team that takes the chasing off your hands, from the first quote to the delivery note.",
            "img": "trailer",
        },
    },
    "gallery": {
        "title": f"Gallery | {SITE}",
        "desc": "Videos and photos of the industries, sites and supplies TRIUMPH General Suppliers Ltd works with in Tanzania.",
        "hero": {
            "kicker": "Gallery",
            "h1": 'Supply, <span class="grad-text">at work</span>',
            "lead": "Videos and photos from the mines, plants and warehouses our supplies go to.",
            "img": "refinery",
        },
    },
    "contact": {
        "title": f"Contact & quotes | {SITE}",
        "desc": "Request a quote from TRIUMPH General Suppliers Ltd. Send your list or requisition and get prices, lead times and delivery to your site in Tanzania.",
        "hero": {
            "kicker": "Contact",
            "h1": "Let's talk about <span class=\"grad-text\">what you need</span>",
            "lead": "Send your list, a part number or a full requisition. We reply with prices, lead times and delivery to your site.",
            "img": "handshake",
        },
    },
    "thanks": {
        "title": f"Thank you | {SITE}",
        "desc": "Your request has reached TRIUMPH General Suppliers Ltd.",
    },
    "404": {
        "title": f"Page not found | {SITE}",
        "desc": "This page could not be found.",
    },
}

SCRIPTS = ["/assets/js/icons.js", "/assets/js/config.js", "/assets/js/catalogue.js", "/assets/js/main.js"]


def bust(html):
    """Adds a content hash to local CSS/JS links: assets are cached for a week, so a change needs a new URL."""

    def add(m):
        f = ROOT / m.group(2).lstrip("/")
        v = hashlib.sha1(f.read_bytes()).hexdigest()[:8]
        return f'{m.group(1)}{m.group(2)}?v={v}"'

    return re.sub(r'((?:href|src)=")(/assets/(?:css|js)/[\w.-]+\.(?:css|js))"', add, html)


def href(page):
    return "/" if page == "index" else f"/{page}.html"


def nav(current, indent):
    out = []
    for page, label in NAV:
        cur = ' aria-current="page"' if page == current else ""
        out.append(f'{indent}<a href="{href(page)}"{cur}>{label}</a>')
    return "\n".join(out)


def hero(page):
    h = PAGES[page]["hero"]
    label = dict(NAV).get(page, h["kicker"])
    return f"""    <section class="page-hero">
      <div class="page-hero-bg" aria-hidden="true"><img data-img="{h['img']}" data-w="1600" data-sizes="100vw" alt="" /></div>
      <div class="wrap">
        <nav class="crumbs reveal" aria-label="Breadcrumb"><a href="/">Home</a><span aria-current="page">{label}</span></nav>
        <span class="kicker reveal" style="--d: 1">{h['kicker']}</span>
        <h1 class="reveal" style="--d: 2">{h['h1']}</h1>
        <p class="reveal" style="--d: 3">{h['lead']}</p>
      </div>
    </section>"""


def build(page):
    spec = PAGES[page]
    head = (SRC / "_head.html").read_text()
    head = head.replace("{{TITLE}}", escape(spec["title"], quote=False))
    head = head.replace("{{DESC}}", escape(spec["desc"]))
    head = head.replace("{{OGTITLE}}", escape(spec["title"].split(" | ")[0] if page != "index" else SITE))
    header = (SRC / "_header.html").read_text()
    header = header.replace("{{NAV}}", nav(page, " " * 8)).replace("{{MNAV}}", nav(page, " " * 4))
    body = (SRC / "pages" / f"{page}.html").read_text()
    if "{{hero}}" in body:
        body = body.replace("{{hero}}", hero(page))
    for line in [l for l in body.splitlines() if l.strip().startswith("{{> ")]:
        name = line.strip()[4:-2].strip()
        body = body.replace(line, (SRC / "sections" / f"{name}.html").read_text().rstrip("\n"))
    if "{{" in body:
        raise SystemExit(f"{page}: unfilled placeholder")
    footer = (SRC / "_footer.html").read_text()
    scripts = "\n".join(f'  <script src="{s}"></script>' for s in SCRIPTS + spec.get("scripts", []))
    if spec.get("scenes"):
        scripts += '\n  <script type="module" src="/assets/js/scenes.js"></script>'
    note = "<!-- Built by website/tools/build.py from website/src. Edit the source, then run the build. -->\n"
    html = f"{head.rstrip()}\n<body>\n{note}{header.rstrip()}\n\n{body.rstrip()}\n\n{footer.rstrip()}\n\n{scripts}\n</body>\n</html>\n"
    html = bust(html)
    (ROOT / f"{page}.html").write_text(html)
    return html


if __name__ == "__main__":
    for p in PAGES:
        build(p)
        print("built", f"{p}.html")
