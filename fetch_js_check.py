import ssl, urllib.request
ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE
r = urllib.request.urlopen('https://gardnersgm.co.uk/js/booking.js?v=20260219a', context=ctx)
js = r.read().decode()
print("TOTAL LINES:", len(js.splitlines()))
# Check for showGardenDetails function
for i, line in enumerate(js.splitlines()):
    if 'function showGardenDetails' in line:
        print(f"FOUND showGardenDetails at line {i+1}")
    if 'function collectGardenDetails' in line:
        print(f"FOUND collectGardenDetails at line {i+1}")
    if 'gardenDetailsSection' in line:
        print(f"L{i+1}: {line.strip()[:100]}")
    if 'serviceExtras' in line and ('const' in line or 'var' in line or 'let' in line):
        print(f"FOUND serviceExtras at line {i+1}")
