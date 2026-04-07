const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const BASE_DIR = __dirname;
const ROUTES_FILE = path.join(BASE_DIR, "routes", "routes.txt");
const STOPS_FILE = path.join(BASE_DIR, "stops", "stops.txt");
const TRIPS_FILE = path.join(BASE_DIR, "trips", "trips.txt");
const STOP_TIMES_FILE = path.join(BASE_DIR, "stop_times", "stop_times.txt");
const SHAPES_FILE = path.join(BASE_DIR, "shapes", "shapes.txt");
const ADAFRUIT_USERNAME = process.env.ADAFRUIT_USERNAME || "Manu123456789";
const ADAFRUIT_FEED_NAME = process.env.ADAFRUIT_FEED_NAME || "gpslocation";
const keyPart1 = 'aio_';
const keyPart2 = 'DkXb66T2ZW5ihLt0rzcoj5fENnXs'; 
const ADAFRUIT_AIO_KEY = process.env.ADAFRUIT_AIO_KEY || keyPart1 + keyPart2;
const ADAFRUIT_LAST_VALUE_URL = `https://io.adafruit.com/api/v2/${ADAFRUIT_USERNAME}/feeds/${ADAFRUIT_FEED_NAME}/data/last`;
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY || "";

function parseCsvLine(line) {
    const fields = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i += 1) {
        const char = line[i];

        if (char === '"') {
            if (inQuotes && line[i + 1] === '"') {
                current += '"';
                i += 1;
            } else {
                inQuotes = !inQuotes;
            }
            continue;
        }

        if (char === "," && !inQuotes) {
            fields.push(current);
            current = "";
            continue;
        }

        current += char;
    }

    fields.push(current);
    return fields;
}

function loadRoutes() {
    const raw = fs.readFileSync(ROUTES_FILE, "utf8");
    const lines = raw.split(/\r?\n/).filter(Boolean);

    if (lines.length <= 1) {
        return [];
    }

    return lines.slice(1).map((line) => {
        const [routeLongName, routeShortName, agencyId, routeType, routeId] = parseCsvLine(line);
        const [origin = "", destination = ""] = (routeLongName || "").split("⇔").map((part) => part.trim());

        return {
            busNumber: (routeShortName || "").trim() || "N/A",
            routeName: (routeLongName || "").trim() || "Unknown Route",
            origin,
            destination,
            agencyId,
            routeType,
            routeId
        };
    });
}

function loadStops() {
    const raw = fs.readFileSync(STOPS_FILE, "utf8");
    const lines = raw.split(/\r?\n/).filter(Boolean);

    if (lines.length <= 1) {
        return [];
    }

    return lines.slice(1).map((line) => {
        const [stopName, zoneId, stopId, stopDesc, stopLat, stopLon] = parseCsvLine(line);

        return {
            stopName: (stopName || "").trim(),
            zoneId: (zoneId || "").trim(),
            stopId: (stopId || "").trim(),
            stopDesc: (stopDesc || "").trim(),
            stopLat: Number.parseFloat(stopLat),
            stopLon: Number.parseFloat(stopLon)
        };
    });
}

function loadTrips() {
    const raw = fs.readFileSync(TRIPS_FILE, "utf8");
    const lines = raw.split(/\r?\n/).filter(Boolean);

    if (lines.length <= 1) {
        return [];
    }

    return lines.slice(1).map((line) => {
        const [routeId, serviceId, tripHeadsign, directionId, shapeId, tripId] = parseCsvLine(line);

        return {
            routeId: (routeId || "").trim(),
            serviceId: (serviceId || "").trim(),
            tripHeadsign: (tripHeadsign || "").trim(),
            directionId: (directionId || "").trim(),
            shapeId: (shapeId || "").trim(),
            tripId: (tripId || "").trim()
        };
    });
}

function loadStopTimes() {
    const raw = fs.readFileSync(STOP_TIMES_FILE, "utf8");
    const lines = raw.split(/\r?\n/).filter(Boolean);

    if (lines.length <= 1) {
        return [];
    }

    return lines.slice(1).map((line) => {
        const [tripId, arrivalTime, departureTime, stopId, stopSequence, stopHeadsign, pickupType, dropOffType, shapeDistTraveled, timepoint] = parseCsvLine(line);

        return {
            tripId: (tripId || "").trim(),
            arrivalTime: (arrivalTime || "").trim(),
            departureTime: (departureTime || "").trim(),
            stopId: (stopId || "").trim(),
            stopSequence: (stopSequence || "").trim(),
            stopHeadsign: (stopHeadsign || "").trim(),
            pickupType: (pickupType || "").trim(),
            dropOffType: (dropOffType || "").trim(),
            shapeDistTraveled: (shapeDistTraveled || "").trim(),
            timepoint: (timepoint || "").trim()
        };
    });
}

function loadShapes() {
    const raw = fs.readFileSync(SHAPES_FILE, "utf8");
    const lines = raw.split(/\r?\n/).filter(Boolean);

    if (lines.length <= 1) {
        return [];
    }

    return lines.slice(1).map((line) => {
        const [shapeId, shapePtLat, shapePtLon, shapePtSequence] = parseCsvLine(line);

        return {
            shapeId: (shapeId || "").trim(),
            shapePtLat: Number.parseFloat(shapePtLat),
            shapePtLon: Number.parseFloat(shapePtLon),
            shapePtSequence: Number.parseInt(shapePtSequence, 10)
        };
    });
}

function sendJson(res, payload, statusCode = 200) {
    res.writeHead(statusCode, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, X-Requested-With"
    });
    res.end(JSON.stringify(payload));
}

function sendFile(res, filePath, contentType) {
    fs.readFile(filePath, (error, data) => {
        if (error) {
            sendJson(res, { error: "File not found" }, 404);
            return;
        }

        res.writeHead(200, {
            "Content-Type": contentType,
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, X-Requested-With"
        });
        res.end(data);
    });
}

function sendTextFile(res, filePath) {
    sendFile(res, filePath, "text/plain; charset=utf-8");
}

function sendIndexHtml(res) {
    fs.readFile(path.join(BASE_DIR, "index.html"), "utf8", (error, html) => {
        if (error) {
            sendJson(res, { error: "File not found" }, 404);
            return;
        }

        const safeKey = String(GOOGLE_MAPS_API_KEY).replace(/</g, "\\u003c");
        const renderedHtml = html.replace("__GOOGLE_MAPS_API_KEY__", safeKey);

        res.writeHead(200, {
            "Content-Type": "text/html; charset=utf-8",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, X-Requested-With"
        });
        res.end(renderedHtml);
    });
}

function isValidLatitude(value) {
    return Number.isFinite(value) && value >= -90 && value <= 90;
}

function isValidLongitude(value) {
    return Number.isFinite(value) && value >= -180 && value <= 180;
}

function parseLatLngFromObject(candidate) {
    if (!candidate || typeof candidate !== "object") {
        return null;
    }

    const lat = Number.parseFloat(candidate.lat ?? candidate.latitude);
    const lng = Number.parseFloat(candidate.lng ?? candidate.lon ?? candidate.longitude);

    if (!isValidLatitude(lat) || !isValidLongitude(lng)) {
        return null;
    }

    return { lat, lng, sourceFormat: "object" };
}

function parsePreciseGpsPayload(rawPayload) {
    const payloadObject = rawPayload && typeof rawPayload === "object" ? rawPayload : null;

    if (payloadObject) {
        const fromPayloadFields = parseLatLngFromObject(payloadObject);
        if (fromPayloadFields) {
            return { ok: true, ...fromPayloadFields, sourceFormat: "adafruit-payload-fields", rawValue: payloadObject.value };
        }

        const fromLocation = parseLatLngFromObject(payloadObject.location);
        if (fromLocation) {
            return { ok: true, ...fromLocation, sourceFormat: "adafruit-location-object", rawValue: payloadObject.value };
        }
    }

    const rawValue = rawPayload && typeof rawPayload === "object" && "value" in rawPayload
        ? rawPayload.value
        : rawPayload;

    const directObject = parseLatLngFromObject(rawValue);
    if (directObject) {
        return { ok: true, ...directObject, rawValue };
    }

    if (typeof rawValue === "string") {
        const trimmed = rawValue.trim();
        if (!trimmed) {
            return { ok: false, reason: "GPS value is empty.", rawValue };
        }

        const csvParts = trimmed.split(",").map((part) => part.trim());
        if (csvParts.length === 2) {
            const lat = Number.parseFloat(csvParts[0]);
            const lng = Number.parseFloat(csvParts[1]);

            if (isValidLatitude(lat) && isValidLongitude(lng)) {
                return { ok: true, lat, lng, sourceFormat: "csv", rawValue };
            }

            return {
                ok: false,
                reason: `CSV GPS must be valid latitude,longitude. Received: ${trimmed}`,
                rawValue
            };
        }

        if (trimmed.startsWith("{")) {
            try {
                const parsedJson = JSON.parse(trimmed);
                const jsonObject = parseLatLngFromObject(parsedJson);
                if (jsonObject) {
                    return { ok: true, ...jsonObject, sourceFormat: "json-string", rawValue };
                }

                return {
                    ok: false,
                    reason: "JSON GPS value is missing valid lat/lng or latitude/longitude.",
                    rawValue
                };
            } catch (error) {
                return {
                    ok: false,
                    reason: `GPS JSON parse failed: ${error.message}`,
                    rawValue
                };
            }
        }

        if (trimmed.match(/^[-+]?\d*\.?\d+$/)) {
            return {
                ok: false,
                reason: `Single numeric GPS value ${trimmed} is not precise enough. Publish lat,lng or JSON {\"lat\":...,\"lng\":...}.`,
                rawValue
            };
        }

        return {
            ok: false,
            reason: `Unsupported GPS string format: ${trimmed}`,
            rawValue
        };
    }

    return {
        ok: false,
        reason: `Unsupported GPS payload type: ${typeof rawValue}`,
        rawValue
    };
}

async function fetchAndParseAdafruitGps() {
    const response = await fetch(ADAFRUIT_LAST_VALUE_URL, {
        method: "GET",
        headers: {
            "X-AIO-Key": ADAFRUIT_AIO_KEY,
            "Content-Type": "application/json"
        }
    });

    if (!response.ok) {
        throw new Error(`Adafruit request failed with status ${response.status}`);
    }

    const payload = await response.json();
    console.debug("Adafruit raw GPS payload:", payload);

    const parsed = parsePreciseGpsPayload(payload);
    return { payload, parsed };
}

const server = http.createServer(async (req, res) => {
    const requestUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const pathname = requestUrl.pathname;
    const method = (req.method || "GET").toUpperCase();

    if (method === "OPTIONS") {
        res.writeHead(204, {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, X-Requested-With"
        });
        res.end();
        return;
    }

    if (pathname === "/api/routes") {
        try {
            const routes = loadRoutes();
            sendJson(res, { count: routes.length, routes });
        } catch (error) {
            sendJson(res, { error: "Failed to load routes", details: error.message }, 500);
        }
        return;
    }

    if (pathname === "/api/gtfs") {
        try {
            const routes = loadRoutes();
            const stops = loadStops();
            const trips = loadTrips();
            const stopTimes = loadStopTimes();
            const shapes = loadShapes();

            sendJson(res, {
                routes: { count: routes.length, routes },
                stops: { count: stops.length, stops },
                trips: { count: trips.length, trips },
                stopTimes: { count: stopTimes.length, stopTimes },
                shapes: { count: shapes.length, shapes }
            });
        } catch (error) {
            sendJson(res, { error: "Failed to load GTFS bundle", details: error.message }, 500);
        }
        return;
    }

    if (pathname === "/api/stops") {
        try {
            const allStops = loadStops();
            const q = (requestUrl.searchParams.get("q") || "").trim().toLowerCase();
            const limitParam = Number.parseInt(requestUrl.searchParams.get("limit") || "200", 10);
            const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 5000) : 200;

            const filteredStops = q
                ? allStops.filter((stop) => {
                      const name = (stop.stopName || "").toLowerCase();
                      const desc = (stop.stopDesc || "").toLowerCase();
                      const id = (stop.stopId || "").toLowerCase();
                      return name.includes(q) || desc.includes(q) || id.includes(q);
                  })
                : allStops;

            const stops = filteredStops.slice(0, limit);
            sendJson(res, { count: filteredStops.length, returned: stops.length, stops });
        } catch (error) {
            sendJson(res, { error: "Failed to load stops", details: error.message }, 500);
        }
        return;
    }

    if (pathname === "/api/trips") {
        try {
            const trips = loadTrips();
            sendJson(res, { count: trips.length, trips });
        } catch (error) {
            sendJson(res, { error: "Failed to load trips", details: error.message }, 500);
        }
        return;
    }

    if (pathname === "/api/stop_times") {
        try {
            const stopTimes = loadStopTimes();
            sendJson(res, { count: stopTimes.length, stopTimes });
        } catch (error) {
            sendJson(res, { error: "Failed to load stop_times", details: error.message }, 500);
        }
        return;
    }

    if (pathname === "/api/shapes") {
        try {
            const shapes = loadShapes();
            sendJson(res, { count: shapes.length, shapes });
        } catch (error) {
            sendJson(res, { error: "Failed to load shapes", details: error.message }, 500);
        }
        return;
    }

    if (pathname === "/api/live-gps" || pathname === "/api/live-gps/" || pathname === "/live-gps" || pathname === "/live-gps/") {
        try {
            const { payload, parsed } = await fetchAndParseAdafruitGps();

            if (!parsed.ok) {
                sendJson(
                    res,
                    {
                        ok: false,
                        error: "Invalid or incomplete GPS payload from Adafruit.",
                        reason: parsed.reason,
                        expectedFormats: [
                            "12.9716,77.5946",
                            { lat: 12.9716, lng: 77.5946 }
                        ],
                        rawPayload: payload
                    },
                    422
                );
                return;
            }

            sendJson(res, {
                ok: true,
                lat: parsed.lat,
                lng: parsed.lng,
                sourceFormat: parsed.sourceFormat,
                rawPayload: payload
            });
        } catch (error) {
            sendJson(res, { ok: false, error: "Failed to fetch live GPS from Adafruit", details: error.message }, 500);
        }
        return;
    }

    if (pathname === "/gtfs/routes.txt") {
        sendTextFile(res, ROUTES_FILE);
        return;
    }

    if (pathname === "/gtfs/stops.txt") {
        sendTextFile(res, STOPS_FILE);
        return;
    }

    if (pathname === "/gtfs/trips.txt") {
        sendTextFile(res, TRIPS_FILE);
        return;
    }

    if (pathname === "/gtfs/stop_times.txt") {
        sendTextFile(res, STOP_TIMES_FILE);
        return;
    }

    if (pathname === "/gtfs/shapes.txt") {
        sendTextFile(res, SHAPES_FILE);
        return;
    }

    if (pathname === "/" || pathname === "/index.html") {
        sendIndexHtml(res);
        return;
    }

    if (pathname === "/style.css") {
        sendFile(res, path.join(BASE_DIR, "style.css"), "text/css");
        return;
    }

    if (pathname === "/script.js") {
        sendFile(res, path.join(BASE_DIR, "script.js"), "application/javascript");
        return;
    }

    sendJson(res, { error: "Not found" }, 404);
});

server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
