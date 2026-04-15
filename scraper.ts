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
        page.waitForSelector("#numerKsiegiWieczystejInput", { timeout: 15000 }),
        page.waitForSelector("#cyfraKontrolnaInput", { timeout: 15000 })
      ]);
    } catch (e) {
      const content = await page.content();
      const title = await page.title();
      const url = page.url();
      
      // Inspect frames
      const frames = page.frames();
      console.log(`DEBUG: Total frames: ${frames.length}`);
      for (let i = 0; i < frames.length; i++) {
        console.log(`DEBUG: Frame ${i} URL: ${frames[i].url()}`);
      }

      // List all inputs on the main page
      const inputs = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('input, select, button')).map(el => ({
          tag: el.tagName,
          id: el.id,
          name: (el as any).name,
          value: (el as any).value,
          type: (el as any).type
        }));
      });
      console.log(`DEBUG: Found ${inputs.length} inputs on main page:`, JSON.stringify(inputs));

      // Save screenshot for debugging
      const screenshotPath = `debug_fail_${Date.now()}.png`;
      await page.screenshot({ path: screenshotPath, fullPage: true });
      console.log(`DEBUG: Screenshot saved to ${screenshotPath}`);

      if (content.includes("Przerwa techniczna")) throw new Error("Serwis EKW ma przerwę techniczną.");
      if (content.includes("verify you are human") || content.includes("cloudflare")) throw new Error("Wykryto blokadę Cloudflare/CAPTCHA.");
      
      throw new Error(`Nie znaleziono pól formularza. Znaleziono ${inputs.length} elementów wejściowych. Sprawdź logi konsoli.`);
    }

    // Fill the form with human-like delays
    console.log(`Filling form for ${fullNumber}...`);
    await page.focus("#kodWydzialuInput");
    await page.keyboard.type(prefix.toUpperCase(), { delay: 150 });
    
    await page.focus("#numerKsiegiWieczystejInput");
    await page.keyboard.type(number, { delay: 150 });
    
    await page.focus("#cyfraKontrolnaInput");
    await page.keyboard.type(checkDigit.toString(), { delay: 150 });

    // Check for CAPTCHA
    const captchaExists = await page.$("#captcha");
    if (captchaExists) {
      console.log("CAPTCHA detected. Manual intervention or solver needed.");
      // In a real scenario, we'd use a solver service or wait for manual input
      // For this demo, we'll take a screenshot and throw an error
      await page.screenshot({ path: `captcha_${Date.now()}.png` });
      throw new Error("CAPTCHA detected. Automated solving not implemented in this demo.");
    }

    await page.click("#wyszukaj");
    await page.waitForNavigation({ waitUntil: "networkidle2" });

    // Check if register found
    const errorMsg = await page.$(".error-message");
    if (errorMsg) {
      const text = await page.evaluate(el => el.textContent, errorMsg);
      throw new Error(`EKW Error: ${text}`);
    }

    // Navigate to "Przeglądanie aktualnej treści KW"
    try {
      await page.waitForSelector("input[value='Przeglądanie aktualnej treści KW']", { timeout: 10000 });
      await page.click("input[value='Przeglądanie aktualnej treści KW']");
      await page.waitForNavigation({ waitUntil: "networkidle2" });
    } catch (e) {
      throw new Error("Nie znaleziono przycisku 'Przeglądanie aktualnej treści KW'. Możliwe, że księga nie istnieje lub wystąpił błąd sesji.");
    }

    // Now we are in the register view. We need to scrape all sections (Dział I-O, I-Sp, II, III, IV)
    const sections = ["Dział I-O", "Dział I-Sp", "Dział II", "Dział III", "Dział IV"];
    const results: any = {};

    for (const section of sections) {
      // Find button for section and click
      const buttons = await page.$$("input[type='submit']");
      for (const btn of buttons) {
        const val = await page.evaluate(el => (el as HTMLInputElement).value, btn);
        if (val.includes(section)) {
          await btn.click();
          await page.waitForNavigation({ waitUntil: "networkidle2" });
          
          const html = await page.content();
          results[section] = parseSection(html);
          break;
        }
      }
    }

    return {
      fullNumber,
      rawHtml: await page.content(),
      parsedData: results
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
