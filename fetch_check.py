import ssl, urllib.request
ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE
r = urllib.request.urlopen('https://gardnersgm.co.uk/booking.html', context=ctx)
h = r.read().decode()
for line in h.splitlines():
    if 'booking.js' in line:
        print("JS:", line.strip())
    if 'gardenDetailsSection' in line:
        print("SECTION:", line.strip()[:80])
    if 'gardenSizeGroup' in line:
        print("SIZE_GROUP:", line.strip()[:80])
print("DONE - total lines:", len(h.splitlines()))
