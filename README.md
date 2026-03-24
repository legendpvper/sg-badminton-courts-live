# SG Outdoor Badminton Courts Finder 🏸

A web application that maps all outdoor badminton courts across Singapore's HDB estates, with live geocoding powered by the **OneMap API** (Singapore Land Authority).

---

## Features

- **Interactive map** using official OneMap SLA tile layers
- **Live geocoding** — all 38 court addresses are resolved to precise coordinates via OneMap's free Search API
- **Filter courts** by: Night Lights / Covered / Multi-use
- **Search** by block, street, or estate name
- **My Location** button — shows your current position on the map
- **Detail panel** — full court info, amenity tags, coordinates, Google Maps directions
- **38 outdoor courts** across 20+ estates: Hougang, Tampines, Bedok, Pasir Ris, Jurong, Woodlands, Punggol, Sengkang, AMK, Bishan, Queenstown, and more
- OneMap-verified badge shown on courts successfully geocoded via the API

---

## Setup & Run

### Prerequisites

- [Node.js](https://nodejs.org/) v16 or newer
- npm (included with Node.js)

### 1. Install dependencies

```bash
cd sg-badminton-courts
npm install
```

### 2. Start the server

```bash
npm start
```

### 3. Open in browser

```
http://localhost:3000
```

---

## Project Structure

```
sg-badminton-courts/
├── server.js          # Express backend — OneMap API proxy + static server
├── package.json       # Dependencies
├── public/
│   └── index.html     # Complete frontend app (Leaflet + OneMap tiles)
└── README.md
```

---

## How It Works

### OneMap API Integration

The backend (`server.js`) acts as a proxy to handle two things:

1. **CORS** — OneMap's API doesn't include CORS headers for browser requests, so all API calls go through the local Express server.
2. **Geocoding** — Each court address (e.g. `"306 Hougang Avenue 5 Singapore"`) is sent to the OneMap Search endpoint:

```
GET https://www.onemap.gov.sg/api/common/elastic/search
    ?searchVal=306+Hougang+Avenue+5+Singapore
    &returnGeom=Y
    &getAddrDetails=Y
    &pageNum=1
```

This returns precise `LATITUDE` / `LONGITUDE` coordinates, which replace the fallback coordinates in the app.

### API Endpoints (local proxy)

| Endpoint | Method | Description |
|---|---|---|
| `/api/geocode?address=...` | GET | Geocode a single address via OneMap |
| `/api/geocode-batch` | POST | Batch geocode multiple courts (used on startup) |
| `/api/reverse?lat=...&lng=...` | GET | Reverse geocode coordinates to address |

### Map Tiles

The map uses the official **OneMap SLA tile layer**:
```
https://maps-{a|b|c}.onemap.sg/v3/Default/{z}/{x}/{y}.png
```

This is Singapore's authoritative national map, more accurate than Google Maps for local addresses.

### OneMap API — No Key Required

The **Search endpoint** used for geocoding is **completely free and requires no API key** or registration. It's a public API by the Singapore Land Authority.

Some private OneMap endpoints (routing, reverse geocode) require a free token — you can register at [developers.onemap.sg](https://developers.onemap.sg/register/) if you want to add routing features later.

---

## Adding More Courts

Edit the `COURTS` array in `public/index.html`. Each court entry looks like:

```js
{
  id: 39,
  name: "Blk 999 Some Street",
  area: "Estate Name",
  addr: "999 Some Street Singapore",   // ← OneMap geocodes this
  lat: 1.3521,   // fallback lat (used if geocoding fails)
  lng: 103.8198, // fallback lng
  lights: true,   // night lighting?
  covered: false, // sheltered/covered?
  multi: false,   // shared multi-purpose court?
  courts: 2,      // number of badminton courts
  note: "Description of the court."
}
```

The `addr` field is what gets sent to the OneMap API. Use the full address including "Singapore" at the end for best results.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Node.js + Express |
| Map tiles | OneMap SLA (Singapore Land Authority) |
| Geocoding | OneMap Search API (free, no key) |
| Map library | Leaflet.js 1.9.4 |
| Frontend | Vanilla HTML/CSS/JS |
| Fonts | DM Sans + Space Grotesk |

---

## Future Improvements

- Add court availability booking via OnePA API
- User-submitted courts with moderation
- Nearest courts sorted by GPS distance
- Route planning (walking/MRT) using OneMap routing API
- PWA / offline support
- Mobile app wrapper (Android WebView or React Native)

---

## Credits

- Map data & geocoding: [OneMap](https://www.onemap.gov.sg/) by Singapore Land Authority (SLA)
- Court data: Community-sourced, covering major HDB estates across Singapore
