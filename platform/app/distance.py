"""
Distance & Route Planner for GGM Hub.
Ported from js/distance.js — Haversine + postcodes.io + Cornwall winding factor.
Provides geocoding, travel time estimation, and day route planning.
"""

import math
import logging
import requests
from typing import Optional
from functools import lru_cache

from . import config

log = logging.getLogger("ggm.distance")

# ──────────────────────────────────────────────────────────────────
# Haversine formula
# ──────────────────────────────────────────────────────────────────
EARTH_RADIUS_MILES = 3958.8


def haversine(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Straight-line distance in miles between two lat/lng points."""
    d_lat = math.radians(lat2 - lat1)
    d_lng = math.radians(lng2 - lng1)
    a = (math.sin(d_lat / 2) ** 2 +
         math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) *
         math.sin(d_lng / 2) ** 2)
    return EARTH_RADIUS_MILES * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


# ──────────────────────────────────────────────────────────────────
# Driving estimate
# ──────────────────────────────────────────────────────────────────

def estimate_drive(straight_miles: float) -> dict:
    """Estimate driving distance and time from straight-line miles.
    Returns dict with straightMiles, drivingMiles, driveMinutes, avgSpeed.
    """
    driving_miles = straight_miles * config.WINDING_FACTOR

    # Speed profile: short = rural, mid = moderate, long = A-road
    if driving_miles < 5:
        avg_speed = config.SPEED_RURAL
    elif driving_miles < 15:
        avg_speed = config.SPEED_MODERATE
    else:
        avg_speed = config.SPEED_A_ROAD

    drive_minutes = (driving_miles / avg_speed) * 60 if avg_speed > 0 else 0

    return {
        "straight_miles": round(straight_miles, 1),
        "driving_miles": round(driving_miles, 1),
        "drive_minutes": round(drive_minutes),
        "avg_speed": avg_speed,
    }


# ──────────────────────────────────────────────────────────────────
# Postcodes.io API (free, no key needed)
# ──────────────────────────────────────────────────────────────────

_postcode_cache: dict[str, Optional[dict]] = {}


def _clean_postcode(pc: str) -> str:
    """Normalise a postcode for API lookup."""
    return pc.strip().upper().replace(" ", "")


def lookup_postcode(postcode: str) -> Optional[dict]:
    """Geocode a single UK postcode. Returns {lat, lng, postcode, parish, district}."""
    clean = _clean_postcode(postcode)
    if not clean:
        return None

    if clean in _postcode_cache:
        return _postcode_cache[clean]

    try:
        resp = requests.get(
            f"https://api.postcodes.io/postcodes/{clean}",
            timeout=5,
        )
        data = resp.json()
        if data.get("status") == 200 and data.get("result"):
            r = data["result"]
            result = {
                "lat": r["latitude"],
                "lng": r["longitude"],
                "postcode": r["postcode"],
                "parish": r.get("parish", ""),
                "district": r.get("admin_district", ""),
            }
            _postcode_cache[clean] = result
            return result
    except Exception as e:
        log.warning(f"Postcode lookup failed for {postcode}: {e}")

    _postcode_cache[clean] = None
    return None


def bulk_lookup(postcodes: list[str]) -> list[Optional[dict]]:
    """Bulk geocode up to 100 postcodes in one call."""
    cleaned = [_clean_postcode(pc) for pc in postcodes if pc.strip()]
    if not cleaned:
        return []

    # Split into un-cached and cached
    results = [None] * len(cleaned)
    to_lookup = []
    to_lookup_idx = []

    for i, pc in enumerate(cleaned):
        if pc in _postcode_cache:
            results[i] = _postcode_cache[pc]
        else:
            to_lookup.append(pc)
            to_lookup_idx.append(i)

    if to_lookup:
        try:
            resp = requests.post(
                "https://api.postcodes.io/postcodes",
                json={"postcodes": to_lookup},
                timeout=10,
            )
            data = resp.json()
            if data.get("status") == 200 and data.get("result"):
                for j, entry in enumerate(data["result"]):
                    idx = to_lookup_idx[j]
                    if entry.get("result"):
                        r = entry["result"]
                        result = {
                            "lat": r["latitude"],
                            "lng": r["longitude"],
                            "postcode": r["postcode"],
                            "parish": r.get("parish", ""),
                            "district": r.get("admin_district", ""),
                        }
                        results[idx] = result
                        _postcode_cache[to_lookup[j]] = result
                    else:
                        _postcode_cache[to_lookup[j]] = None
        except Exception as e:
            log.warning(f"Bulk postcode lookup failed: {e}")

    return results


# ──────────────────────────────────────────────────────────────────
# Distance helpers
# ──────────────────────────────────────────────────────────────────

def distance_from_base(postcode: str) -> Optional[dict]:
    """Distance and drive time from home base (PL26 8HN) to a postcode."""
    loc = lookup_postcode(postcode)
    if not loc:
        return None
    straight = haversine(config.BASE_LAT, config.BASE_LNG, loc["lat"], loc["lng"])
    drive = estimate_drive(straight)
    drive["destination"] = loc
    return drive


def distance_between(pc_a: str, pc_b: str) -> Optional[dict]:
    """Distance and drive time between two postcodes."""
    results = bulk_lookup([pc_a, pc_b])
    loc_a, loc_b = results[0], results[1] if len(results) > 1 else None
    if not loc_a or not loc_b:
        return None
    straight = haversine(loc_a["lat"], loc_a["lng"], loc_b["lat"], loc_b["lng"])
    drive = estimate_drive(straight)
    drive["from"] = loc_a
    drive["to"] = loc_b
    return drive


def format_drive_time(minutes: int) -> str:
    """Human-readable drive time."""
    if minutes < 60:
        return f"{minutes} min"
    hrs = minutes // 60
    mins = minutes % 60
    return f"{hrs}h {mins}m" if mins else f"{hrs}h"


def build_route_url(postcodes: list[str]) -> str:
    """Build a multi-stop Google Maps directions URL starting from base."""
    origin = f"{config.BASE_LAT},{config.BASE_LNG}"
    if not postcodes:
        return f"https://www.google.com/maps/@{origin},12z"

    stops = [pc.replace(" ", "+") for pc in postcodes]
    if len(stops) == 1:
        return f"https://www.google.com/maps/dir/{origin}/{stops[0]}"

    waypoints = "/".join(stops[:-1])
    destination = stops[-1]
    return f"https://www.google.com/maps/dir/{origin}/{waypoints}/{destination}"


# ──────────────────────────────────────────────────────────────────
# Day Route Planner
# ──────────────────────────────────────────────────────────────────

def plan_day_route(jobs: list[dict]) -> dict:
    """
    Plan an optimised route for a list of jobs.

    Each job dict needs at minimum: name, postcode, service (for duration lookup).
    Optional: time (fixed appointment), id.

    Returns:
        {
            "route": [ordered list of job dicts with added travel info],
            "total_drive_minutes": int,
            "total_drive_miles": float,
            "total_work_hours": float,
            "total_day_hours": float,  (work + travel)
            "start_time": "HH:MM",
            "end_time": "HH:MM",
            "route_url": str,
            "warnings": [str],
        }
    """
    if not jobs:
        return _empty_plan()

    warnings = []

    # ── Geocode all postcodes in one batch ──
    postcodes = [j.get("postcode", "") for j in jobs]
    geo_results = bulk_lookup(postcodes)

    # Attach geo data to each job and calculate duration
    enriched = []
    ungeocodable = []
    for i, job in enumerate(jobs):
        j = dict(job)  # copy
        geo = geo_results[i] if i < len(geo_results) else None
        j["_geo"] = geo
        service = j.get("service", "")
        j["_duration_hrs"] = config.SERVICE_DURATIONS.get(service, 2.0)

        if not geo:
            ungeocodable.append(j.get("name", f"Job {i+1}"))

        enriched.append(j)

    if ungeocodable:
        warnings.append(f"Could not geocode: {', '.join(ungeocodable)}")

    # ── Separate fixed-time vs flexible jobs ──
    fixed = []
    flexible = []
    for j in enriched:
        t = j.get("time", "").strip()
        if t and ":" in t:
            try:
                h, m = t.split(":")[:2]
                j["_fixed_minutes"] = int(h) * 60 + int(m)
                fixed.append(j)
            except ValueError:
                flexible.append(j)
        else:
            flexible.append(j)

    fixed.sort(key=lambda j: j["_fixed_minutes"])

    # ── Nearest-neighbour route optimisation for flexible jobs ──
    # Start from base, greedily pick the nearest unvisited geocoded job
    flexible_geo = [j for j in flexible if j["_geo"]]
    flexible_nogeo = [j for j in flexible if not j["_geo"]]

    ordered_flexible = []
    if flexible_geo:
        remaining = list(flexible_geo)
        cur_lat, cur_lng = config.BASE_LAT, config.BASE_LNG

        while remaining:
            best_idx = 0
            best_dist = float("inf")
            for idx, j in enumerate(remaining):
                d = haversine(cur_lat, cur_lng, j["_geo"]["lat"], j["_geo"]["lng"])
                if d < best_dist:
                    best_dist = d
                    best_idx = idx

            chosen = remaining.pop(best_idx)
            cur_lat = chosen["_geo"]["lat"]
            cur_lng = chosen["_geo"]["lng"]
            ordered_flexible.append(chosen)

    # Add non-geocodable at the end
    ordered_flexible.extend(flexible_nogeo)

    # ── Merge fixed and flexible into a timeline ──
    route = _merge_fixed_and_flexible(fixed, ordered_flexible, warnings)

    # ── Calculate travel segments ──
    total_drive_min = 0
    total_drive_miles = 0.0
    total_work_hrs = 0.0
    route_postcodes = []

    prev_lat, prev_lng = config.BASE_LAT, config.BASE_LNG

    for j in route:
        # Travel to this job
        if j.get("_geo"):
            straight = haversine(prev_lat, prev_lng, j["_geo"]["lat"], j["_geo"]["lng"])
            drive = estimate_drive(straight)
            j["travel_minutes"] = drive["drive_minutes"]
            j["travel_miles"] = drive["driving_miles"]
            total_drive_min += drive["drive_minutes"]
            total_drive_miles += drive["driving_miles"]
            prev_lat = j["_geo"]["lat"]
            prev_lng = j["_geo"]["lng"]
            route_postcodes.append(j.get("postcode", ""))
        else:
            j["travel_minutes"] = 0
            j["travel_miles"] = 0

        j["duration_hours"] = j["_duration_hrs"]
        total_work_hrs += j["_duration_hrs"]

    # Travel home from last job
    if route and route[-1].get("_geo"):
        home = haversine(
            route[-1]["_geo"]["lat"], route[-1]["_geo"]["lng"],
            config.BASE_LAT, config.BASE_LNG,
        )
        home_drive = estimate_drive(home)
        total_drive_min += home_drive["drive_minutes"]
        total_drive_miles += home_drive["driving_miles"]

    # ── Assign times ──
    cursor_min = config.WORK_START_HOUR * 60  # e.g. 480 = 08:00
    for j in route:
        cursor_min += j["travel_minutes"]
        j["planned_start"] = _min_to_hhmm(cursor_min)
        end_min = cursor_min + int(j["_duration_hrs"] * 60)
        j["planned_end"] = _min_to_hhmm(end_min)
        cursor_min = end_min

    end_time_min = cursor_min + (total_drive_min - sum(j["travel_minutes"] for j in route))  # add return home
    if route:
        last_end = cursor_min
        # add home travel
        if route[-1].get("_geo"):
            last_end += home_drive["drive_minutes"]
        end_time_str = _min_to_hhmm(last_end)
    else:
        end_time_str = _min_to_hhmm(config.WORK_START_HOUR * 60)
        last_end = config.WORK_START_HOUR * 60

    total_day_hrs = (last_end - config.WORK_START_HOUR * 60) / 60.0

    if last_end > config.WORK_END_HOUR * 60:
        over_min = last_end - config.WORK_END_HOUR * 60
        warnings.append(f"Day overruns by {format_drive_time(over_min)} past {config.WORK_END_HOUR}:00")

    if len(route) > config.MAX_JOBS_PER_DAY:
        warnings.append(f"More than {config.MAX_JOBS_PER_DAY} jobs scheduled")

    # ── Clean up internal keys before returning ──
    clean_route = []
    for j in route:
        clean = {
            "name": j.get("name", j.get("client_name", "")),
            "service": j.get("service", ""),
            "postcode": j.get("postcode", ""),
            "address": j.get("address", ""),
            "phone": j.get("phone", ""),
            "id": j.get("id", ""),
            "planned_start": j.get("planned_start", ""),
            "planned_end": j.get("planned_end", ""),
            "duration_hours": j.get("duration_hours", 0),
            "travel_minutes": j.get("travel_minutes", 0),
            "travel_miles": j.get("travel_miles", 0),
            "parish": j.get("_geo", {}).get("parish", "") if j.get("_geo") else "",
            "price": j.get("price", 0),
            "status": j.get("status", ""),
        }
        clean_route.append(clean)

    return {
        "route": clean_route,
        "total_drive_minutes": total_drive_min,
        "total_drive_miles": round(total_drive_miles, 1),
        "total_work_hours": round(total_work_hrs, 1),
        "total_day_hours": round(total_day_hrs, 1),
        "start_time": _min_to_hhmm(config.WORK_START_HOUR * 60),
        "end_time": end_time_str,
        "route_url": build_route_url(route_postcodes),
        "warnings": warnings,
    }


def _merge_fixed_and_flexible(fixed: list, flexible: list, warnings: list) -> list:
    """Merge fixed-time appointments with flexible jobs, respecting time constraints."""
    if not fixed:
        return flexible

    result = []
    flex_iter = iter(flexible)
    cursor_min = config.WORK_START_HOUR * 60

    for fj in fixed:
        # Fill flexible jobs before this fixed appointment
        while True:
            try:
                nxt = next(flex_iter)
            except StopIteration:
                break

            est_end = cursor_min + int(nxt.get("_duration_hrs", 2) * 60) + 30  # 30 min travel buffer
            if est_end <= fj["_fixed_minutes"]:
                result.append(nxt)
                cursor_min = est_end
            else:
                # Push back — can't fit before fixed appointment
                flexible.insert(0, nxt)  # crude pushback
                break

        result.append(fj)
        cursor_min = fj["_fixed_minutes"] + int(fj.get("_duration_hrs", 2) * 60)

    # Remaining flexible
    for fj in flex_iter:
        result.append(fj)

    return result


def _min_to_hhmm(minutes: int) -> str:
    """Convert minutes since midnight to HH:MM string."""
    h = minutes // 60
    m = minutes % 60
    return f"{h:02d}:{m:02d}"


def _empty_plan() -> dict:
    return {
        "route": [],
        "total_drive_minutes": 0,
        "total_drive_miles": 0,
        "total_work_hours": 0,
        "total_day_hours": 0,
        "start_time": _min_to_hhmm(config.WORK_START_HOUR * 60),
        "end_time": _min_to_hhmm(config.WORK_START_HOUR * 60),
        "route_url": "",
        "warnings": [],
    }
