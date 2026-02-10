$new = 'AKfycbxEvk_URObSEcsjWX5NIBoozJvZ47Zl5PTOf2Q3RrwB_t6CRf0od4EfBmOUvaRDPcCZDw'

$oldUrls = @(
    'AKfycbxKtcqHb2_PyzZfoOYAGxeVsa1KM4gLAVgGok9SNCSDmJsGNO7yX1RduRTs3r3hWdtPYA',
    'AKfycbzlFeWlGgYNrlGrvYxFM-Re6lxHIVPcV7fNPFlkDE7i1_6ELa0scHF_p2W6lcY4s_rxxw',
    'AKfycby6OwRXYnrEJAHslpSQCTGQTW_pvpv8TxUP53j1Kg67Dt9NvQO3qCJSK-QCSGVhSRWkdA',
    'AKfycbwYDn61QsMjXF4l6ZboFLV8dMsnNK7KWDjGnZ8iDdyBvAat9uAx3WtfOKgpAQoLfmUaaA',
    'AKfycbwH3y3aPED--wm8N8lUXgUsLKad8w6NoXNEgslzHrzYRnN50rs13MVey84G7xvlT8A6',
    'AKfycbwk-lcoeEt2tEMMGn5nFmyH2LhCZIAwznESdbwZREhEWtMkWcGshSsuBcktIWlQNU7M3w'
)

$allFiles = Get-ChildItem -Path "d:\gardening" -Include *.js,*.html,*.gs -Recurse -File
$updated = 0
foreach ($f in $allFiles) {
    $content = [System.IO.File]::ReadAllText($f.FullName)
    $changed = $false
    foreach ($old in $oldUrls) {
        if ($content.Contains($old)) {
            $content = $content.Replace($old, $new)
            $changed = $true
        }
    }
    if ($changed) {
        [System.IO.File]::WriteAllText($f.FullName, $content)
        Write-Host "Updated: $($f.Name)"
        $updated++
    }
}
Write-Host "`nTotal files updated: $updated"

$remaining = 0
foreach ($f in (Get-ChildItem -Path "d:\gardening" -Include *.js,*.html,*.gs -Recurse -File)) {
    $c = [System.IO.File]::ReadAllText($f.FullName)
    foreach ($old in $oldUrls) {
        if ($c.Contains($old)) {
            Write-Host "STILL HAS OLD URL: $($f.Name)"
            $remaining++
        }
    }
}
Write-Host "Old URL references remaining: $remaining"
