"""
Seed 50 realistic Cornwall-based test customers into the GGM system.
Each is sent via the booking_payment action (same as the website booking form)
one at a time with a short delay, so we can verify data flows correctly through:
  Jobs sheet → confirmation email → calendar → Telegram notification

Run:  python seed_customers.py
"""
import requests, time, json, random, sys
from datetime import datetime, timedelta

WEBHOOK = (
    "https://script.google.com/macros/s/"
    "AKfycbx-q2qSeCorIEeXPE9d2MgAZLKEFwFNW9lARLE1yYciH9wJWwvktUTuDVLz_rSCbUhkMg/exec"
)

# Cornwall postcodes by area
POSTCODES = [
    "PL26 8LT", "PL25 3NJ", "PL24 2SQ", "PL26 6BN", "PL26 7UF",
    "TR1 3SP",  "TR2 4JQ",  "TR4 8QN",  "TR7 1RP",  "TR8 5SE",
    "TR14 7NJ", "TR15 3AJ", "TR16 6SA", "TR13 8AA", "TR12 7PB",
    "PL30 5BZ", "PL31 2DQ", "PL27 6JE", "PL28 8LF", "PL14 3PT",
    "TR10 9EL", "TR11 4SG", "TR3 6ND",  "TR6 0JW",  "TR9 6HE",
]

STREETS = [
    "Church Lane", "High Street", "Fore Street", "Chapel Road", "Tregenna Hill",
    "Polmear Road", "Trevanion Road", "Truro Road", "Bodmin Road", "Station Road",
    "Harbour View", "Cliff Road", "Beach Road", "Victoria Road", "Park Lane",
    "Rosevear Road", "Pentewan Road", "Charlestown Road", "Porth Bean Road", "Trelawney Road",
    "Mevagissey Hill", "Par Lane", "Newquay Road", "Falmouth Road", "Redruth Lane",
]

SERVICES = [
    "Lawn Mowing",
    "Hedge Trimming",
    "Garden Clearance",
    "Pressure Washing",
    "Tree Surgery",
    "Fencing & Gates",
    "Turfing",
    "Weed Control",
    "Patio Laying",
    "Strimming & Edging",
    "Leaf Clearance",
    "Planting & Borders",
    "Regular Maintenance",
    "One-Off Garden Tidy",
    "Commercial Grounds",
]

FIRST_NAMES = [
    "James", "Sarah", "David", "Emma", "Mark", "Claire", "Paul", "Helen",
    "Andrew", "Sophie", "Michael", "Rachel", "Peter", "Laura", "Robert",
    "Karen", "Simon", "Julie", "Chris", "Lisa", "Tom", "Jessica", "Daniel",
    "Rebecca", "Stephen", "Charlotte", "Ian", "Gemma", "Martin", "Victoria",
    "Richard", "Amanda", "Neil", "Donna", "Stuart", "Caroline", "Kevin",
    "Tracey", "Graham", "Michelle", "Barry", "Nicola", "Roger", "Debbie",
    "Colin", "Janet", "Trevor", "Wendy", "Derek", "Sandra",
]

SURNAMES = [
    "Trelawny", "Penrose", "Treloar", "Polkinghorne", "Tregoning",
    "Boscawen", "Cardinham", "Nancarrow", "Chenoweth", "Pascoe",
    "Roseveare", "Mennear", "Truscott", "Opie", "Chegwin",
    "Penhale", "Kitto", "Blamey", "Trudgeon", "Angove",
    "Mitchell", "Williams", "Thomas", "Richards", "Johns",
    "Harris", "Martin", "Roberts", "Phillips", "Edwards",
    "Bennett", "Clark", "Turner", "Green", "Wood",
    "Baker", "Hall", "Morris", "Taylor", "Brown",
    "Walker", "King", "Carter", "Hill", "Moore",
    "Cooper", "Fox", "Palmer", "Knight", "Dixon",
]

TIMES = [
    "08:00 - 09:00", "09:00 - 10:00", "10:00 - 11:00",
    "11:00 - 12:00", "12:00 - 13:00", "13:00 - 14:00",
    "14:00 - 15:00", "15:00 - 16:00", "16:00 - 17:00",

    "11:00 - 12:00", "12:00 - 13:00", "13:00 - 14:00",
    "14:00 - 15:00", "15:00 - 16:00", "16:00 - 17:00",
]

NOTES = [
    "Access via side gate on left", "Dog in back garden — please ring bell",
    "Key under mat if not home", "Parking on street outside",
    "Large rear garden, approx 80sqm", "Please avoid flowerbed near shed",
    "Customer prefers morning visits", "Regular fortnightly service preferred",
    "Steep slope at rear — extra care needed", "Elderly customer — please knock loudly",
    "Contains Japanese knotweed near boundary", "Customer has CCTV — will check work",
    "Payment by bank transfer preferred", "Customer wants before/after photos",
    "Access through neighbour's drive if locked", "",
    "Ring mobile on arrival", "Leave clippings in brown bin",
    "No mowing after 4pm — shift worker sleeping", "Neighbour has spare key",
]

PRICES = [45, 55, 65, 75, 80, 85, 95, 100, 110, 120, 130, 150, 175, 200, 250,
           300, 350, 60, 70, 90, 140, 160, 180, 220, 280]

def generate_customer(i):
    """Generate customer #i (0-indexed)."""
    first = FIRST_NAMES[i % len(FIRST_NAMES)]
    last = SURNAMES[i % len(SURNAMES)]
    name = f"{first} {last}"
    email = f"{first.lower()}.{last.lower()}@testcustomer.ggm"
    phone = f"07{random.randint(100, 999)}{random.randint(100000, 999999)}"
    house_num = random.randint(1, 120)
    street = STREETS[i % len(STREETS)]
    postcode = POSTCODES[i % len(POSTCODES)]
    address = f"{house_num} {street}"
    service = SERVICES[i % len(SERVICES)]
    price = PRICES[i % len(PRICES)]
    # First 5 customers are TODAY so they show in Today's Jobs immediately
    # Rest spread across next few weeks
    if i < 5:
        date = datetime.now().strftime("%Y-%m-%d")
    else:
        # Spread across the next 30 days
        days_ahead = ((i - 5) % 30) + 1
        future = datetime.now() + timedelta(days=days_ahead)
        date = future.strftime("%Y-%m-%d")
    time_slot = TIMES[i % len(TIMES)]
    note = NOTES[i % len(NOTES)]

    return {
        "action": "booking_payment",
        "customer": {
            "name": name,
            "email": email,
            "phone": phone,
            "address": address,
            "postcode": postcode,
        },
        "serviceName": service,
        "date": date,
        "time": time_slot,
        "price": str(price),
        "amount": price * 100,  # pence
        "distance": f"{random.randint(2, 25)} miles",
        "driveTime": f"{random.randint(5, 40)} min",
        "googleMapsUrl": f"https://www.google.com/maps/search/{postcode.replace(' ', '+')}",
        "notes": note,
    }


def main():
    print("=" * 60)
    print("  GGM — Seeding 50 Test Customers (one at a time)")
    print("=" * 60)
    print()

    success = 0
    failed = 0

    for i in range(50):
        cust = generate_customer(i)
        name = cust["customer"]["name"]
        service = cust["serviceName"]
        date = cust["date"]
        price = cust["price"]

        print(f"[{i+1:2d}/50] {name:<22s} | {service:<22s} | {date} | £{price}...", end=" ", flush=True)

        try:
            r = requests.post(WEBHOOK, json=cust, timeout=30,
                              headers={"Content-Type": "application/json"})
            if r.status_code == 200:
                try:
                    resp = r.json()
                except Exception:
                    resp = {"raw": r.text[:100]}

                if resp.get("status") == "success" or resp.get("jobNumber") or "success" in r.text.lower():
                    jn = resp.get("jobNumber", resp.get("job_number", "—"))
                    print(f"✅ Job #{jn}")
                    success += 1
                else:
                    print(f"❌ {json.dumps(resp)[:100]}")
                    failed += 1
            else:
                print(f"❌ HTTP {r.status_code}: {r.text[:80]}")
                failed += 1
        except requests.RequestException as e:
            print(f"❌ {e}")
            failed += 1

        # Pause between requests to avoid rate-limiting GAS
        if i < 49:
            time.sleep(2)

    print()
    print("=" * 60)
    print(f"  Done: {success} succeeded, {failed} failed")
    print("=" * 60)


if __name__ == "__main__":
    main()
