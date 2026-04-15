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
    await page.goto("https://przegladarka-ekw.ms.gov.pl/eukw_prz/KsiegiWieczyste/wyszukiwanieKW", {
      waitUntil: "networkidle2",
    });

    // Fill the form
    await page.type("#kodWydzialuInput", prefix);
    await page.type("#numerKsiegiWieczystejInput", number);
    await page.type("#cyfraKontrolnaInput", checkDigit.toString());

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
    await page.click("input[value='Przeglądanie aktualnej treści KW']");
    await page.waitForNavigation({ waitUntil: "networkidle2" });

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
