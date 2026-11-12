import { describe, expect, it } from "vitest";
import supertest from "supertest";
import { createTestApp } from "./helpers.js";
import { renderLegalMarkdown } from "../server/routes/legal.js";

/** The public legal pages: reachable without signing in (app-store requirement), one source each. */
describe("public legal pages", () => {
  it("serves every page without a session, as HTML, from docs/legal", async () => {
    const ctx = await createTestApp();
    try {
      for (const [path, title] of [["/privacy", "Privacy Policy"], ["/terms", "Terms of Use"], ["/clinical-safety", "Clinical Safety Notice"], ["/acceptable-use", "Acceptable Use Policy"], ["/subprocessors", "Subprocessors"]]) {
        const res = await supertest(ctx.app).get(path!);
        expect(res.status, path).toBe(200);
        expect(res.headers["content-type"]).toMatch(/text\/html/);
        expect(res.text).toContain(title);
        expect(res.headers["set-cookie"], path + " sets no session").toBeUndefined();
      }
      const terms = await supertest(ctx.app).get("/terms");
      expect(terms.text).toContain("not an emergency system");
    } finally {
      await ctx.handle.close();
    }
  });

  it("escapes HTML in the source and renders the subset the documents use", () => {
    const html = renderLegalMarkdown("# T\n\nA <script>x</script> **b** `/privacy` [l](X.md)\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n* one\n* two\n\n1. first\n");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("<strong>b</strong>");
    expect(html).toContain('<a href="/privacy">/privacy</a>');
    expect(html).toContain('<a href="X">l</a>');
    expect(html).toContain("<td>1</td>");
    expect(html).toContain("<ul><li>one</li><li>two</li></ul>");
    expect(html).toContain("<ol><li>first</li></ol>");
  });
});
