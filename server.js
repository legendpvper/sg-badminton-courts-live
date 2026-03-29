/**
 * SG Outdoor Badminton Courts - Backend Server
 */

const express = require("express");
const fetch = require("node-fetch");
const cors = require("cors");
const path = require("path");
const { Redis } = require("@upstash/redis");

// Load .env for local dev (Vercel injects env vars automatically in production)
try { require("dotenv").config(); } catch(e) {}

const app = express();
const PORT = process.env.PORT || 3000;

// Upstash Redis client — HTTP-based, works perfectly on serverless
const redis = new Redis({
  url:   process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// In-memory geocode cache (this one is fine to stay in-memory — it's just coordinates)
const geocodeCache = new Map();

const STATUS_TTL_SECONDS = 2 * 60 * 60; // 2 hours — Redis handles expiry natively

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ─────────────────────────────────────────────
//  Court Availability — backed by Upstash Redis
// ─────────────────────────────────────────────

// GET /api/courts/statuses — returns all court statuses
app.get("/api/courts/statuses", async (req, res) => {
  try {
    // Scan for all court status keys
    const keys = await redis.keys("court:*:status");
    if (!keys || keys.length === 0) return res.json({});

    // Fetch all values in one round trip
    const values = await Promise.all(keys.map(k => redis.get(k)));

    const result = {};
    keys.forEach((key, i) => {
      const id = key.split(":")[1]; // "court:5:status" → "5"
      if (values[i]) result[id] = values[i];
    });

    return res.json(result);
  } catch (err) {
    console.error("Redis GET statuses error:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/courts/:id/status  body: { status: 'occupied'|'available' }
app.post("/api/courts/:id/status", async (req, res) => {
  const id = parseInt(req.params.id);
  const { status } = req.body;

  if (!["occupied", "available"].includes(status)) {
    return res.status(400).json({ error: "status must be 'occupied' or 'available'" });
  }

  const entry = {
    status,
    updatedAt: new Date().toISOString(),
  };

  try {
    const key = `court:${id}:status`;
	if (status === "occupied") {
	  await redis.set(key, entry, { ex: STATUS_TTL_SECONDS });
	  // Record booking timestamp for popularity tracking (kept for 8 days)
	  await redis.lpush(`bookings:${id}`, Date.now());
	  await redis.expire(`bookings:${id}`, 8 * 24 * 60 * 60); // 8 days TTL, slightly longer than window
    } else {
      // Available — store without expiry (available is the default state)
      await redis.set(key, entry);
    }
    return res.json({ id, ...entry });
  } catch (err) {
    console.error("Redis SET status error:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
//  Court Popularity — rolling 7-day booking count
//  Incremented every time a court is marked occupied.
//  Redis sorted set: key = "popularity", member = courtId, score = count
//  Each booking also stored as a timestamped entry to allow 7-day rolling window.
// ─────────────────────────────────────────────

// GET /api/courts/popularity — returns booking counts for all courts in last 7 days
app.get("/api/courts/popularity", async (req, res) => {
  try {
    const now = Date.now();
    const cutoff = now - (7 * 24 * 60 * 60 * 1000); // 7 days ago

    // Get all court booking keys
    const keys = await redis.keys("bookings:*");
    if (!keys || keys.length === 0) return res.json({});

    const result = {};
    for (const key of keys) {
      const courtId = key.split(":")[1];
      // Each court has a list of timestamps
      const timestamps = await redis.lrange(key, 0, -1);
      // Count only those within the last 7 days
      const recentCount = timestamps.filter(ts => parseInt(ts) > cutoff).length;
      if (recentCount > 0) result[courtId] = recentCount;
    }

    return res.json(result);
  } catch (err) {
    console.error("Redis popularity error:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
//  NEA 2-Hour Weather Nowcast Proxy
//  GET /api/weather
//  Proxies data.gov.sg to avoid CORS issues
// ─────────────────────────────────────────────
app.get("/api/weather", async (req, res) => {
  try {
    const url = "https://api.data.gov.sg/v1/environment/2-hour-weather-forecast";
    const response = await fetch(url, {
      headers: { "User-Agent": "SG-Badminton-Courts-App/1.0" }
    });
    if (!response.ok) throw new Error(`NEA API responded with ${response.status}`);
    const data = await response.json();
    return res.json(data);
  } catch (err) {
    console.error("Weather fetch error:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
//  OneMap Geocode Proxy (unchanged)
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
    const url = `https://www.onemap.gov.sg/api/common/elastic/search?searchVal=${encoded}&returnGeom=Y&getAddrDetails=Y&pageNum=1`;
    const response = await fetch(url, { headers: { "User-Agent": "SG-Badminton-Courts-App/1.0" } });
    if (!response.ok) throw new Error(`OneMap API responded with ${response.status}`);
    const data = await response.json();

    if (data.results && data.results.length > 0) {
      const best = data.results[0];
      const result = {
        lat: parseFloat(best.LATITUDE), lng: parseFloat(best.LONGITUDE),
        address: best.ADDRESS, block: best.BLK_NO, road: best.ROAD_NAME,
        postal: best.POSTAL, building: best.BUILDING,
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
//  Batch Geocode (unchanged)
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
      const response = await fetch(url, { headers: { "User-Agent": "SG-Badminton-Courts-App/1.0" } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();

      if (data.results && data.results.length > 0) {
        const best = data.results[0];
        const result = {
          lat: parseFloat(best.LATITUDE), lng: parseFloat(best.LONGITUDE),
          address: best.ADDRESS, block: best.BLK_NO, road: best.ROAD_NAME,
          postal: best.POSTAL, building: best.BUILDING,
        };
        geocodeCache.set(cacheKey, result);
        results[court.id] = result;
      } else {
        results[court.id] = null;
      }
      await new Promise((r) => setTimeout(r, 200));
    } catch (err) {
      console.error(`Geocode failed for court ${court.id}:`, err.message);
      results[court.id] = null;
    }
  }

  return res.json({ results });
});

// ─────────────────────────────────────────────
//  OneMap Reverse Geocode Proxy (unchanged)
// ─────────────────────────────────────────────
app.get("/api/reverse", async (req, res) => {
  const { lat, lng } = req.query;
  if (!lat || !lng) return res.status(400).json({ error: "lat and lng params required" });

  try {
    const url = `https://www.onemap.gov.sg/api/public/revgeocode?location=${lat},${lng}&buffer=40&addressType=All&otherFeatures=N`;
    const response = await fetch(url, { headers: { "User-Agent": "SG-Badminton-Courts-App/1.0" } });
    if (!response.ok) throw new Error(`OneMap API responded with ${response.status}`);
    const data = await response.json();
    return res.json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Serve SPA
app.get('/sw.js', (req, res) => {
  res.setHeader('Service-Worker-Allowed', '/');
  res.sendFile(path.join(__dirname, 'public', 'sw.js'));
});

app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════╗
║   SG Outdoor Badminton Courts Finder                 ║
║   Server running at http://localhost:${PORT}            ║
║   Availability backed by Upstash Redis               ║
╚══════════════════════════════════════════════════════╝
  `);
});