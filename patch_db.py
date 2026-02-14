import os
path = r"C:\GGM-Hub\platform\app\database.py"
with open(path, "r", encoding="utf-8") as f:
    content = f.read()
new_method = '    def upsert_subscribers(self, rows: list[dict]):\n        """Bulk upsert subscribers from sync."""\n        now = datetime.now().isoformat()\n        self.execute("DELETE FROM subscribers")\n        for row in rows:\n            row["last_synced"] = now\n            row["dirty"] = 0\n            cols = list(row.keys())\n            placeholders = ", ".join("?" for _ in cols)\n            col_names = ", ".join(cols)\n            vals = [row[c] for c in cols]\n            self.execute(\n                f"INSERT INTO subscribers ({col_names}) VALUES ({placeholders})",\n                tuple(vals)\n            )\n        self.commit()\n\n'
target = "    # Subscribers (extended)"
if "def upsert_subscribers" not in content:
    content = content.replace(target, new_method + target)
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)
    print("PATCHED: upsert_subscribers added")
else:
    print("SKIPPED: already exists")
