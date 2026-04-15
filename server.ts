import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import cors from "cors";
import bodyParser from "body-parser";
import { scrapeEkw } from "./scraper.ts";
import { saveRegister, getRegisters, getRegisterByNumber } from "./src/database.ts";
import { calculateCheckDigit } from "./src/utils/ekw.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(bodyParser.json());

  // API Routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  app.get("/api/registers", (req, res) => {
    try {
      const registers = getRegisters();
      res.json(registers);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch registers" });
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
        status: "success"
      });

      res.json(result);
    } catch (error: any) {
      console.error(error);
      res.status(500).json({ error: error.message || "Scraping failed" });
    }
  });

  app.post("/api/bulk-start", async (req, res) => {
    const { prefix, startNumber, count } = req.body;
    // Simple background task simulation
    res.json({ message: "Bulk scraping started in background" });
    
    (async () => {
      for (let i = 0; i < count; i++) {
        const currentNum = (parseInt(startNumber, 10) + i).toString().padStart(8, '0');
        try {
          const checkDigit = calculateCheckDigit(prefix, currentNum);
          const result = await scrapeEkw(prefix, currentNum);
          saveRegister({
            prefix,
            number: currentNum,
            checkDigit,
            content: result.rawHtml,
            parsedData: result.parsedData,
            status: "success"
          });
          // Add delay to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 5000));
        } catch (err) {
          console.error(`Bulk scrape failed for ${currentNum}`);
        }
      }
    })();
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
