import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { calculateCheckDigit } from "./src/utils/ekw.ts";
import * as cheerio from "cheerio";

puppeteer.use(StealthPlugin());

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
    
    // Set a realistic user agent
    await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");

    console.log(`Navigating to EKW main page to initialize session...`);
    await page.goto("https://przegladarka-ekw.ms.gov.pl/eukw_prz/KsiegiWieczyste/main.do", {
      waitUntil: "networkidle2",
      timeout: 60000,
    });

    // Click on "Wyszukiwanie księgi wieczystej"
    console.log(`Clicking on search link...`);
    const searchLinkSelector = "a[href*='wyszukiwanieKW']";
    try {
      await page.waitForSelector(searchLinkSelector, { timeout: 10000 });
      await page.click(searchLinkSelector);
      await page.waitForNavigation({ waitUntil: "networkidle2" });
    } catch (e) {
      console.log("Could not find search link, trying direct navigation...");
      await page.goto("https://przegladarka-ekw.ms.gov.pl/eukw_prz/KsiegiWieczyste/wyszukiwanieKW", {
        waitUntil: "networkidle2",
        timeout: 60000,
      });
    }

    // Wait for all form elements to be sure
    console.log(`Waiting for form elements...`);
    try {
      await Promise.all([
        page.waitForSelector("#kodWydzialuInput", { timeout: 15000 }),
        page.waitForSelector("#numerKsiegiWieczystej", { timeout: 15000 }),
        page.waitForSelector("#cyfraKontrolna", { timeout: 15000 })
      ]);
    } catch (e) {
      // ... (keep existing debug logic)
      const content = await page.content();
      const title = await page.title();
      const url = page.url();
      
      // Inspect frames
      const frames = page.frames();
      console.log(`DEBUG: Total frames: ${frames.length}`);
      
      const inputs = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('input, select, button')).map(el => ({
          tag: el.tagName,
          id: el.id,
          name: (el as any).name,
          value: (el as any).value,
          type: (el as any).type
        }));
      });
      console.log(`DEBUG: Found ${inputs.length} inputs:`, JSON.stringify(inputs));

      if (content.includes("Przerwa techniczna")) throw new Error("Serwis EKW ma przerwę techniczną.");
      if (content.includes("verify you are human") || content.includes("cloudflare")) throw new Error("Wykryto blokadę Cloudflare/CAPTCHA.");
      
      throw new Error(`Nie znaleziono pól formularza. Sprawdź logi.`);
    }

    // Fill the form with human-like delays
    console.log(`Filling form for ${fullNumber}...`);
    await page.focus("#kodWydzialuInput");
    await page.keyboard.type(prefix.toUpperCase(), { delay: 150 });
    
    await page.focus("#numerKsiegiWieczystej");
    await page.keyboard.type(number, { delay: 150 });
    
    await page.focus("#cyfraKontrolna");
    await page.keyboard.type(checkDigit.toString(), { delay: 150 });

    // Click search button
    console.log(`Clicking search button...`);
    try {
      await page.waitForSelector("#wyszukaj", { timeout: 10000 });
      
      // Small delay to ensure any overlays are gone
      await new Promise(r => setTimeout(r, 500));
      
      const clicked = await page.evaluate(() => {
        const btn = document.querySelector("#wyszukaj") as HTMLButtonElement;
        if (btn) {
          btn.click();
          return true;
        }
        return false;
      });

      if (!clicked) {
        await page.click("#wyszukaj");
      }
      
      await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 30000 });
    } catch (e: any) {
      const title = await page.title();
      const url = page.url();
      console.log(`DEBUG: Search click failed. URL: ${url}, Title: ${title}, Error: ${e.message}`);
      await page.screenshot({ path: `debug_click_fail_${Date.now()}.png` });
      throw new Error(`Nie udało się kliknąć przycisku wyszukiwania. Sprawdź czy strona się załadowała.`);
    }

    // Check for CAPTCHA
    const captchaExists = await page.$("#captcha");
    if (captchaExists) {
      console.log("CAPTCHA detected. Manual intervention or solver needed.");
      await page.screenshot({ path: `captcha_${Date.now()}.png` });
      throw new Error("Wykryto CAPTCHA. Automatyczne rozwiązywanie nie jest zaimplementowane.");
    }

    // Check if register found
    const errorMsg = await page.$(".error-message");
    if (errorMsg) {
      const text = await page.evaluate(el => el.textContent, errorMsg);
      throw new Error(`EKW Error: ${text}`);
    }

    // Scrape basic information from the summary page
    console.log(`Scraping basic information...`);
    
    // Wait for a known element on the results page or a timeout
    try {
      await page.waitForFunction(
        () => document.body.innerText.includes("Numer księgi wieczystej") || 
              document.body.innerText.includes("nie została znaleziona"),
        { timeout: 10000 }
      );
    } catch (e) {
      console.log("Timeout waiting for results text, proceeding with current state...");
    }

    const summaryData = await page.evaluate(() => {
      const results: Record<string, string> = {};
      const debugLogs: string[] = [];
      
      const doc = document;
      const prefix = "Main: ";
      
      const tables = Array.from(doc.querySelectorAll('table'));
      debugLogs.push(`${prefix}Found ${tables.length} tables`);
      
      tables.forEach((table, index) => {
        const text = (table as HTMLElement).innerText || table.textContent || "";
        if (text.includes("Numer księgi wieczystej") || text.includes("Typ księgi")) {
          debugLogs.push(`${prefix}Table ${index} is a data table.`);
          const rows = Array.from(table.querySelectorAll('tr'));
          rows.forEach((row) => {
            const cells = Array.from(row.querySelectorAll('td, th'));
            if (cells.length >= 2) {
              const label = ((cells[0] as HTMLElement).innerText || cells[0].textContent || "").trim().replace(/:$/, "");
              const value = ((cells[1] as HTMLElement).innerText || cells[1].textContent || "").trim();
              if (label && value && label.length < 100 && !label.includes("http")) {
                results[label] = value;
              }
            }
          });
        }
      });

      if (Object.keys(results).length === 0) {
        debugLogs.push(`${prefix}Trying broader search...`);
        // Try to find any element that looks like a label-value pair
        const allElements = Array.from(doc.querySelectorAll('tr, div, p, span'));
        allElements.forEach(el => {
          const text = (el as HTMLElement).innerText || el.textContent || "";
          if (text.includes(':') && text.length < 200) {
            const parts = text.split(':');
            if (parts.length >= 2) {
              const label = parts[0].trim();
              const value = parts.slice(1).join(':').trim();
              if (label && value && label.length < 50 && value.length < 500 && !label.includes("http")) {
                if (!results[label]) results[label] = value;
              }
            }
          }
        });
      }

      debugLogs.push(`Current URL: ${window.location.href}`);
      debugLogs.push(`Current Title: ${document.title}`);
      
      return { results, debugLogs };
    });

    console.log("SCRAPER DEBUG LOGS:");
    summaryData.debugLogs.forEach(log => console.log(`  > ${log}`));
    
    let finalResults = summaryData.results;

    // If main document failed, try frames
    if (Object.keys(finalResults).length === 0) {
      console.log("Main page empty, checking frames...");
      const frames = page.frames();
      for (const frame of frames) {
        if (frame === page.mainFrame()) continue;
        console.log(`Checking frame: ${frame.url()}`);
        try {
          const frameData = await frame.evaluate(() => {
            const res: Record<string, string> = {};
            const tables = Array.from(document.querySelectorAll('table'));
            tables.forEach(table => {
              const text = (table as HTMLElement).innerText || table.textContent || "";
              if (text.includes("Numer księgi wieczystej")) {
                Array.from(table.querySelectorAll('tr')).forEach(row => {
                  const cells = Array.from(row.querySelectorAll('td, th'));
                  if (cells.length >= 2) {
                    const label = ((cells[0] as HTMLElement).innerText || cells[0].textContent || "").trim().replace(/:$/, "");
                    const value = ((cells[1] as HTMLElement).innerText || cells[1].textContent || "").trim();
                    if (label && value && label.length < 100) res[label] = value;
                  }
                });
              }
            });
            return res;
          });
          if (Object.keys(frameData).length > 0) {
            console.log("Data found in frame!");
            finalResults = frameData;
            break;
          }
        } catch (e) {
          console.log(`Could not access frame ${frame.url()}`);
        }
      }
    }

    // Fallback: Server-side parsing with Cheerio if browser-side failed
    if (Object.keys(finalResults).length === 0) {
      console.log("Browser-side scraping failed, trying server-side Cheerio parsing...");
      const html = await page.content();
      const $ = cheerio.load(html);
      
      $("table").each((_, table) => {
        const tableText = $(table).text();
        if (tableText.includes("Numer księgi wieczystej") || tableText.includes("Typ księgi")) {
          $(table).find("tr").each((_, row) => {
            const cells = $(row).find("td, th");
            if (cells.length >= 2) {
              const label = $(cells[0]).text().trim().replace(/:$/, "");
              const value = $(cells[1]).text().trim();
              if (label && value && label.length < 100 && !label.includes("http")) {
                finalResults[label] = value;
              }
            }
          });
        }
      });
    }

    console.log("FINAL EXTRACTED DATA:", JSON.stringify(finalResults, null, 2));

    return {
      fullNumber,
      rawHtml: await page.content(),
      parsedData: Object.keys(finalResults).length > 0 ? { "Informacje Podstawowe": finalResults } : null
    };

  } catch (error) {
    console.error(`Scrape failed for ${fullNumber}:`, error);
    throw error;
  } finally {
    await browser.close();
  }
}

function parseSection(html: string) {
  const $ = cheerio.load(html);
  const data: any = {};
  
  // Basic parsing logic - EKW structure is tables
  $("table tr").each((i, el) => {
    const label = $(el).find("td.label").text().trim();
    const value = $(el).find("td.value").text().trim();
    if (label) {
      data[label] = value;
    }
  });

  return data;
}
