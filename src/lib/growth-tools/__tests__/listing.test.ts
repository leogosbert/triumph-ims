import assert from "node:assert/strict";
import { test } from "node:test";
import { isPrivateAddress } from "../fetchSource";
import { absoluteUrl, htmlText, parseTenderListing } from "../listing";
import { parseRobots, robotsAllows } from "../robots";

test("robots.txt: our group, longest match wins", () => {
  const txt = "User-agent: *\nDisallow: /\n\nUser-agent: LeMoSpTenderBot\nDisallow: /private\nAllow: /private/tenders\nCrawl-delay: 10\n";
  const r = parseRobots(txt);
  assert.ok(robotsAllows(r, "/tenders"));
  assert.ok(!robotsAllows(r, "/private/x"));
  assert.ok(robotsAllows(r, "/private/tenders/1"));
  assert.equal(r.crawlDelay, 10);
  const star = parseRobots("User-agent: *\nDisallow: /admin\nDisallow: /*.pdf$\n");
  assert.ok(!robotsAllows(star, "/admin/x"));
  assert.ok(!robotsAllows(star, "/files/a.pdf"));
  assert.ok(robotsAllows(star, "/files/a.pdf?x=1"));
  assert.ok(robotsAllows(parseRobots(""), "/anything"));
  assert.ok(!robotsAllows(parseRobots("User-agent: *\nDisallow: /\n"), "/tenders"));
});

test("private addresses are refused", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1"]) {
    assert.ok(isPrivateAddress(ip), ip);
  }
  for (const ip of ["41.59.1.1", "8.8.8.8", "2001:4860:4860::8888"]) assert.ok(!isPrivateAddress(ip), ip);
  assert.ok(isPrivateAddress("not-an-ip"));
});

test("html to text and links", () => {
  assert.equal(htmlText("<p>A &amp; B</p><script>x()</script><br>C&#39;s"), "A & B\nC's");
  assert.equal(absoluteUrl("/t/1#top", "https://example.go.tz/tenders"), "https://example.go.tz/t/1");
  assert.equal(absoluteUrl("javascript:alert(1)", "https://example.go.tz/"), null);
});

test("RSS feed", () => {
  const xml = `<?xml version="1.0"?><rss><channel><title>Tenders</title>
  <item><title>Tender No. AE/001/2026 Supply of lubricants</title><link>https://example.go.tz/t/1</link><description><![CDATA[Closing 20/11/2026]]></description><pubDate>Mon, 26 Oct 2026 08:00:00 GMT</pubDate></item>
  <item><title>Staff party photos</title><link>https://example.go.tz/news/2</link></item>
  </channel></rss>`;
  const items = parseTenderListing(xml, "https://example.go.tz/feed");
  assert.equal(items.length, 1);
  assert.equal(items[0].url, "https://example.go.tz/t/1");
  assert.equal(items[0].published, "2026-10-26");
  assert.match(items[0].text, /Closing 20\/11\/2026/);
});

test("HTML table and links", () => {
  const html = `<html><nav><a href="/tenders">Tenders</a></nav><table>
   <tr><th>No</th><th>Title</th><th>Closing</th></tr>
   <tr><td>1</td><td><a href="/tender/55">Supply of mechanical spare parts for crushers</a></td><td>20/11/2026</td></tr>
   <tr><td>2</td><td>Annual report 2025</td><td></td></tr>
   </table><a href="https://other.example.com/rfq/9">RFQ for supply of industrial chemicals</a></html>`;
  const items = parseTenderListing(html, "https://mine.example.com/procurement");
  assert.deepEqual(
    items.map((i) => i.url),
    ["https://mine.example.com/tender/55", "https://other.example.com/rfq/9"],
  );
  assert.match(items[0].text, /20\/11\/2026/);
  assert.equal(items[0].title, "Supply of mechanical spare parts for crushers");
});
