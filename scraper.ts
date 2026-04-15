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
    const summaryData = await page.evaluate(() => {
      const data: Record<string, string> = {};
      
      // Look for all table rows
      const rows = Array.from(document.querySelectorAll('table tr, div.row'));
      
      rows.forEach(row => {
        // Try different ways to find label and value
        let label = "";
        let value = "";

        // Standard table cells
        const cells = Array.from(row.querySelectorAll('td'));
        if (cells.length >= 2) {
          label = cells[0].textContent?.trim() || "";
          value = cells[1].textContent?.trim() || "";
        } else {
          // Div based layout or other
          const labelEl = row.querySelector('.label, .left, b, strong');
          const valueEl = row.querySelector('.value, .right, span:not(.label)');
          if (labelEl && valueEl) {
            label = labelEl.textContent?.trim() || "";
            value = valueEl.textContent?.trim() || "";
          }
        }

        // Clean up label
        label = label.replace(/:$/, "").trim();
        
        if (label && value && label.length < 100) {
          if (data[label]) {
            // Avoid duplicates if same text
            if (!data[label].includes(value)) {
              data[label] += `\n${value}`;
            }
          } else {
            data[label] = value;
          }
        }
      });

      // Fallback: if data is still empty, try to get anything that looks like a key-value pair
      if (Object.keys(data).length === 0) {
        const allText = document.body.innerText;
        const lines = allText.split('\n');
        lines.forEach(line => {
          if (line.includes(':')) {
            const [k, ...v] = line.split(':');
            const key = k.trim();
            const val = v.join(':').trim();
            if (key && val && key.length < 50) {
              data[key] = val;
            }
          }
        });
      }

      return data;
    });

    return {
      fullNumber,
      rawHtml: await page.content(),
      parsedData: { "Informacje Podstawowe": summaryData }
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
