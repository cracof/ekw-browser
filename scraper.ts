import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { calculateCheckDigit } from "./src/utils/ekw.ts";
import * as cheerio from "cheerio";
import fs from "fs";
import path from "path";

puppeteer.use(StealthPlugin());

const debugDir = path.resolve(process.cwd(), "debug");

function normalizeText(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function detectProtectionOrOutage(html: string) {
  const lowered = html.toLowerCase();

  if (
    lowered.includes("/tspd/") ||
    lowered.includes("verify you are human") ||
    lowered.includes("cloudflare") ||
    lowered.includes("captcha") ||
    lowered.includes("please enable javascript")
  ) {
    return "Wykryto stronę ochronną/antybot. Serwis eKW nie zwrócił stabilnej strony z danymi.";
  }

  if (html.includes("Przerwa techniczna")) {
    return "Serwis EKW ma przerwę techniczną.";
  }

  return null;
}

function ensureDebugDir() {
  if (!fs.existsSync(debugDir)) {
    fs.mkdirSync(debugDir, { recursive: true });
  }
}

function saveDebugArtifacts(name: string, html: string) {
  ensureDebugDir();
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const basePath = path.join(debugDir, `${timestamp}_${name}`);
  fs.writeFileSync(`${basePath}.html`, html, "utf8");
  return basePath;
}

function createDebugFilePath(name: string, extension: string) {
  ensureDebugDir();
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.join(debugDir, `${timestamp}_${name}.${extension}`);
}

function extractSectionRows(root: ParentNode) {
  const results: Record<string, string> = {};
  const rows = Array.from(root.querySelectorAll(".section .form-row"));

  rows.forEach((row) => {
    const label = normalizeText(
      ((row.querySelector(".label-column-50 label") as HTMLElement | null)?.innerText ||
        row.querySelector(".label-column-50 label")?.textContent ||
        ""),
    );
    const valueContainer = row.querySelector(".content-column-50 .left") as HTMLElement | null;

    if (!label || !valueContainer) return;

    const paragraphValues = Array.from(valueContainer.querySelectorAll("p"))
      .map((element) => normalizeText((element as HTMLElement).innerText || element.textContent || ""))
      .filter(Boolean);

    const fallbackValue = normalizeText(valueContainer.innerText || valueContainer.textContent || "");
    const value = paragraphValues.length > 0 ? paragraphValues.join(" | ") : fallbackValue;

    if (value) {
      results[label] = value;
    }
  });

  return results;
}

function extractRowsFromCheerio(html: string) {
  const $ = cheerio.load(html);
  const results: Record<string, string> = {};

  $(".section .form-row").each((_, row) => {
    const label = normalizeText($(row).find(".label-column-50 label").first().text());
    if (!label) return;

    const paragraphValues = $(row)
      .find(".content-column-50 .left")
      .first()
      .find("p")
      .map((__, element) => normalizeText($(element).text()))
      .get()
      .filter(Boolean);

    const fallbackValue = normalizeText($(row).find(".content-column-50 .left").first().text());
    const value = paragraphValues.length > 0 ? paragraphValues.join(" | ") : fallbackValue;

    if (value) {
      results[label] = value;
    }
  });

  if (Object.keys(results).length > 0) {
    return results;
  }

  $("table").each((_, table) => {
    const tableText = $(table).text();
    if (tableText.includes("Numer księgi wieczystej") || tableText.includes("Typ księgi")) {
      $(table)
        .find("tr")
        .each((__, row) => {
          const cells = $(row).find("td, th");
          if (cells.length < 2) return;

          const label = normalizeText($(cells[0]).text()).replace(/:$/, "");
          const value = normalizeText($(cells[1]).text());
          if (label && value && label.length < 100 && !label.includes("http")) {
            results[label] = value;
          }
        });
    }
  });

  return results;
}

export function parseEkwHtml(html: string) {
  const protectionOrOutage = detectProtectionOrOutage(html);
  if (protectionOrOutage) {
    throw new Error(protectionOrOutage);
  }

  const finalResults = extractRowsFromCheerio(html);
  return {
    rawHtml: html,
    parsedData: Object.keys(finalResults).length > 0 ? { "Informacje Podstawowe": finalResults } : null,
  };
}

export async function scrapeEkw(prefix: string, number: string) {
  const checkDigit = calculateCheckDigit(prefix, number);
  const fullNumber = `${prefix}/${number}/${checkDigit}`;

  console.log(`Starting scrape for ${fullNumber}`);

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 1024 });
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    );

    console.log("Navigating to EKW main page to initialize session...");
    await page.goto("https://przegladarka-ekw.ms.gov.pl/eukw_prz/KsiegiWieczyste/main.do", {
      waitUntil: "networkidle2",
      timeout: 60000,
    });

    console.log("Clicking on search link...");
    const searchLinkSelector = "a[href*='wyszukiwanieKW']";
    try {
      await page.waitForSelector(searchLinkSelector, { timeout: 10000 });
      await page.click(searchLinkSelector);
      await page.waitForNavigation({ waitUntil: "networkidle2" });
    } catch {
      console.log("Could not find search link, trying direct navigation...");
      await page.goto("https://przegladarka-ekw.ms.gov.pl/eukw_prz/KsiegiWieczyste/wyszukiwanieKW", {
        waitUntil: "networkidle2",
        timeout: 60000,
      });
    }

    console.log("Waiting for form elements...");
    try {
      await Promise.all([
        page.waitForSelector("#kodWydzialuInput", { timeout: 15000 }),
        page.waitForSelector("#numerKsiegiWieczystej", { timeout: 15000 }),
        page.waitForSelector("#cyfraKontrolna", { timeout: 15000 }),
      ]);
    } catch {
      const content = await page.content();
      const frames = page.frames();
      console.log(`DEBUG: Total frames: ${frames.length}`);

      const inputs = await page.evaluate(() => {
        return Array.from(document.querySelectorAll("input, select, button")).map((el) => ({
          tag: el.tagName,
          id: el.id,
          name: (el as HTMLInputElement).name,
          value: (el as HTMLInputElement).value,
          type: (el as HTMLInputElement).type,
        }));
      });
      console.log(`DEBUG: Found ${inputs.length} inputs:`, JSON.stringify(inputs));
      saveDebugArtifacts("missing_form", content);

      const protectionOrOutage = detectProtectionOrOutage(content);
      if (protectionOrOutage) throw new Error(protectionOrOutage);

      throw new Error("Nie znaleziono pól formularza. Sprawdź logi.");
    }

    console.log(`Filling form for ${fullNumber}...`);
    await page.focus("#kodWydzialuInput");
    await page.keyboard.type(prefix.toUpperCase(), { delay: 150 });

    await page.focus("#numerKsiegiWieczystej");
    await page.keyboard.type(number, { delay: 150 });

    await page.focus("#cyfraKontrolna");
    await page.keyboard.type(checkDigit.toString(), { delay: 150 });

    console.log("Clicking search button...");
    try {
      await page.waitForSelector("#wyszukaj", { timeout: 10000 });
      await new Promise((resolve) => setTimeout(resolve, 500));

      const clicked = await page.evaluate(() => {
        const button = document.querySelector("#wyszukaj") as HTMLButtonElement | null;
        if (button) {
          button.click();
          return true;
        }
        return false;
      });

      if (!clicked) {
        await page.click("#wyszukaj");
      }

      await Promise.race([
        page.waitForNavigation({ waitUntil: "networkidle2", timeout: 30000 }).catch(() => null),
        page
          .waitForFunction(
            () =>
              document.body.innerText.includes("Numer księgi wieczystej") ||
              document.body.innerText.includes("Wynik wyszukiwania księgi wieczystej") ||
              document.body.innerText.includes("nie została znaleziona"),
            { timeout: 30000 },
          )
          .catch(() => null),
      ]);
    } catch (error: any) {
      const title = await page.title();
      const url = page.url();
      console.log(`DEBUG: Search click failed. URL: ${url}, Title: ${title}, Error: ${error.message}`);
      await page.screenshot({ path: createDebugFilePath("debug_click_fail", "png") });
      throw new Error("Nie udało się przejść do wyniku wyszukiwania. Sprawdź czy strona poprawnie się załadowała.");
    }

    const postSearchHtml = await page.content();
    saveDebugArtifacts("post_search", postSearchHtml);
    const protectionOrOutage = detectProtectionOrOutage(postSearchHtml);
    if (protectionOrOutage) {
      await page.screenshot({ path: createDebugFilePath("protection", "png") });
      throw new Error(protectionOrOutage);
    }

    const errorMsg = await page.$(".error-message");
    if (errorMsg) {
      const text = await page.evaluate((element) => element.textContent, errorMsg);
      throw new Error(`EKW Error: ${text}`);
    }

    console.log("Scraping basic information...");

    try {
      await page.waitForFunction(
        () =>
          document.body.innerText.includes("Numer księgi wieczystej") ||
          document.body.innerText.includes("Wynik wyszukiwania księgi wieczystej") ||
          document.body.innerText.includes("nie została znaleziona"),
        { timeout: 10000 },
      );
    } catch {
      console.log("Timeout waiting for results text, proceeding with current state...");
    }

    const summaryData = await page.evaluate(() => {
      const results: Record<string, string> = {};
      const debugLogs: string[] = [];

      const formRows = Array.from(document.querySelectorAll(".section .form-row"));
      debugLogs.push(`Main: Found ${formRows.length} form rows`);

      formRows.forEach((row, index) => {
        const label = (
          (row.querySelector(".label-column-50 label") as HTMLElement | null)?.innerText ||
          row.querySelector(".label-column-50 label")?.textContent ||
          ""
        )
          .replace(/\s+/g, " ")
          .trim();
        const valueContainer = row.querySelector(".content-column-50 .left") as HTMLElement | null;
        if (!label || !valueContainer) return;

        const paragraphValues = Array.from(valueContainer.querySelectorAll("p"))
          .map((element) => ((element as HTMLElement).innerText || element.textContent || "").replace(/\s+/g, " ").trim())
          .filter(Boolean);

        const fallbackValue = (valueContainer.innerText || valueContainer.textContent || "")
          .replace(/\s+/g, " ")
          .trim();
        const value = paragraphValues.length > 0 ? paragraphValues.join(" | ") : fallbackValue;

        if (value) {
          results[label] = value;
          debugLogs.push(`Main: Form row ${index} mapped: ${label}`);
        }
      });

      const tables = Array.from(document.querySelectorAll("table"));
      debugLogs.push(`Main: Found ${tables.length} tables`);

      if (Object.keys(results).length === 0) {
        tables.forEach((table, index) => {
          const text = (table as HTMLElement).innerText || table.textContent || "";
          if (text.includes("Numer księgi wieczystej") || text.includes("Typ księgi")) {
            debugLogs.push(`Main: Table ${index} is a data table.`);
            Array.from(table.querySelectorAll("tr")).forEach((row) => {
              const cells = Array.from(row.querySelectorAll("td, th"));
              if (cells.length < 2) return;

              const label = ((cells[0] as HTMLElement).innerText || cells[0].textContent || "")
                .replace(/\s+/g, " ")
                .trim()
                .replace(/:$/, "");
              const value = ((cells[1] as HTMLElement).innerText || cells[1].textContent || "")
                .replace(/\s+/g, " ")
                .trim();
              if (label && value && label.length < 100 && !label.includes("http")) {
                results[label] = value;
              }
            });
          }
        });
      }

      debugLogs.push(`Current URL: ${window.location.href}`);
      debugLogs.push(`Current Title: ${document.title}`);

      return { results, debugLogs };
    });

    console.log("SCRAPER DEBUG LOGS:");
    summaryData.debugLogs.forEach((log) => console.log(`  > ${log}`));

    let finalResults = summaryData.results;

    if (Object.keys(finalResults).length === 0) {
      console.log("Main page empty, checking frames...");
      const frames = page.frames();
      for (const frame of frames) {
        if (frame === page.mainFrame()) continue;
        console.log(`Checking frame: ${frame.url()}`);
        try {
          const frameData = await frame.evaluate(() => {
            const results: Record<string, string> = {};

            Array.from(document.querySelectorAll(".section .form-row")).forEach((row) => {
              const label = (
                (row.querySelector(".label-column-50 label") as HTMLElement | null)?.innerText ||
                row.querySelector(".label-column-50 label")?.textContent ||
                ""
              )
                .replace(/\s+/g, " ")
                .trim();
              const valueContainer = row.querySelector(".content-column-50 .left") as HTMLElement | null;
              if (!label || !valueContainer) return;

              const paragraphValues = Array.from(valueContainer.querySelectorAll("p"))
                .map((element) => ((element as HTMLElement).innerText || element.textContent || "").replace(/\s+/g, " ").trim())
                .filter(Boolean);

              const fallbackValue = (valueContainer.innerText || valueContainer.textContent || "")
                .replace(/\s+/g, " ")
                .trim();
              const value = paragraphValues.length > 0 ? paragraphValues.join(" | ") : fallbackValue;

              if (value) {
                results[label] = value;
              }
            });

            if (Object.keys(results).length > 0) {
              return results;
            }

            Array.from(document.querySelectorAll("table")).forEach((table) => {
              const text = (table as HTMLElement).innerText || table.textContent || "";
              if (!text.includes("Numer księgi wieczystej")) return;

              Array.from(table.querySelectorAll("tr")).forEach((row) => {
                const cells = Array.from(row.querySelectorAll("td, th"));
                if (cells.length < 2) return;

                const label = ((cells[0] as HTMLElement).innerText || cells[0].textContent || "")
                  .replace(/\s+/g, " ")
                  .trim()
                  .replace(/:$/, "");
                const value = ((cells[1] as HTMLElement).innerText || cells[1].textContent || "")
                  .replace(/\s+/g, " ")
                  .trim();
                if (label && value && label.length < 100) {
                  results[label] = value;
                }
              });
            });

            return results;
          });

          if (Object.keys(frameData).length > 0) {
            console.log("Data found in frame!");
            finalResults = frameData;
            break;
          }
        } catch {
          console.log(`Could not access frame ${frame.url()}`);
        }
      }
    }

    if (Object.keys(finalResults).length === 0) {
      console.log("Browser-side scraping failed, trying server-side Cheerio parsing...");
      const fallbackHtml = await page.content();
      finalResults = extractRowsFromCheerio(fallbackHtml);
      if (Object.keys(finalResults).length === 0) {
        saveDebugArtifacts("empty_parse", fallbackHtml);
      }
    }

    console.log("FINAL EXTRACTED DATA:", JSON.stringify(finalResults, null, 2));

    return {
      fullNumber,
      rawHtml: await page.content(),
      parsedData: Object.keys(finalResults).length > 0 ? { "Informacje Podstawowe": finalResults } : null,
    };
  } catch (error) {
    console.error(`Scrape failed for ${fullNumber}:`, error);
    throw error;
  } finally {
    await browser.close();
  }
}

function parseSection(html: string) {
  return extractRowsFromCheerio(html);
}
