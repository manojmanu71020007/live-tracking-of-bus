let buses = [];
let gtfsBundle = null;

const busListEl = document.getElementById("buses-list");
const busNumberEl = document.getElementById("bus-number");
const originEl = document.getElementById("origin");
const destinationEl = document.getElementById("destination");
const searchBtnEl = document.getElementById("search-btn");
const showAllBtnEl = document.getElementById("show-all-btn");
const busDetailsEl = document.getElementById("bus-details");
const routeDetailsEl = document.getElementById("route-details");
const selectedBusInfoEl = document.getElementById("selected-bus-info");
const routeStopsListEl = document.getElementById("route-stops-list");
const mapEl = document.getElementById("map");

let selectedBus = null;
let googleMap = null;
let googleMarker = null;
let routePolyline = null;
let routeStopMarkers = [];
let liveTrackingIntervalId = null;
const MAX_VISIBLE_CARDS = 120;
const SPECIAL_SEARCH = {
    origin: "presidency university",
    destination: "rajanukunte",
    searchBusNumbers: new Set(["406"]),
    showAllBusNumbers: new Set(["406"])
};
const TARGET_STOP_NAMES = new Set([
    "Rajanukunte",
    "Sri Banashankari Layout",
    "Ittagalpura Gate",
    "Cable Factory Ittagallapura",
    "Presidency University"
]);
const TARGET_STOP_ORDER = [
    "Presidency University",
    "Rajanukunte"
];
const ADAFRUIT_USERNAME = "Manu123456789";
const ADAFRUIT_AIO_KEY = "aio_vwcp40GASF4gyLISllMv1hgHHrwa";
const ADAFRUIT_FEED_NAME = "gpslocation";
const ADAFRUIT_LAST_VALUE_URL = `https://io.adafruit.com/api/v2/${ADAFRUIT_USERNAME}/feeds/${ADAFRUIT_FEED_NAME}/data/last`;
const LIVE_TRACKING_INTERVAL_MS = 5000;
const LIVE_GPS_ENDPOINT_CANDIDATES = [
    "/api/live-gps",
    "/api/live-gps/",
    "/live-gps",
    "/live-gps/",
    "https://live-tracking-of-bus.onrender.com/api/live-gps",
    "https://live-tracking-of-bus.onrender.com/live-gps"
];
let lastLiveGpsStatusMessage = "";

function normalize(value) {
    return value.trim().toLowerCase();
}

function normalizeStopName(value) {
    const normalized = normalize(value);

    if (normalized === "dibbur cross") {
        return "presidency university";
    }

    if (normalized === "shanubhoganahalli gate (dibbur cross)") {
        return "presidency university";
    }

    return normalized;
}

function isTargetRouteStop(stopName) {
    const normalized = normalizeStopName(stopName);
    return normalized === "presidency university" || normalized === "rajanukunte";
}

function splitRouteName(routeName) {
    const parts = String(routeName || "").split("⇔").map((part) => part.trim()).filter(Boolean);
    if (parts.length >= 2) {
        return { origin: parts[0], destination: parts[1] };
    }

    return { origin: "Unknown Origin", destination: "Unknown Destination" };
}

function groupBy(items, keySelector) {
    return items.reduce((groups, item) => {
        const key = keySelector(item);
        if (!groups.has(key)) {
            groups.set(key, []);
        }
        groups.get(key).push(item);
        return groups;
    }, new Map());
}

function renderBusList(list) {
    if (!list.length) {
        busListEl.innerHTML = "<p>No buses found for this search.</p>";
        return;
    }

    const listToRender = list.slice(0, MAX_VISIBLE_CARDS);
    const hiddenCount = list.length - listToRender.length;

    const summaryHtml = hiddenCount > 0
        ? `<p class="meta"><strong>Showing:</strong> ${listToRender.length} of ${list.length} matching routes. Refine search to narrow down.</p>`
        : `<p class="meta"><strong>Total routes:</strong> ${list.length}</p>`;

    busListEl.innerHTML = summaryHtml + listToRender
        .map((bus) => {
            const statusClass = bus.status === "On Time" ? "on-time" : "delayed";
            const isActive = selectedBus && selectedBus.routeId === bus.routeId ? "active" : "";

            return `
                <article class="bus-card ${isActive}" data-route-id="${bus.routeId}">
                    <h4>${bus.busNumber} - ${bus.routeName}</h4>
                    <p class="meta"><strong>From:</strong> ${bus.origin}</p>
                    <p class="meta"><strong>To:</strong> ${bus.destination}</p>
                    <p class="meta"><strong>ETA:</strong> ${bus.etaMinutes} min</p>
                    <span class="status ${statusClass}">${bus.status}</span>
                </article>
            `;
        })
        .join("");

    const cards = busListEl.querySelectorAll(".bus-card");
    cards.forEach((card) => {
        card.addEventListener("click", () => {
            const bus = buses.find((entry) => entry.routeId === card.dataset.routeId);
            if (bus) {
                selectBus(bus);
            }
        });
    });
}

function renderEmptyState(message) {
    busListEl.innerHTML = `<p class="meta">${message}</p>`;
}

function renderBusDetails(bus) {
    const stopListHtml = bus.stops.length
        ? `<ul>${bus.stops.map((stop) => `<li>${stop}</li>`).join("")}</ul>`
        : "<p>No stop details available for this route.</p>";

    selectedBusInfoEl.innerHTML = `
        <p><strong>Bus Number:</strong> ${bus.busNumber}</p>
        <p><strong>Route ID:</strong> ${bus.routeId}</p>
        <p><strong>Route:</strong> ${bus.routeName}</p>
        <p><strong>Origin:</strong> ${bus.origin}</p>
        <p><strong>Destination:</strong> ${bus.destination}</p>
        <p><strong>Status:</strong> ${bus.status}</p>
        <p><strong>ETA:</strong> ${bus.etaMinutes} minutes</p>
        <p><strong>Trip ID:</strong> ${bus.tripId || "N/A"}</p>
        <p><strong>Shape ID:</strong> ${bus.shapeId || "N/A"}</p>
    `;

    routeStopsListEl.innerHTML = `<p><strong>Stops:</strong></p>${stopListHtml}`;

    busDetailsEl.style.display = "block";
    routeDetailsEl.style.display = "block";
}

function getPseudoLocation(seedValue) {
    const numeric = Number.parseInt(String(seedValue).replace(/\D/g, ""), 10) || 0;
    const latOffset = ((numeric % 60) - 30) * 0.001;
    const lngOffset = ((numeric % 90) - 45) * 0.001;

    return {
        lat: 12.9716 + latOffset,
        lng: 77.5946 + lngOffset
    };
}

async function ensureGtfsBundle() {
    if (gtfsBundle) {
        return gtfsBundle;
    }

    const response = await fetch("/api/gtfs");
    if (!response.ok) {
        throw new Error(`API request failed with status ${response.status}`);
    }

    const payload = await response.json();
    const routes = Array.isArray(payload.routes?.routes) ? payload.routes.routes : [];
    const stops = Array.isArray(payload.stops?.stops) ? payload.stops.stops : [];
    const trips = Array.isArray(payload.trips?.trips) ? payload.trips.trips : [];
    const stopTimes = Array.isArray(payload.stopTimes?.stopTimes) ? payload.stopTimes.stopTimes : [];
    const shapes = Array.isArray(payload.shapes?.shapes) ? payload.shapes.shapes : [];

    gtfsBundle = {
        routes,
        stops,
        trips,
        stopTimes,
        shapes,
        stopsById: new Map(stops.map((stop) => [String(stop.stopId), stop]))
    };

    return gtfsBundle;
}

function buildRouteStopNames(routeId) {
    if (!gtfsBundle) {
        return [];
    }

    const routeTrips = gtfsBundle.trips.filter((trip) => String(trip.routeId) === String(routeId));
    if (!routeTrips.length) {
        return [];
    }

    const tripId = routeTrips[0].tripId;
    const stopTimes = gtfsBundle.stopTimes
        .filter((stopTime) => String(stopTime.tripId) === String(tripId))
        .slice()
        .sort((left, right) => Number(left.stopSequence) - Number(right.stopSequence));

    const orderedStopNames = stopTimes.map((stopTime) => {
        const stop = gtfsBundle.stopsById.get(String(stopTime.stopId));
        return stop ? stop.stopName || stop.stopDesc || stopTime.stopId : stopTime.stopId;
    });

    const startIndex = orderedStopNames.findIndex((stopName) => normalizeStopName(stopName) === "presidency university");
    const endIndex = orderedStopNames.findIndex((stopName) => normalizeStopName(stopName) === "rajanukunte");

    if (startIndex !== -1 && endIndex !== -1) {
        const fromIndex = Math.min(startIndex, endIndex);
        const toIndex = Math.max(startIndex, endIndex);
        return orderedStopNames.slice(fromIndex, toIndex + 1);
    }

    return orderedStopNames.filter((stopName) => isTargetRouteStop(stopName));
}

async function drawBus406Route(map) {
    const bundle = await ensureGtfsBundle();
    const route = bundle.routes.find((entry) => normalize(entry.busNumber) === "406");

    if (!route) {
        throw new Error("Route 406 was not found in the GTFS data");
    }

    const routeTrips = bundle.trips.filter((trip) => String(trip.routeId) === String(route.routeId));
    if (!routeTrips.length) {
        throw new Error("No trips were found for route 406");
    }

    const targetOrder = TARGET_STOP_ORDER.map((name) => normalizeStopName(name));
    let bestTrip = null;
    let bestStops = [];
    let bestShapePoints = [];

    for (const trip of routeTrips) {
        const orderedStopTimes = bundle.stopTimes
            .filter((stopTime) => String(stopTime.tripId) === String(trip.tripId))
            .slice()
            .sort((left, right) => Number(left.stopSequence) - Number(right.stopSequence));

        const matchedStopsByName = new Map();

        orderedStopTimes.forEach((stopTime) => {
            const stop = bundle.stopsById.get(String(stopTime.stopId));
            if (!stop) {
                return;
            }

            const stopNameKey = normalizeStopName(stop.stopName);
            if (!targetOrder.includes(stopNameKey) || matchedStopsByName.has(stopNameKey)) {
                return;
            }

            matchedStopsByName.set(stopNameKey, {
                stopName: stop.stopName,
                stopLat: stop.stopLat,
                stopLon: stop.stopLon,
                stopId: stop.stopId,
                stopSequence: Number(stopTime.stopSequence)
            });
        });

        const orderedStops = TARGET_STOP_ORDER
            .map((name) => matchedStopsByName.get(normalizeStopName(name)))
            .filter(Boolean);

        if (orderedStops.length > bestStops.length) {
            bestTrip = trip;
            bestStops = orderedStops;
        }

        if (orderedStops.length === TARGET_STOP_ORDER.length) {
            bestTrip = trip;
            bestStops = orderedStops;
            break;
        }
    }

    if (!bestTrip) {
        throw new Error("No matching trip was found for route 406");
    }

    bestShapePoints = bundle.shapes
        .filter((shapePoint) => String(shapePoint.shapeId) === String(bestTrip.shapeId))
        .slice()
        .sort((left, right) => Number(left.shapePtSequence) - Number(right.shapePtSequence))
        .map((shapePoint) => ({
            lat: parseFloat(shapePoint.shapePtLat),
            lng: parseFloat(shapePoint.shapePtLon)
        }))
        .filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng));

    const startStop = bestStops[0];
    const endStop = bestStops[bestStops.length - 1];
    const fallbackPath = bestStops.map((stop) => ({
        lat: parseFloat(stop.stopLat),
        lng: parseFloat(stop.stopLon)
    }));

    let routePath = bestShapePoints.length
        ? bestShapePoints
        : fallbackPath;

    if (bestShapePoints.length >= 2 && startStop && endStop) {
        const startPoint = {
            lat: parseFloat(startStop.stopLat),
            lng: parseFloat(startStop.stopLon)
        };
        const endPoint = {
            lat: parseFloat(endStop.stopLat),
            lng: parseFloat(endStop.stopLon)
        };

        const distanceSquared = (point, target) => {
            const latDelta = point.lat - target.lat;
            const lngDelta = point.lng - target.lng;
            return (latDelta * latDelta) + (lngDelta * lngDelta);
        };

        let startIndex = 0;
        let endIndex = bestShapePoints.length - 1;
        let startDistance = Number.POSITIVE_INFINITY;
        let endDistance = Number.POSITIVE_INFINITY;

        bestShapePoints.forEach((point, index) => {
            const pointStartDistance = distanceSquared(point, startPoint);
            if (pointStartDistance < startDistance) {
                startDistance = pointStartDistance;
                startIndex = index;
            }

            const pointEndDistance = distanceSquared(point, endPoint);
            if (pointEndDistance < endDistance) {
                endDistance = pointEndDistance;
                endIndex = index;
            }
        });

        if (startIndex > endIndex) {
            [startIndex, endIndex] = [endIndex, startIndex];
        }

        const clippedShape = bestShapePoints.slice(startIndex, endIndex + 1);
        routePath = clippedShape.length >= 2 ? clippedShape : fallbackPath;
    }

    if (!routePath.length) {
        routePath = bestStops.map((stop) => ({
            lat: parseFloat(stop.stopLat),
            lng: parseFloat(stop.stopLon)
        }));
    }

    if (!routePath.length) {
        throw new Error("No route path points were available for route 406");
    }

    clearMapOverlays();

    routePolyline = new window.google.maps.Polyline({
        path: routePath,
        geodesic: true,
        strokeColor: "#1E90FF",
        strokeOpacity: 1.0,
        strokeWeight: 5,
        map
    });

    const bounds = new window.google.maps.LatLngBounds();
    routePath.forEach((point) => bounds.extend(point));

    bestStops.forEach((stop, index) => {
        const position = {
            lat: parseFloat(stop.stopLat),
            lng: parseFloat(stop.stopLon)
        };

        const marker = new window.google.maps.Marker({
            position,
            map,
            label: String(index + 1),
            title: stop.stopName
        });

        routeStopMarkers.push(marker);
        bounds.extend(position);
    });

    map.fitBounds(bounds);

    return {
        route,
        trip: bestTrip,
        stops: bestStops,
        path: routePath
    };
}

function clearMapOverlays() {
    if (routePolyline) {
        routePolyline.setMap(null);
        routePolyline = null;
    }

    routeStopMarkers.forEach((marker) => marker.setMap(null));
    routeStopMarkers = [];
}

function stopLiveTracking() {
    if (liveTrackingIntervalId) {
        window.clearInterval(liveTrackingIntervalId);
        liveTrackingIntervalId = null;
    }
}

function getLiveGpsStatusEl() {
    let statusEl = document.getElementById("live-gps-status");
    if (statusEl) {
        return statusEl;
    }

    const mapSection = document.querySelector(".map-section");
    if (!mapSection) {
        return null;
    }

    statusEl = document.createElement("p");
    statusEl.id = "live-gps-status";
    statusEl.className = "meta";
    statusEl.style.margin = "8px 0 0";
    statusEl.style.display = "none";
    mapSection.insertBefore(statusEl, mapEl);

    return statusEl;
}

function setLiveGpsStatus(message, level = "info") {
    const statusEl = getLiveGpsStatusEl();
    if (!statusEl) {
        return;
    }

    const normalizedMessage = (message || "").trim();
    if (normalizedMessage === lastLiveGpsStatusMessage) {
        return;
    }

    lastLiveGpsStatusMessage = normalizedMessage;

    if (!normalizedMessage) {
        statusEl.textContent = "";
        statusEl.style.display = "none";
        return;
    }

    statusEl.textContent = normalizedMessage;
    statusEl.style.display = "block";
    statusEl.style.color = level === "error" ? "#b42318" : "#486581";
}

function getLiveGpsEndpointCandidates() {
    const baseOrigin = window.location.origin;
    const resolved = LIVE_GPS_ENDPOINT_CANDIDATES.map((endpoint) => {
        if (endpoint.startsWith("http://") || endpoint.startsWith("https://")) {
            return endpoint;
        }
        return new URL(endpoint, baseOrigin).toString();
    });

    return [...new Set(resolved)];
}

async function fetchLiveGpsFromAdafruit() {
    const endpoints = getLiveGpsEndpointCandidates();
    let lastFailure = null;

    for (const endpoint of endpoints) {
        try {
            const response = await fetch(endpoint, { method: "GET" });

            if (!response.ok) {
                const errorPayload = await response.json().catch(() => null);
                lastFailure = {
                    endpoint,
                    status: response.status,
                    payload: errorPayload
                };

                // Try alternate deployment paths if the endpoint is not found.
                if (response.status === 404) {
                    continue;
                }

                return {
                    ok: false,
                    endpoint,
                    status: response.status,
                    error: errorPayload?.error || "Live GPS endpoint returned an error response.",
                    reason: errorPayload?.reason || null
                };
            }

            const data = await response.json();
            return { ...data, endpoint };
        } catch (error) {
            lastFailure = {
                endpoint,
                status: 0,
                error: error.message
            };
        }
    }

    try {
        // Production-safe fallback when backend live GPS routes are unavailable.
        const adafruitResponse = await fetch(ADAFRUIT_LAST_VALUE_URL, {
            method: "GET",
            headers: {
                "X-AIO-Key": ADAFRUIT_AIO_KEY,
                "Content-Type": "application/json"
            }
        });

        if (adafruitResponse.ok) {
            const adafruitPayload = await adafruitResponse.json();
            const directPayloadCoords = parseLatLngObject(adafruitPayload);
            const locationCoords = parseLatLngObject(adafruitPayload?.location);
            const parsedValue = parseAdafruitGpsValue(adafruitPayload);

            if (directPayloadCoords) {
                return {
                    ok: true,
                    lat: directPayloadCoords.position.lat,
                    lng: directPayloadCoords.position.lng,
                    sourceFormat: "adafruit-direct-payload",
                    endpoint: ADAFRUIT_LAST_VALUE_URL,
                    rawPayload: adafruitPayload
                };
            }

            if (locationCoords) {
                return {
                    ok: true,
                    lat: locationCoords.position.lat,
                    lng: locationCoords.position.lng,
                    sourceFormat: "adafruit-direct-location",
                    endpoint: ADAFRUIT_LAST_VALUE_URL,
                    rawPayload: adafruitPayload
                };
            }

            if (parsedValue.type === "coords") {
                return {
                    ok: true,
                    lat: parsedValue.position.lat,
                    lng: parsedValue.position.lng,
                    sourceFormat: "adafruit-direct-value",
                    endpoint: ADAFRUIT_LAST_VALUE_URL,
                    rawPayload: adafruitPayload
                };
            }

            lastFailure = {
                endpoint: ADAFRUIT_LAST_VALUE_URL,
                status: 422,
                error: parsedValue.reason || "Adafruit direct payload does not contain valid coordinates."
            };
        } else {
            lastFailure = {
                endpoint: ADAFRUIT_LAST_VALUE_URL,
                status: adafruitResponse.status,
                error: "Adafruit direct request failed."
            };
        }
    } catch (error) {
        lastFailure = {
            endpoint: ADAFRUIT_LAST_VALUE_URL,
            status: 0,
            error: error.message
        };
    }

    if (lastFailure) {
        console.warn("Live GPS lookup failed across all endpoint candidates:", lastFailure);
    }

    return {
        ok: false,
        status: lastFailure?.status || 0,
        endpoint: lastFailure?.endpoint || null,
        error: "Live GPS data is currently unavailable.",
        reason: lastFailure?.error || null
    };
}

function isValidLatitude(value) {
    return Number.isFinite(value) && value >= -90 && value <= 90;
}

function isValidLongitude(value) {
    return Number.isFinite(value) && value >= -180 && value <= 180;
}

function normalizeProgressValue(value) {
    if (!Number.isFinite(value)) {
        return null;
    }

    if (value >= 0 && value <= 1) {
        return value;
    }

    if (value >= 0 && value <= 100) {
        return value / 100;
    }

    return null;
}

function parseLatLngObject(candidate) {
    if (!candidate || typeof candidate !== "object") {
        return null;
    }

    const latRaw = candidate.lat ?? candidate.latitude;
    const lngRaw = candidate.lng ?? candidate.lon ?? candidate.longitude;
    const lat = Number.parseFloat(latRaw);
    const lng = Number.parseFloat(lngRaw);

    if (!isValidLatitude(lat) || !isValidLongitude(lng)) {
        return null;
    }

    return { type: "coords", position: { lat, lng } };
}

function parseAdafruitGpsValue(payload) {
    const rawValue = payload && typeof payload === "object" && "value" in payload
        ? payload.value
        : payload;

    const fromObject = parseLatLngObject(rawValue);
    if (fromObject) {
        return fromObject;
    }

    if (typeof rawValue === "number") {
        const progress = normalizeProgressValue(rawValue);
        if (progress !== null) {
            return { type: "progress", progress };
        }
        return {
            type: "invalid",
            reason: `Numeric GPS value ${rawValue} is out of supported progress range (0-1 or 0-100).`
        };
    }

    if (typeof rawValue === "string") {
        const trimmed = rawValue.trim();
        if (!trimmed) {
            return { type: "invalid", reason: "GPS value is an empty string." };
        }

        const stringAsNumber = Number.parseFloat(trimmed);
        if (trimmed.match(/^[-+]?\d*\.?\d+$/) && Number.isFinite(stringAsNumber)) {
            const progress = normalizeProgressValue(stringAsNumber);
            if (progress !== null) {
                return { type: "progress", progress };
            }
            return {
                type: "invalid",
                reason: `Numeric GPS value ${trimmed} is out of supported progress range (0-1 or 0-100).`
            };
        }

        const fromCsv = trimmed.split(",").map((part) => part.trim());
        if (fromCsv.length === 2) {
            const lat = Number.parseFloat(fromCsv[0]);
            const lng = Number.parseFloat(fromCsv[1]);

            if (isValidLatitude(lat) && isValidLongitude(lng)) {
                return { type: "coords", position: { lat, lng } };
            }

            return {
                type: "invalid",
                reason: `CSV GPS value must be valid latitude,longitude but received: ${trimmed}`
            };
        }

        if (trimmed.startsWith("{")) {
            try {
                const parsedJson = JSON.parse(trimmed);
                const fromJsonObject = parseLatLngObject(parsedJson);
                if (fromJsonObject) {
                    return fromJsonObject;
                }
                return {
                    type: "invalid",
                    reason: "JSON GPS value is missing valid lat/lng or latitude/longitude fields."
                };
            } catch (error) {
                return {
                    type: "invalid",
                    reason: `GPS JSON parse failed: ${error.message}`
                };
            }
        }

        return {
            type: "invalid",
            reason: `Unsupported GPS string format: ${trimmed}`
        };
    }

    return {
        type: "invalid",
        reason: `Unsupported GPS payload type: ${typeof rawValue}`
    };
}

function getPositionFromRouteProgress(progress) {
    if (!routePolyline || typeof routePolyline.getPath !== "function") {
        return null;
    }

    const path = routePolyline.getPath();
    if (!path || typeof path.getLength !== "function" || path.getLength() === 0) {
        return null;
    }

    const lastIndex = path.getLength() - 1;
    const index = Math.max(0, Math.min(lastIndex, Math.round(progress * lastIndex)));
    const point = path.getAt(index);

    if (!point || typeof point.lat !== "function" || typeof point.lng !== "function") {
        return null;
    }

    return {
        lat: point.lat(),
        lng: point.lng()
    };
}

async function updateLiveBus406Marker(bus) {
    if (!window.google || !window.google.maps || !googleMap) {
        return;
    }

    const data = await fetchLiveGpsFromAdafruit();
    console.debug("Adafruit raw payload before GPS parsing:", data);

    if (!data || !data.ok) {
        const statusText = data && data.status ? ` (status ${data.status})` : "";
        setLiveGpsStatus(`Live GPS unavailable${statusText}. Showing route preview only.`, "error");
        return;
    }

    if (!data.ok || !Number.isFinite(data.lat) || !Number.isFinite(data.lng)) {
        console.warn("Parsed GPS payload is missing precise lat/lng coordinates:", data);
        const reasonText = data.reason ? ` ${data.reason}` : "";
        setLiveGpsStatus(`Live GPS data is invalid.${reasonText}`, "error");
        return;
    }

    const position = { lat: data.lat, lng: data.lng };
    console.debug("Parsed coordinates for map marker:", position);
    setLiveGpsStatus("Live GPS connected.");

    const busIconUrl = "https://maps.google.com/mapfiles/kml/shapes/bus.png";

    if (!googleMarker) {
        googleMarker = new window.google.maps.Marker({
            position,
            map: googleMap,
            title: "Bus 406",
            icon: busIconUrl,
            zIndex: 9999
        });
    } else {
        const marker = googleMarker;
        marker.setPosition(position);
        marker.setTitle("Bus 406");
        marker.setIcon(busIconUrl);
        marker.setZIndex(9999);
    }

    googleMap.panTo(position);
}

function startLiveTrackingForBus406(bus) {
    stopLiveTracking();
    setLiveGpsStatus("Connecting to live GPS...");

    const runUpdate = async () => {
        try {
            await updateLiveBus406Marker(bus);
        } catch (error) {
            console.error("Live GPS tracking failed for Bus 406", error);
        }
    };

    void runUpdate();
    liveTrackingIntervalId = window.setInterval(() => {
        void runUpdate();
    }, LIVE_TRACKING_INTERVAL_MS);
}

async function drawRoutePathForBus(bus) {
    if (normalize(bus.busNumber) !== "406" || !window.google || !window.google.maps || !googleMap) {
        return false;
    }

    await drawBus406Route(googleMap);
    return true;
}

function toBusModel(route, index) {
    const routeId = String(route.routeId || `route-${index + 1}`);
    const busNumber = (route.busNumber || "N/A").trim();
    const origin = (route.origin || "Unknown Origin").trim();
    const destination = (route.destination || "Unknown Destination").trim();
    const routeStops = buildRouteStopNames(routeId);
    const routeTrips = gtfsBundle ? gtfsBundle.trips.filter((trip) => String(trip.routeId) === routeId) : [];
    const primaryTrip = routeTrips[0] || null;

    return {
        routeId,
        busNumber,
        routeName: route.routeName || `${origin} ⇔ ${destination}`,
        origin,
        destination,
        etaMinutes: 3 + (index % 18),
        status: index % 5 === 0 ? "Delayed" : "On Time",
        location: getPseudoLocation(routeId),
        tripId: primaryTrip ? primaryTrip.tripId : "",
        shapeId: primaryTrip ? primaryTrip.shapeId : "",
        stops: routeStops.length ? routeStops : [origin, "Midway Stop", destination]
    };
}

async function loadBusesFromBackend() {
    const response = await fetch("/api/gtfs");
    if (!response.ok) {
        throw new Error(`API request failed with status ${response.status}`);
    }

    const payload = await response.json();
    const routes = Array.isArray(payload.routes?.routes) ? payload.routes.routes : [];
    const stops = Array.isArray(payload.stops?.stops) ? payload.stops.stops : [];
    const trips = Array.isArray(payload.trips?.trips) ? payload.trips.trips : [];
    const stopTimes = Array.isArray(payload.stopTimes?.stopTimes) ? payload.stopTimes.stopTimes : [];
    const shapes = Array.isArray(payload.shapes?.shapes) ? payload.shapes.shapes : [];

    gtfsBundle = {
        routes,
        stops,
        trips,
        stopTimes,
        shapes,
        stopsById: new Map(stops.map((stop) => [String(stop.stopId), stop]))
    };

    buses = routes.map((route, index) => toBusModel(route, index));
}

function matchesSpecialSearch() {
    const originQuery = normalize(originEl.value);
    const destinationQuery = normalize(destinationEl.value);

    return originQuery.includes(SPECIAL_SEARCH.origin) && destinationQuery.includes(SPECIAL_SEARCH.destination);
}

function filterForSpecialSearch() {
    return buses.filter((bus) => SPECIAL_SEARCH.searchBusNumbers.has(normalize(bus.busNumber)));
}

function filterForSpecialShowAll() {
    return buses.filter((bus) => SPECIAL_SEARCH.showAllBusNumbers.has(normalize(bus.busNumber)));
}

async function renderMap(bus) {
    if (window.google && window.google.maps && googleMap) {
        stopLiveTracking();

        const drewPath = await drawRoutePathForBus(bus);
        if (!drewPath) {
            googleMap.setCenter(bus.location);
            googleMap.setZoom(13);
        }

        if (normalize(bus.busNumber) === "406") {
            startLiveTrackingForBus406(bus);
        } else {
            if (!googleMarker) {
                googleMarker = new window.google.maps.Marker({
                    position: bus.location,
                    map: googleMap,
                    title: `Bus ${bus.busNumber}`
                });
            } else {
                googleMarker.setPosition(bus.location);
                googleMarker.setTitle(`Bus ${bus.busNumber}`);
            }
        }
        return;
    }

    const bundle = await ensureGtfsBundle();
    const route = bundle.routes.find((entry) => normalize(entry.busNumber) === "406");
    const routeTrips = route ? bundle.trips.filter((trip) => String(trip.routeId) === String(route.routeId)) : [];
    const fallbackStops = routeTrips.length
        ? TARGET_STOP_ORDER.map((name, index) => `<li>${index + 1}. ${name}</li>`).join("")
        : "<li>No mappable stop coordinates found for this route.</li>";

    mapEl.innerHTML = `
        <div class="map-fallback">
            <div>
                <p>${bus.busNumber} is near:</p>
                <p><strong>${bus.origin} → ${bus.destination}</strong></p>
                <p>Approximate location: ${bus.location.lat.toFixed(4)}, ${bus.location.lng.toFixed(4)}</p>
                <p><strong>Route Stops:</strong></p>
                <ol>${fallbackStops}</ol>
            </div>
        </div>
    `;
}

function selectBus(bus) {
    selectedBus = bus;
    renderBusDetails(bus);
    renderBusList(filterBuses());
    void renderMap(bus);

    if (normalize(bus.busNumber) !== "406") {
        setLiveGpsStatus("");
    }
}

function filterBuses() {
    const busNumberQuery = normalize(busNumberEl.value);
    const originQuery = normalize(originEl.value);
    const destinationQuery = normalize(destinationEl.value);

    if (matchesSpecialSearch()) {
        let specialResults = filterForSpecialSearch();

        if (busNumberQuery) {
            specialResults = specialResults.filter((bus) => normalize(bus.busNumber).includes(busNumberQuery));
        }

        return specialResults;
    }

    return buses.filter((bus) => {
        const busMatch = !busNumberQuery || normalize(bus.busNumber).includes(busNumberQuery);
        const originMatch = !originQuery || normalize(bus.origin).includes(originQuery);
        const destinationMatch = !destinationQuery || normalize(bus.destination).includes(destinationQuery);

        return busMatch && originMatch && destinationMatch;
    });
}

function runSearch() {
    const filtered = filterBuses();
    renderBusList(filtered);

    if (filtered.length === 1) {
        void selectBus(filtered[0]);
    } else if (matchesSpecialSearch() && filtered.length > 0) {
        const preferredOrder = ["406"];
        const selected = preferredOrder
            .map((busNumber) => filtered.find((bus) => normalize(bus.busNumber) === busNumber))
            .find(Boolean) || filtered[0];

        void selectBus(selected);
    }
}

function resetFiltersAndShowAll() {
    busNumberEl.value = "";
    originEl.value = "";
    destinationEl.value = "";
    selectedBus = null;
    busDetailsEl.style.display = "none";
    routeDetailsEl.style.display = "none";

    if (!window.google || !window.google.maps) {
        mapEl.innerHTML = "";
    }

    renderBusList(filterForSpecialShowAll());
}

function setupEvents() {
    searchBtnEl.addEventListener("click", runSearch);
    showAllBtnEl.addEventListener("click", resetFiltersAndShowAll);

    [busNumberEl, originEl, destinationEl].forEach((input) => {
        input.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
                runSearch();
            }
        });
    });
}

function initGoogleMap() {
    googleMap = new window.google.maps.Map(mapEl, {
        center: { lat: 12.9716, lng: 77.5946 },
        zoom: 12,
        mapTypeControl: false,
        streetViewControl: false
    });
}

function initMapCallback() {
    if (window.google && window.google.maps) {
        initGoogleMap();
    } else {
        mapEl.innerHTML = `
            <div class="map-fallback">
                <p>Map API key is not configured. Bus locations are shown as text when you pick a bus.</p>
            </div>
        `;
    }
}

async function initApp() {
    setupEvents();

    try {
        await loadBusesFromBackend();
    } catch (error) {
        console.error("Failed to fetch routes from backend", error);
        busListEl.innerHTML = "<p>Could not load routes from backend. Start the server and refresh.</p>";
        return;
    }

    renderEmptyState("Use the search fields, then press Show All Buses to view the filtered Dibbur Cross to Rajanukunte service set.");
}

initApp();
