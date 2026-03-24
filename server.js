/**
 * SG Outdoor Badminton Courts - Backend Server
 * 
 * This Express server:
 *  1. Serves the static frontend (index.html)
 *  2. Proxies OneMap API requests to avoid CORS issues
 *  3. Provides a geocoding endpoint to resolve court addresses → lat/lng
 *  4. Caches geocoded results to avoid repeat API calls
 *
 * OneMap API docs: https://www.onemap.gov.sg/apidocs/
 * The Search endpoint is FREE and requires no authentication.
 * Format: GET https://www.onemap.gov.sg/api/common/elastic/search?searchVal=...&returnGeom=Y&getAddrDetails=Y
 */

const express = require("express");
const fetch = require("node-fetch");
const cors = require("cors");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// In-memory geocode cache so we don't hammer OneMap on every refresh
const geocodeCache = new Map();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ─────────────────────────────────────────────
//  OneMap Search / Geocode Proxy
//  GET /api/geocode?address=306+Hougang+Ave+5
// ─────────────────────────────────────────────
app.get("/api/geocode", async (req, res) => {
  const { address } = req.query;
  if (!address) return res.status(400).json({ error: "address param required" });

  const cacheKey = address.toLowerCase().trim();
  if (geocodeCache.has(cacheKey)) {
    return res.json({ source: "cache", result: geocodeCache.get(cacheKey) });
  }

  try {
    const encoded = encodeURIComponent(address);
    // OneMap Search API (no auth needed for public search)
    const url = `https://www.onemap.gov.sg/api/common/elastic/search?searchVal=${encoded}&returnGeom=Y&getAddrDetails=Y&pageNum=1`;

    const response = await fetch(url, {
      headers: { "User-Agent": "SG-Badminton-Courts-App/1.0" }
    });

    if (!response.ok) {
      throw new Error(`OneMap API responded with ${response.status}`);
    }

    const data = await response.json();

    if (data.results && data.results.length > 0) {
      const best = data.results[0];
      const result = {
        lat: parseFloat(best.LATITUDE),
        lng: parseFloat(best.LONGITUDE),
        address: best.ADDRESS,
        block: best.BLK_NO,
        road: best.ROAD_NAME,
        postal: best.POSTAL,
        building: best.BUILDING,
      };
      geocodeCache.set(cacheKey, result);
      return res.json({ source: "onemap", result });
    } else {
      return res.json({ source: "onemap", result: null });
    }
  } catch (err) {
    console.error("Geocode error:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
//  Batch Geocode: geocodes all courts at startup
//  POST /api/geocode-batch  body: { courts: [{id, addr}] }
// ─────────────────────────────────────────────
app.post("/api/geocode-batch", async (req, res) => {
  const { courts } = req.body;
  if (!Array.isArray(courts)) return res.status(400).json({ error: "courts array required" });

  const results = {};

  for (const court of courts) {
    const cacheKey = court.addr.toLowerCase().trim();
    if (geocodeCache.has(cacheKey)) {
      results[court.id] = geocodeCache.get(cacheKey);
      continue;
    }

    try {
      const encoded = encodeURIComponent(court.addr);
      const url = `https://www.onemap.gov.sg/api/common/elastic/search?searchVal=${encoded}&returnGeom=Y&getAddrDetails=Y&pageNum=1`;

      const response = await fetch(url, {
        headers: { "User-Agent": "SG-Badminton-Courts-App/1.0" }
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const data = await response.json();

      if (data.results && data.results.length > 0) {
        const best = data.results[0];
        const result = {
          lat: parseFloat(best.LATITUDE),
          lng: parseFloat(best.LONGITUDE),
          address: best.ADDRESS,
          block: best.BLK_NO,
          road: best.ROAD_NAME,
          postal: best.POSTAL,
          building: best.BUILDING,
        };
        geocodeCache.set(cacheKey, result);
        results[court.id] = result;
      } else {
        results[court.id] = null;
      }

      // Rate limit: 200ms between requests to be respectful of OneMap
      await new Promise((r) => setTimeout(r, 200));
    } catch (err) {
      console.error(`Geocode failed for court ${court.id} (${court.addr}):`, err.message);
      results[court.id] = null;
    }
  }

  return res.json({ results });
});

// ─────────────────────────────────────────────
//  OneMap Reverse Geocode Proxy
//  GET /api/reverse?lat=1.372&lng=103.892
// ─────────────────────────────────────────────
app.get("/api/reverse", async (req, res) => {
  const { lat, lng } = req.query;
  if (!lat || !lng) return res.status(400).json({ error: "lat and lng params required" });

  try {
    const url = `https://www.onemap.gov.sg/api/public/revgeocode?location=${lat},${lng}&buffer=40&addressType=All&otherFeatures=N`;
    const response = await fetch(url, {
      headers: { "User-Agent": "SG-Badminton-Courts-App/1.0" }
    });

    if (!response.ok) throw new Error(`OneMap API responded with ${response.status}`);
    const data = await response.json();
    return res.json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Serve the SPA for all other routes
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════╗
║   SG Outdoor Badminton Courts Finder                 ║
║   Server running at http://localhost:${PORT}            ║
║                                                      ║
║   Open your browser and go to:                       ║
║   → http://localhost:${PORT}                           ║
║                                                      ║
║   OneMap API: Free, no key needed for search         ║
║   Tile maps sourced from OneMap SLA                  ║
╚══════════════════════════════════════════════════════╝
  `);
});
