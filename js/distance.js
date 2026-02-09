/* ============================================
   Gardners Ground Maintenance — Distance Utility
   Haversine formula + postcodes.io API
   Base: PL26 8HN (Roche, Cornwall)
   ============================================ */

const DistanceUtil = (() => {

    // ── Base location: PL26 8HN (Roche, Cornwall) ──
    const BASE = { lat: 50.398264, lng: -4.829102, postcode: 'PL26 8HN' };

    // ── Cornwall driving speed estimates (mph) ──
    const SPEED_PROFILES = {
        rural: 22,      // Narrow lanes, single track
        moderate: 28,    // B-roads, village roads
        aRoad: 35        // A30, A38, A39 etc
    };
    const WINDING_FACTOR = 1.35; // Cornwall roads are rarely straight

    // ── Haversine distance (miles) ──
    function haversine(lat1, lng1, lat2, lng2) {
        const R = 3958.8; // Earth radius in miles
        const dLat = toRad(lat2 - lat1);
        const dLng = toRad(lng2 - lng1);
        const a = Math.sin(dLat / 2) ** 2 +
                  Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
                  Math.sin(dLng / 2) ** 2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    function toRad(deg) { return deg * (Math.PI / 180); }

    // ── Estimate driving distance & time ──
    function estimateDrive(straightMiles) {
        const drivingMiles = straightMiles * WINDING_FACTOR;
        // Use blended speed: short distances = slower rural, longer = faster main roads
        let avgSpeed;
        if (drivingMiles < 5) {
            avgSpeed = SPEED_PROFILES.rural;
        } else if (drivingMiles < 15) {
            avgSpeed = SPEED_PROFILES.moderate;
        } else {
            avgSpeed = SPEED_PROFILES.aRoad;
        }
        const driveMinutes = (drivingMiles / avgSpeed) * 60;
        return {
            straightMiles: Math.round(straightMiles * 10) / 10,
            drivingMiles: Math.round(drivingMiles * 10) / 10,
            driveMinutes: Math.round(driveMinutes),
            avgSpeed
        };
    }

    // ── Lookup postcode via postcodes.io ──
    async function lookupPostcode(postcode) {
        const clean = postcode.replace(/\s+/g, '').toUpperCase();
        try {
            const resp = await fetch(`https://api.postcodes.io/postcodes/${clean}`);
            const data = await resp.json();
            if (data.status === 200 && data.result) {
                return {
                    lat: data.result.latitude,
                    lng: data.result.longitude,
                    postcode: data.result.postcode,
                    parish: data.result.parish || '',
                    district: data.result.admin_district || '',
                    region: data.result.region || ''
                };
            }
            return null;
        } catch (e) {
            console.error('Postcode lookup failed:', e);
            return null;
        }
    }

    // ── Bulk lookup (up to 100 postcodes) ──
    async function bulkLookup(postcodes) {
        const cleaned = postcodes.map(p => p.replace(/\s+/g, '').toUpperCase());
        try {
            const resp = await fetch('https://api.postcodes.io/postcodes', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ postcodes: cleaned })
            });
            const data = await resp.json();
            if (data.status === 200 && data.result) {
                return data.result.map(r => {
                    if (r.result) {
                        return {
                            lat: r.result.latitude,
                            lng: r.result.longitude,
                            postcode: r.result.postcode,
                            parish: r.result.parish || '',
                            district: r.result.admin_district || ''
                        };
                    }
                    return null;
                });
            }
            return [];
        } catch (e) {
            console.error('Bulk postcode lookup failed:', e);
            return [];
        }
    }

    // ── Get distance from base to a postcode ──
    async function distanceFromBase(postcode) {
        const loc = await lookupPostcode(postcode);
        if (!loc) return null;
        const straight = haversine(BASE.lat, BASE.lng, loc.lat, loc.lng);
        const drive = estimateDrive(straight);
        return {
            ...drive,
            destination: loc,
            googleMapsUrl: `https://www.google.com/maps/dir/${BASE.lat},${BASE.lng}/${loc.lat},${loc.lng}`
        };
    }

    // ── Distance between two postcodes ──
    async function distanceBetween(postcodeA, postcodeB) {
        const [locA, locB] = await Promise.all([
            lookupPostcode(postcodeA),
            lookupPostcode(postcodeB)
        ]);
        if (!locA || !locB) return null;
        const straight = haversine(locA.lat, locA.lng, locB.lat, locB.lng);
        const drive = estimateDrive(straight);
        return {
            ...drive,
            from: locA,
            to: locB,
            googleMapsUrl: `https://www.google.com/maps/dir/${locA.lat},${locA.lng}/${locB.lat},${locB.lng}`
        };
    }

    // ── Build optimised multi-stop Google Maps URL ──
    function buildRouteUrl(postcodes) {
        if (!postcodes || postcodes.length === 0) return null;
        const origin = `${BASE.lat},${BASE.lng}`;
        const waypoints = postcodes.slice(0, -1).map(p => encodeURIComponent(p)).join('/');
        const destination = encodeURIComponent(postcodes[postcodes.length - 1]);
        if (postcodes.length === 1) {
            return `https://www.google.com/maps/dir/${origin}/${destination}`;
        }
        return `https://www.google.com/maps/dir/${origin}/${waypoints}/${destination}`;
    }

    // ── Format drive time for display ──
    function formatDriveTime(minutes) {
        if (minutes < 60) return `${minutes} min`;
        const hrs = Math.floor(minutes / 60);
        const mins = minutes % 60;
        return mins > 0 ? `${hrs}h ${mins}m` : `${hrs}h`;
    }

    // ── Public API ──
    return {
        BASE,
        lookupPostcode,
        bulkLookup,
        haversine,
        estimateDrive,
        distanceFromBase,
        distanceBetween,
        buildRouteUrl,
        formatDriveTime
    };

})();
