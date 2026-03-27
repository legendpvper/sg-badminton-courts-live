/**
 * import-courts.js
 *
 * Queries OpenStreetMap via the Overpass API for badminton pitches in Singapore,
 * deduplicates against your existing COURTS array, and prints a formatted list
 * of new candidates for you to review before adding anything to the app.
 *
 * Usage:
 *   node scripts/import-courts.js
 *
 * No dependencies — uses Node's built-in fetch (Node 18+).
 */

// ─────────────────────────────────────────────────────────
//  Your existing courts — used for deduplication.
//  Any OSM result within DEDUP_RADIUS_M metres of one of
//  these will be skipped (it's probably already in the app).
// ─────────────────────────────────────────────────────────
const EXISTING_COURTS = [
  { id:1,  name:"Blk 306 Hougang Ave 5",          lat:1.3721, lng:103.8921 },
  { id:2,  name:"Blk 104 Hougang Ave 1",           lat:1.3698, lng:103.8897 },
  { id:3,  name:"Blk 413 Hougang Ave 10",          lat:1.3740, lng:103.8933 },
  { id:4,  name:"Blk 621 Hougang Ave 8",           lat:1.3762, lng:103.8944 },
  { id:5,  name:"Blk 501 Tampines Ave 4",          lat:1.3547, lng:103.9412 },
  { id:6,  name:"Blk 827 Tampines St 81",          lat:1.3522, lng:103.9451 },
  { id:7,  name:"Blk 159 Tampines St 12",          lat:1.3503, lng:103.9367 },
  { id:8,  name:"Blk 490 Tampines Ave 9",          lat:1.3560, lng:103.9440 },
  { id:9,  name:"Blk 601 Bedok North St 3",        lat:1.3364, lng:103.9263 },
  { id:10, name:"Blk 56 New Upper Changi Rd",      lat:1.3247, lng:103.9301 },
  { id:11, name:"Blk 201 Pasir Ris St 21",         lat:1.3703, lng:103.9499 },
  { id:12, name:"Blk 449 Pasir Ris Dr 6",          lat:1.3735, lng:103.9527 },
  { id:13, name:"Blk 211 Jurong East St 21",       lat:1.3423, lng:103.7363 },
  { id:14, name:"Blk 131 Jurong Gateway Rd",       lat:1.3330, lng:103.7402 },
  { id:15, name:"Blk 339 Yung Ho Rd",              lat:1.3487, lng:103.7196 },
  { id:16, name:"Blk 505 Jurong West Ave 1",       lat:1.3501, lng:103.7122 },
  { id:17, name:"Blk 303 Woodlands St 31",         lat:1.4362, lng:103.7883 },
  { id:18, name:"Blk 689 Woodlands Dr 75",         lat:1.4401, lng:103.7946 },
  { id:19, name:"Blk 401 Sembawang Dr",            lat:1.4490, lng:103.8191 },
  { id:20, name:"Blk 511 Yishun Ave 4",            lat:1.4263, lng:103.8336 },
  { id:21, name:"Blk 702 Yishun Ave 5",            lat:1.4241, lng:103.8367 },
  { id:22, name:"Blk 101 Ang Mo Kio Ave 2",        lat:1.3716, lng:103.8464 },
  { id:23, name:"Blk 347 Ang Mo Kio Ave 3",        lat:1.3691, lng:103.8501 },
  { id:24, name:"Blk 402 Bishan St 22",            lat:1.3527, lng:103.8454 },
  { id:25, name:"Blk 201 Toa Payoh Lor 2",         lat:1.3343, lng:103.8479 },
  { id:26, name:"Blk 76 Redhill Rd",               lat:1.2900, lng:103.8180 },
  { id:27, name:"Blk 152 Queenstown Rd",           lat:1.2985, lng:103.8063 },
  { id:28, name:"Blk 115 Bukit Merah View",        lat:1.2827, lng:103.8209 },
  { id:29, name:"Blk 503 Clementi Ave 3",          lat:1.3148, lng:103.7640 },
  { id:30, name:"Blk 511 West Coast Rd",           lat:1.3049, lng:103.7694 },
  { id:31, name:"Blk 62 Geylang Bahru",            lat:1.3180, lng:103.8679 },
  { id:32, name:"Blk 212 Serangoon Ave 4",         lat:1.3617, lng:103.8741 },
  { id:33, name:"Blk 107 Sengkang East Way",       lat:1.3924, lng:103.9003 },
  { id:34, name:"Blk 276C Punggol Field",          lat:1.4038, lng:103.9099 },
  { id:35, name:"Blk 601 Punggol Central",         lat:1.4011, lng:103.9019 },
  { id:36, name:"Blk 101 Buangkok Crescent",       lat:1.3849, lng:103.8896 },
  { id:37, name:"Blk 301 Choa Chu Kang Ave 2",     lat:1.3854, lng:103.7453 },
  { id:38, name:"Blk 452 Bukit Batok West Ave 6",  lat:1.3491, lng:103.7518 },
];

// Courts within this distance of an existing court are considered duplicates
const DEDUP_RADIUS_M = 150;

// Courts within this distance of each other are clustered into one location.
// OSM maps individual court outlines — 6 courts at one void deck = 6 OSM entries.
// We group them into a single candidate and report the count instead.
const CLUSTER_RADIUS_M = 80;

// Singapore's actual land boundary bounding box (tighter than before).
// Excludes Batam, Bintan, and other nearby Indonesian islands.
const SG_BOUNDS = { minLat: 1.205, maxLat: 1.481, minLng: 103.605, maxLng: 104.010 };

// Known indoor/commercial venues to skip by name keyword (case-insensitive).
// These are paid venues, not free outdoor community courts.
const SKIP_NAME_KEYWORDS = [
  'singapore badminton hall', 'badminton hall', 'sports hall',
  'stadium', 'activesg', 'community centre', 'cc ', ' cc',
  'club', 'hotel', 'resort', 'condominium', 'condo', 'ec ',
  'gor bulutangkis', 'lapangan badminton', // Indonesian — outside SG
  'eco botanic', // private condo
  'outstanding badminton', 'oustanding badminton', // commercial
  'elite badminton', // commercial
  'mph', // multi-purpose hall, likely not outdoor
];

function isKnownVenue(name) {
  if (!name) return false;
  const lower = name.toLowerCase();
  return SKIP_NAME_KEYWORDS.some(kw => lower.includes(kw));
}

function isInSingapore(lat, lng) {
  return lat >= SG_BOUNDS.minLat && lat <= SG_BOUNDS.maxLat &&
         lng >= SG_BOUNDS.minLng && lng <= SG_BOUNDS.maxLng;
}

// ─────────────────────────────────────────────────────────
//  Haversine distance between two lat/lng points (metres)
// ─────────────────────────────────────────────────────────
function distanceMetres(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function isDuplicate(lat, lng) {
  return EXISTING_COURTS.some(c => distanceMetres(lat, lng, c.lat, c.lng) < DEDUP_RADIUS_M);
}

function nearestExisting(lat, lng) {
  let nearest = null, minDist = Infinity;
  for (const c of EXISTING_COURTS) {
    const d = distanceMetres(lat, lng, c.lat, c.lng);
    if (d < minDist) { minDist = d; nearest = c; }
  }
  return { court: nearest, dist: Math.round(minDist) };
}

// ─────────────────────────────────────────────────────────
//  Overpass API query
//  Fetches all leisure=pitch + sport=badminton within
//  Singapore's bounding box. Returns nodes and ways.
// ─────────────────────────────────────────────────────────
async function fetchOSMCourts() {
  // Singapore bounding box: south, west, north, east
  const bbox = "1.1,103.6,1.5,104.1";
  const query = `
    [out:json][timeout:30];
    (
      node[leisure=pitch][sport=badminton](${bbox});
      way[leisure=pitch][sport=badminton](${bbox});
      node[sport=badminton](${bbox});
      way[sport=badminton](${bbox});
    );
    out center tags;
  `;

  console.log("⏳ Querying Overpass API (OpenStreetMap)…\n");

  const response = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `data=${encodeURIComponent(query)}`,
  });

  if (!response.ok) throw new Error(`Overpass API error: ${response.status}`);
  const data = await response.json();
  return data.elements || [];
}

// ─────────────────────────────────────────────────────────
//  Main
// ─────────────────────────────────────────────────────────
async function main() {
  let elements;
  try {
    elements = await fetchOSMCourts();
  } catch (err) {
    console.error("❌ Failed to fetch from Overpass API:", err.message);
    process.exit(1);
  }

  console.log(`📦 OSM returned ${elements.length} badminton pitch elements in Singapore.\n`);

  // Normalise lat/lng — ways have a "center" object, nodes have direct lat/lng
  const rawCourts = elements.map(el => ({
    osmId:   el.id,
    osmType: el.type,
    lat:     el.type === "way" ? el.center.lat : el.lat,
    lng:     el.type === "way" ? el.center.lon : el.lon,
    name:    el.tags?.name || el.tags?.["addr:housename"] || null,
    addr:    el.tags?.["addr:street"]
               ? `${el.tags["addr:housenumber"] || ""} ${el.tags["addr:street"]} Singapore`.trim()
               : null,
    lit:     el.tags?.lit === "yes",
    covered: el.tags?.covered === "yes" || el.tags?.shelter === "yes",
    surface: el.tags?.surface || null,
    access:  el.tags?.access || null,
    indoor:  el.tags?.indoor === "yes" || el.tags?.leisure === "sports_hall",
  }));

  // ── Filter 1: Must be within Singapore's land boundary ──
  const outsideSG = rawCourts.filter(c => !isInSingapore(c.lat, c.lng));
  const inSG      = rawCourts.filter(c =>  isInSingapore(c.lat, c.lng));

  // ── Filter 2: Skip known indoor/commercial/non-SG venues ──
  const knownVenue = inSG.filter(c =>  isKnownVenue(c.name) || c.indoor || c.access === "private");
  const candidates = inSG.filter(c => !isKnownVenue(c.name) && !c.indoor && c.access !== "private");

  // ── Filter 3: Cluster nearby entries into single locations ──
  // OSM maps each individual court outline separately. Group them.
  const clustered = [];
  const assigned  = new Set();

  for (let i = 0; i < candidates.length; i++) {
    if (assigned.has(i)) continue;
    const anchor = candidates[i];
    const group  = [anchor];
    assigned.add(i);

    for (let j = i + 1; j < candidates.length; j++) {
      if (assigned.has(j)) continue;
      if (distanceMetres(anchor.lat, anchor.lng, candidates[j].lat, candidates[j].lng) <= CLUSTER_RADIUS_M) {
        group.push(candidates[j]);
        assigned.add(j);
      }
    }

    // Merge group into one entry — use the named one if available, average coords
    const named   = group.find(c => c.name) || group[0];
    const avgLat  = group.reduce((s, c) => s + c.lat, 0) / group.length;
    const avgLng  = group.reduce((s, c) => s + c.lng, 0) / group.length;
    clustered.push({
      ...named,
      lat:        avgLat,
      lng:        avgLng,
      courtCount: group.length, // number of individual courts OSM mapped here
      lit:        group.some(c => c.lit),
      covered:    group.some(c => c.covered),
      surface:    group.find(c => c.surface)?.surface || null,
    });
  }

  console.log(`   After filtering: ${outsideSG.length} outside SG removed, ${knownVenue.length} known venues removed`);
  console.log(`   After clustering: ${candidates.length} OSM entries → ${clustered.length} distinct locations\n`);

  // Split into duplicates and new candidates
  const courts     = clustered;
  const newCourts  = courts.filter(c => !isDuplicate(c.lat, c.lng));
  const dupCourts  = courts.filter(c =>  isDuplicate(c.lat, c.lng));

  // ── Print duplicates (brief) ──────────────────────────
  console.log(`✅ ${dupCourts.length} OSM entries already in your app (skipped):`);
  dupCourts.forEach(c => {
    const { court, dist } = nearestExisting(c.lat, c.lng);
    console.log(`   • OSM ${c.osmType}/${c.osmId} — ${dist}m from "${court.name}"`);
  });

  // ── Print new candidates (detailed) ──────────────────
  console.log(`\n🆕 ${newCourts.length} NEW courts not in your app:\n`);
  console.log("─".repeat(70));

  if (newCourts.length === 0) {
    console.log("   No new courts found. OSM coverage for Singapore may be limited.");
    console.log("   Consider contributing to OpenStreetMap to improve the dataset.");
  }

  // Filter out likely indoor/private courts and flag them separately
  const outdoorPublic = newCourts;

  outdoorPublic.forEach((c, i) => {
    const { court, dist } = nearestExisting(c.lat, c.lng);
    console.log(`[${i + 1}] OSM ${c.osmType}/${c.osmId}${c.courtCount > 1 ? ` (+${c.courtCount - 1} nearby courts clustered)` : ''}`);
    console.log(`    Name:     ${c.name    || "(no name in OSM)"}`);
    console.log(`    Coords:   ${c.lat.toFixed(6)}, ${c.lng.toFixed(6)}`);
    console.log(`    Address:  ${c.addr    || "(no address in OSM)"}`);
    console.log(`    Lit:      ${c.lit     ? "yes" : "unknown"}`);
    console.log(`    Covered:  ${c.covered ? "yes" : "unknown"}`);
    console.log(`    Surface:  ${c.surface || "unknown"}`);
    console.log(`    OSM court count: ${c.courtCount} (use this as starting point for 'courts' field)`);
    console.log(`    Nearest existing: "${court.name}" (${dist}m away)`);
    console.log(`    OSM link: https://www.openstreetmap.org/${c.osmType}/${c.osmId}`);
    console.log(`    Maps:     https://www.google.com/maps?q=${c.lat},${c.lng}`);
    console.log();
  });

  if (knownVenue.length > 0) {
    console.log("─".repeat(70));
    console.log(`\n⚠️  ${knownVenue.length} entries skipped (indoor, private, commercial, or outside SG):`);
    knownVenue.slice(0, 10).forEach(c => {
      console.log(`   • ${c.name || "Unnamed"} — ${c.lat.toFixed(5)}, ${c.lng.toFixed(5)}`);
    });
    if (knownVenue.length > 10) console.log(`   • ...and ${knownVenue.length - 10} more`);
  }

  // ── Generate ready-to-paste COURTS entries ────────────
  if (outdoorPublic.length > 0) {
    console.log("\n" + "─".repeat(70));
    console.log("\n📋 READY-TO-PASTE entries (add to COURTS array in index.html):");
    console.log("   ⚠️  Review each one — fill in 'name', 'area', 'courts', and 'note' manually.\n");

    const lastId = Math.max(...EXISTING_COURTS.map(c => c.id));
    outdoorPublic.forEach((c, i) => {
      const id   = lastId + i + 1;
      const name = c.name || `Court near ${c.lat.toFixed(4)}, ${c.lng.toFixed(4)}`;
      const addr = c.addr || `${c.lat.toFixed(4)}, ${c.lng.toFixed(4)} Singapore`;
      console.log(`  { id:${id}, name:"${name}", area:"FILL_IN", addr:"${addr}", lat:${c.lat.toFixed(6)}, lng:${c.lng.toFixed(6)}, lights:${c.lit}, covered:${c.covered}, multi:false, courts:${c.courtCount}, note:"Imported from OpenStreetMap. Please verify." },`);
    });
  }

  console.log("\n" + "─".repeat(70));
  console.log("\n📌 Next steps:");
  console.log("   1. Click each Google Maps link above to visually verify the location.");
  console.log("   2. Check the OSM link to see what info is already mapped.");
  console.log("   3. Edit the pasted entries — fix name, area, courts count, note.");
  console.log("   4. Add verified entries to the COURTS array in public/index.html.");
  console.log("   5. Courts you cannot verify → skip for now, let the community report them.\n");
}

main();
