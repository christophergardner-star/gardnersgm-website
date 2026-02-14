"""
Clean up test customer rows from the Jobs sheet.
Deletes all rows where email contains '@testcustomer.ggm'
Uses get_clients to find them, then delete_client to remove each.
"""
import requests, json, time

WEBHOOK = (
    "https://script.google.com/macros/s/"
    "AKfycbyjUkYuFrpigXi6chj1B4z-xjHsgnnmkcQ_SejJwdqbstbAq-QooLz9G1sQpfl3vGGufQ/exec"
)

def main():
    print("Fetching all clients from Jobs sheet...")
    r = requests.get(WEBHOOK, params={"action": "get_clients"}, timeout=30)
    data = r.json()
    clients = data.get("clients", [])
    print(f"Total rows: {len(clients)}")

    # Find test entries (descending row order so deletes don't shift indexes)
    test_rows = [c for c in clients if "@testcustomer.ggm" in str(c.get("email", "")).lower()]
    test_rows.sort(key=lambda c: c.get("rowIndex", 0), reverse=True)
    print(f"Test entries to delete: {len(test_rows)}")

    if not test_rows:
        print("Nothing to clean up.")
        return

    for i, c in enumerate(test_rows):
        row_idx = c.get("rowIndex")
        name = c.get("name", "?")
        print(f"  [{i+1}/{len(test_rows)}] Deleting row {row_idx}: {name}...", end=" ", flush=True)
        try:
            resp = requests.post(WEBHOOK, json={
                "action": "delete_client",
                "rowIndex": row_idx
            }, timeout=20)
            if resp.status_code == 200:
                print("✅")
            else:
                print(f"❌ HTTP {resp.status_code}")
        except Exception as e:
            print(f"❌ {e}")
        time.sleep(1)  # avoid rate limit

    print(f"\nDone — deleted {len(test_rows)} test entries.")

if __name__ == "__main__":
    main()
