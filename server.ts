import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import cors from "cors";
import bodyParser from "body-parser";
import { parseEkwHtml, scrapeEkw } from "./scraper.ts";
import {
  enqueueRegisters,
  getBatchQueue,
  getBatchStats,
  getNextQueueItem,
  getRegisters,
  getQueueItemByFullNumber,
  resetQueueItem,
  saveRegister,
  updateQueueStatus,
} from "./src/database.ts";
import { calculateCheckDigit, formatEkwNumber } from "./src/utils/ekw.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function inferFullNumber(parsedData: any) {
  const section = parsedData?.["Informacje Podstawowe"];
  if (!section || typeof section !== "object") return null;

  const rawEntry = Object.entries(section).find(([label]) => label.toLowerCase().includes("numer ksi"));
  if (!rawEntry) return null;

  const value = rawEntry[1];
  return typeof value === "string" ? value.trim() : null;
}

function parseFullNumber(fullNumber: string | null) {
  if (!fullNumber) return null;

  const match = fullNumber.match(/^([A-Z0-9]{4})\/(\d{8})\/(\d)$/);
  if (!match) return null;

  return {
    prefix: match[1],
    number: match[2],
    checkDigit: Number(match[3]),
    fullNumber,
  };
}

function buildBookmarklet() {
  const payload = `
    (() => {
      const html = document.documentElement.outerHTML;
      const detected = document.body.innerText.match(/[A-Z0-9]{4}\\/\\d{8}\\/\\d/);
      fetch('http://localhost:3000/api/ingest-html', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          html,
          fullNumber: detected ? detected[0] : null
        })
      })
        .then(async (res) => {
          const data = await res.json();
          if (!res.ok || data.error) {
            throw new Error(data.error || 'Import nie powiódł się');
          }
          alert('Zaimportowano ' + (data.fullNumber || 'wynik') + '.');
        })
        .catch((error) => {
          alert('Błąd importu: ' + error.message);
        });
    })();
  `;

  return `javascript:${encodeURIComponent(payload)}`;
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(bodyParser.json({ limit: "10mb" }));

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.get("/api/registers", (_req, res) => {
    try {
      res.json(getRegisters());
    } catch {
      res.status(500).json({ error: "Failed to fetch registers" });
    }
  });

  app.get("/api/batch-queue", (_req, res) => {
    try {
      res.json({
        stats: getBatchStats(),
        items: getBatchQueue(),
        next: getBatchQueue().find((item: any) => item.status === "pending" || item.status === "error") ?? null,
        bookmarklet: buildBookmarklet(),
      });
    } catch {
      res.status(500).json({ error: "Failed to fetch batch queue" });
    }
  });

  app.post("/api/batch-queue", (req, res) => {
    const { prefix, startNumber, count } = req.body;
    if (!prefix || !startNumber || !count) {
      return res.status(400).json({ error: "Prefix, startNumber and count are required" });
    }

    try {
      const normalizedPrefix = String(prefix).trim().toUpperCase();
      const start = Number.parseInt(String(startNumber), 10);
      const amount = Number.parseInt(String(count), 10);

      if (!Number.isInteger(start) || !Number.isInteger(amount) || amount <= 0) {
        return res.status(400).json({ error: "Invalid range values" });
      }

      const items = Array.from({ length: amount }, (_, index) => {
        const number = String(start + index).padStart(8, "0");
        const checkDigit = calculateCheckDigit(normalizedPrefix, number);
        return { prefix: normalizedPrefix, number, checkDigit, source: "range" };
      });

      const inserted = enqueueRegisters(items);

      res.json({
        inserted,
        stats: getBatchStats(),
        items: getBatchQueue(),
      });
    } catch (error: any) {
      console.error(error);
      res.status(500).json({ error: error.message || "Failed to create queue" });
    }
  });

  app.post("/api/batch-next", (_req, res) => {
    try {
      const item = getNextQueueItem();
      res.json({
        item: item ?? null,
        openUrl: item
          ? `https://przegladarka-ekw.ms.gov.pl/eukw_prz/KsiegiWieczyste/wyszukiwanieKW`
          : null,
      });
    } catch (error: any) {
      console.error(error);
      res.status(500).json({ error: error.message || "Failed to lock next queue item" });
    }
  });

  app.post("/api/batch-reset", (req, res) => {
    const { fullNumber } = req.body;
    if (!fullNumber) {
      return res.status(400).json({ error: "fullNumber is required" });
    }

    try {
      resetQueueItem(fullNumber);
      res.json({ ok: true, stats: getBatchStats(), items: getBatchQueue() });
    } catch (error: any) {
      console.error(error);
      res.status(500).json({ error: error.message || "Failed to reset queue item" });
    }
  });

  app.post("/api/search", async (req, res) => {
    const { prefix, number } = req.body;
    if (!prefix || !number) {
      return res.status(400).json({ error: "Prefix and number are required" });
    }

    try {
      const checkDigit = calculateCheckDigit(prefix, number);
      const result = await scrapeEkw(prefix, number);

      saveRegister({
        prefix,
        number,
        checkDigit,
        content: result.rawHtml,
        parsedData: result.parsedData,
        status: "success",
      });

      res.json(result);
    } catch (error: any) {
      console.error(error);
      res.status(500).json({ error: error.message || "Scraping failed" });
    }
  });

  app.post("/api/parse-html", async (req, res) => {
    const { html, prefix, number } = req.body;
    if (!html || typeof html !== "string") {
      return res.status(400).json({ error: "HTML is required" });
    }

    try {
      const result = parseEkwHtml(html);
      const inferred = parseFullNumber(inferFullNumber(result.parsedData));
      const normalizedPrefix = typeof prefix === "string" && prefix.trim() ? prefix.trim().toUpperCase() : inferred?.prefix;
      const normalizedNumber = typeof number === "string" && number.trim() ? number.trim() : inferred?.number;

      if (normalizedPrefix && normalizedNumber) {
        const checkDigit = calculateCheckDigit(normalizedPrefix, normalizedNumber);
        saveRegister({
          prefix: normalizedPrefix,
          number: normalizedNumber,
          checkDigit,
          content: result.rawHtml,
          parsedData: result.parsedData,
          status: "success",
        });
      }

      res.json({
        ...result,
        fullNumber: inferred?.fullNumber ?? null,
      });
    } catch (error: any) {
      console.error(error);
      res.status(500).json({ error: error.message || "HTML parsing failed" });
    }
  });

  app.post("/api/ingest-html", async (req, res) => {
    const { html, fullNumber } = req.body;
    if (!html || typeof html !== "string") {
      return res.status(400).json({ error: "HTML is required" });
    }

    try {
      const result = parseEkwHtml(html);
      const parsedNumber = parseFullNumber(fullNumber ?? inferFullNumber(result.parsedData));

      if (!parsedNumber) {
        return res.status(400).json({ error: "Nie udało się ustalić numeru KW dla importowanego dokumentu." });
      }

      const queueItem = getQueueItemByFullNumber(parsedNumber.fullNumber);
      if (!queueItem) {
        return res.status(404).json({ error: `Numer ${parsedNumber.fullNumber} nie istnieje w kolejce.` });
      }

      saveRegister({
        prefix: parsedNumber.prefix,
        number: parsedNumber.number,
        checkDigit: parsedNumber.checkDigit,
        content: result.rawHtml,
        parsedData: result.parsedData,
        status: "success",
      });

      updateQueueStatus(parsedNumber.fullNumber, "success", null);

      res.json({
        ok: true,
        fullNumber: parsedNumber.fullNumber,
        stats: getBatchStats(),
        items: getBatchQueue(),
      });
    } catch (error: any) {
      console.error(error);

      const parsedNumber = parseFullNumber(req.body?.fullNumber ?? null);
      if (parsedNumber) {
        updateQueueStatus(parsedNumber.fullNumber, "error", error.message || "Import failed");
      }

      res.status(500).json({ error: error.message || "HTML ingest failed" });
    }
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
