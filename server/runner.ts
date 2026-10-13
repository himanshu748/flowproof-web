import { chromium, type Page } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import type {
  Project,
  Audit,
  Check,
  CheckResult,
  ResultStatus,
} from "../shared/types.js";
import { validateChecks } from "./schema.js";
import {
  redact,
  safeFetch,
  validateTarget,
  SafetyError,
  type NetworkBudget,
} from "./safety.js";
import { SAMPLE_URL, sampleHtml } from "./sample.js";

const VIEWPORTS = {
  desktop: { width: 1365, height: 900 },
  mobile: { width: 390, height: 844 },
};
type Observation = { status: ResultStatus; observed: string; dom?: string };
function normalize(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

async function visibleMatches(
  page: Page,
  selector: string,
  kind: "heading" | "link",
  accessibleName?: string,
): Promise<{ text: string; href: string | null }[]> {
  const candidates =
    accessibleName === undefined
      ? page.locator(selector)
      : page
          .locator(selector)
          .and(page.getByRole("link", { name: accessibleName, exact: true }));
  return candidates.evaluateAll(
    (elements, assertedKind) =>
      elements.slice(0, 1000).flatMap((element) => {
        const el = element as HTMLElement;
        if (
          assertedKind === "heading" &&
          !/^H[1-6]$/.test(el.tagName) &&
          el.getAttribute("role") !== "heading"
        )
          return [];
        if (
          assertedKind === "link" &&
          (el.tagName !== "A" ||
            !el.hasAttribute("href") ||
            /^\s*(?:javascript|data|file):/i.test(
              el.getAttribute("href") || "",
            ))
        )
          return [];
        let ancestor: Element | null = el;
        while (ancestor) {
          const style = getComputedStyle(ancestor);
          if (
            style.visibility === "hidden" ||
            style.visibility === "collapse" ||
            style.display === "none" ||
            style.opacity === "0" ||
            style.contentVisibility === "hidden"
          )
            return [];
          ancestor = ancestor.parentElement;
        }
        const box = el.getBoundingClientRect();
        if (!box.width || !box.height) return [];
        return [
          {
            text: (el.innerText || el.textContent || "").slice(0, 4000),
            href: el.getAttribute("href"),
          },
        ];
      }),
    kind,
  );
}

async function observe(page: Page, check: Check): Promise<Observation> {
  if (check.kind === "manual")
    return {
      status: "unverified",
      observed:
        "This requirement needs a human decision. No automated assertion was executed.",
    };
  if (check.kind === "heading") {
    const headings = await visibleMatches(
      page,
      check.selector || 'h1,h2,h3,h4,h5,h6,[role="heading"]',
      "heading",
    );
    const match = headings.find(
      (item) => normalize(item.text) === normalize(check.expected),
    );
    return {
      status: match ? "passed" : "failed",
      observed: match
        ? "The expected heading is visible."
        : "No visible heading exactly matches the expected text.",
      dom:
        headings
          .map((item) => item.text)
          .join("\n")
          .slice(0, 1200) || "No visible headings found.",
    };
  }
  if (check.kind === "text_visible") {
    const scope = check.selector
      ? page.locator(check.selector)
      : page.getByText(check.expected, { exact: false });
    const count = Math.min(await scope.count(), 100);
    let text = "";
    for (let i = 0; i < count; i++) {
      const candidate = scope.nth(i);
      if (await candidate.isVisible()) {
        const visuallyShown = await candidate.evaluate((element) => {
          let ancestor: Element | null = element;
          while (ancestor) {
            const style = getComputedStyle(ancestor);
            if (
              style.visibility === "hidden" ||
              style.visibility === "collapse" ||
              style.display === "none" ||
              style.opacity === "0" ||
              style.contentVisibility === "hidden"
            )
              return false;
            ancestor = ancestor.parentElement;
          }
          return true;
        });
        if (!visuallyShown) continue;
        const value = await candidate.innerText({ timeout: 1000 });
        const index = normalize(value).indexOf(normalize(check.expected));
        if (index >= 0) {
          text = value.slice(
            Math.max(0, index - 80),
            index + check.expected.length + 120,
          );
          break;
        }
      }
    }
    return {
      status: text ? "passed" : "failed",
      observed: text
        ? "The expected text is visible on the page."
        : "The expected text was not visible on the page.",
      dom: text || "No visible matching text.",
    };
  }
  if (check.kind === "link") {
    const expectedIsHref = /^(?:\/|https?:|mailto:|tel:|#)/i.test(
      check.expected,
    );
    const links = await visibleMatches(
      page,
      check.selector || "a[href]",
      "link",
      expectedIsHref ? undefined : check.expected,
    );
    const match = links.find((item) =>
      expectedIsHref
        ? item.href === check.expected ||
          item.href === new URL(check.expected, page.url()).href
        : true,
    );
    return {
      status: match ? "passed" : "failed",
      observed: match
        ? "A visible link matches the expected destination or text. Its destination was not opened."
        : "No visible link matches the expected destination or text.",
      dom: (match
        ? `${match.text} → ${match.href}`
        : links
            .slice(0, 12)
            .map((item) => `${item.text} → ${item.href}`)
            .join("\n")
      ).slice(0, 1200),
    };
  }
  if (check.kind === "image_alt") {
    const images = await page
      .locator(check.selector || "img")
      .evaluateAll((elements) =>
        elements
          .filter((element) => element.tagName === "IMG")
          .slice(0, 1000)
          .map((element, index) => ({
            index: index + 1,
            alt: element.getAttribute("alt"),
            decorative:
              ["none", "presentation"].includes(
                element.getAttribute("role") || "",
              ) || element.getAttribute("aria-hidden") === "true",
          })),
      );
    if (!images.length)
      return {
        status: "unverified",
        observed:
          "No images were found, so image alternative text could not be verified.",
      };
    const missing = images.filter(
      (image) => image.alt === null || (!image.alt.trim() && !image.decorative),
    );
    return {
      status: missing.length ? "failed" : "passed",
      observed: missing.length
        ? `${missing.length} of ${images.length} images lack the required alternative text.`
        : `All ${images.length} images have alternative text or are explicitly marked decorative.`,
      dom: images
        .slice(0, 12)
        .map(
          (image) =>
            `Image ${image.index}: ${image.alt === null ? "[alt attribute missing]" : image.alt || "[explicitly decorative]"}`,
        )
        .join("\n"),
    };
  }
  if (check.kind === "no_horizontal_overflow") {
    const size = await page.evaluate(() => ({
      viewport: window.innerWidth,
      document: Math.max(
        document.documentElement.scrollWidth,
        document.body?.scrollWidth ?? 0,
      ),
    }));
    return {
      status: size.document <= size.viewport + 1 ? "passed" : "failed",
      observed: `Document width is ${size.document}px; viewport width is ${size.viewport}px.`,
      dom: `document.scrollWidth=${size.document}; window.innerWidth=${size.viewport}`,
    };
  }
  throw new SafetyError("Unsupported test type.");
}

// Evidence is a deliberately short observation, not a copy of the client DOM.
async function prepareScreenshot(page: Page): Promise<void> {
  await page.evaluate(() => {
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
    );
    let node: Node | null;
    let count = 0;
    while ((node = walker.nextNode())) {
      if (++count > 4000)
        throw new Error(
          "The page exceeds the bounded screenshot redaction limit.",
        );
      if (["SCRIPT", "STYLE"].includes(node.parentElement?.tagName || ""))
        continue;
      node.textContent = (node.textContent || "")
        .replace(
          /\b(?:Bearer\s+)?(?:sk[-_][A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9]{12,}|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\b/gi,
          "[redacted credential]",
        )
        .replace(
          /(["']?\b(?:password|passwd|secret|token|api[ _-]?key|authorization)["']?\s*[:=]\s*)(?:(?:Bearer|Basic)\s+)?(?:"[^"]*"|'[^']*'|[^\s,;<>]+)/gi,
          "$1[redacted]",
        )
        .replace(
          /\b(?:Bearer|Basic)\s+[A-Za-z0-9+\/_.=-]{6,}/gi,
          "[redacted authorization]",
        )
        .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted email]")
        .replace(/(?:\+?\d[\d ().-]{7,}\d)/g, "[redacted phone]");
    }
  });
}

/** Execute only an approved immutable snapshot; AI output never becomes code. */
export async function runAudit(
  project: Project,
  audit: Audit,
  onResult: (result: CheckResult) => Promise<void> | void,
  options: { evidenceRoot?: string } = {},
): Promise<CheckResult[]> {
  const checks = validateChecks(audit.checks);
  const currentChecks = validateChecks(project.checks);
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(audit.id))
    throw new SafetyError("Invalid audit identifier.");
  if (audit.projectId !== project.id)
    throw new SafetyError("The audit does not belong to this project.");
  if (
    checks.some(
      (check) =>
        (check.kind !== "manual" && !check.approved) ||
        !currentChecks.some(
          (current) => JSON.stringify(current) === JSON.stringify(check),
        ),
    )
  )
    throw new SafetyError(
      "Every executable check must match the current approved plan before execution.",
    );
  if (project.target !== "sample" && !project.authorized)
    throw new SafetyError(
      "Confirm that you own or are authorized to audit this website.",
    );
  const sample = project.target === "sample";
  const target = sample ? SAMPLE_URL : await validateTarget(project.url);
  if (sample && project.url !== SAMPLE_URL)
    throw new SafetyError(
      "Synthetic projects must use the built-in sample website.",
    );
  const origin = new URL(target).origin;
  const destination = path.join(
    options.evidenceRoot ??
      process.env.EVIDENCE_ROOT ??
      path.resolve("data/evidence"),
    audit.id,
  );
  await mkdir(destination, { recursive: true });
  const results: CheckResult[] = [];
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    browser = await chromium.launch({ headless: true });
    const budget: NetworkBudget = { requests: 0, bytes: 0 };
    const deadline = Date.now() + 120_000;
    for (let index = 0; index < checks.length; index++) {
      const check = checks[index];
      const started = Date.now();
      const viewport = VIEWPORTS[check.viewport];
      const url = new URL(check.path, target).href;
      let observation: Observation = {
        status: "blocked",
        observed: "The test could not be executed.",
      };
      let screenshot: string | undefined;
      let observedUrl = url;
      if (check.kind === "manual") {
        observation = {
          status: "unverified",
          observed:
            "This requirement needs a human decision. No automated assertion was executed.",
        };
      } else if (Date.now() >= deadline) {
        observation = {
          status: "blocked",
          observed: "The two-minute audit time budget was reached.",
        };
      } else {
        const context = await browser.newContext({
          viewport,
          javaScriptEnabled: false,
          serviceWorkers: "block",
          acceptDownloads: false,
          ignoreHTTPSErrors: false,
          reducedMotion: "reduce",
        });
        const denials: string[] = [];
        try {
          await context.routeWebSocket("**/*", (socket) => socket.close());
          await context.route("**/*", async (route) => {
            const request = route.request();
            try {
              if (Date.now() >= deadline)
                throw new SafetyError("The audit time budget was reached.");
              if (!["GET", "HEAD"].includes(request.method()))
                throw new SafetyError("A non-read-only request was blocked.");
              const requestUrl = new URL(request.url());
              if (requestUrl.origin !== origin)
                throw new SafetyError(
                  "A third-party request was blocked by the same-origin audit policy.",
                );
              if (sample) {
                if (request.resourceType() === "document")
                  await route.fulfill({
                    status: 200,
                    contentType: "text/html",
                    body: sampleHtml(
                      project.sampleVariant,
                      requestUrl.pathname,
                    ),
                  });
                else await route.abort("blockedbyclient");
              } else {
                const response = await safeFetch(request.url(), {
                  method: request.method(),
                  allowedOrigin: origin,
                  budget,
                });
                if (response.url !== request.url())
                  await route.fulfill({
                    status: 302,
                    headers: { location: response.url },
                    body: "",
                  });
                else
                  await route.fulfill({
                    status: response.status,
                    headers: {
                      "content-type":
                        response.headers["content-type"] ??
                        "application/octet-stream",
                      "cache-control": "no-store",
                      "content-security-policy":
                        "script-src 'none'; connect-src 'none'; form-action 'none'; frame-src 'none'; object-src 'none'; worker-src 'none'",
                    },
                    body: response.body,
                  });
              }
            } catch (error) {
              denials.push(
                error instanceof Error
                  ? error.message
                  : "The request was blocked.",
              );
              await route.abort("blockedbyclient").catch(() => {});
            }
          });
          const page = await context.newPage();
          page.setDefaultTimeout(2500);
          const response = await page.goto(url, {
            waitUntil: "networkidle",
            timeout: 15_000,
          });
          observedUrl = page.url();
          if (!response || response.status() >= 400)
            throw new SafetyError(
              `The page was unavailable${response ? ` (HTTP ${response.status()})` : ""}.`,
            );
          if (denials.length) throw new SafetyError(denials[0]);
          observation = await observe(page, check);
          await prepareScreenshot(page);
          const filename = `${String(index + 1).padStart(2, "0")}-${check.id}.png`;
          await page.screenshot({
            path: path.join(destination, filename),
            fullPage: false,
            animations: "disabled",
            mask: [
              page.locator(
                "input,textarea,[contenteditable],[data-private],[data-sensitive]",
              ),
            ],
            maskColor: "#2a2c2b",
            timeout: 5000,
          });
          screenshot = `/evidence/${audit.id}/${filename}`;
          if (denials.length) throw new SafetyError(denials[0]);
        } catch (error) {
          observation = {
            status: "blocked",
            observed: redact(
              denials[0] ||
                (error instanceof Error
                  ? error.message
                  : "The browser could not complete this check."),
            ),
          };
        } finally {
          await context.close();
        }
      }
      const result: CheckResult = {
        checkId: check.id,
        requirement: redact(check.requirement),
        kind: check.kind,
        status: observation.status,
        expected: redact(check.expected),
        durationMs: Date.now() - started,
        evidence: {
          observed: redact(observation.observed),
          dom: observation.dom ? redact(observation.dom) : undefined,
          screenshot,
          url: redact(observedUrl),
          viewport,
        },
      };
      results.push(result);
      await onResult(result);
    }
  } catch (error) {
    // If Chromium is missing or crashes, every unexecuted check remains blocked.
    for (const check of checks.slice(results.length)) {
      const result: CheckResult = {
        checkId: check.id,
        requirement: redact(check.requirement),
        kind: check.kind,
        status: check.kind === "manual" ? "unverified" : "blocked",
        expected: redact(check.expected),
        durationMs: 0,
        evidence: {
          observed: redact(
            error instanceof Error
              ? error.message
              : "Browser execution was unavailable.",
          ),
          url: new URL(check.path, target).href,
          viewport: VIEWPORTS[check.viewport],
        },
      };
      results.push(result);
      await onResult(result);
    }
  } finally {
    await browser?.close();
  }
  return results;
}
