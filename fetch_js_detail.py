import ssl, urllib.request
ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE
r = urllib.request.urlopen('https://gardnersgm.co.uk/js/booking.js?v=20260219a', context=ctx)
js = r.read().decode()

# Check if the old or new version
if 'serviceExtras' in js:
    print("NEW VERSION - has serviceExtras")
else:
    print("OLD VERSION - missing serviceExtras")

if 'pwSurfaceGroup' in js:
    print("NEW VERSION - has pwSurfaceGroup")
else:
    print("MISSING pwSurfaceGroup")

# Print lines around showGardenDetails to see if it has the new switch cases
lines = js.splitlines()
for i, line in enumerate(lines):
    if 'function showGardenDetails' in line:
        print(f"\n--- showGardenDetails starts at line {i+1} ---")
        for j in range(i, min(i+10, len(lines))):
            print(f"  L{j+1}: {lines[j]}")

# Check if wasteRemovalGroup is shown for lawn-cutting (old bug)
for i, line in enumerate(lines):
    if "'lawn-cutting'" in line and 'case' in line:
        print(f"\n--- lawn-cutting case at line {i+1} ---")
        for j in range(i, min(i+8, len(lines))):
            print(f"  L{j+1}: {lines[j]}")
