$ErrorActionPreference = 'Stop'
$workspace = Split-Path -Parent $PSScriptRoot
$source = Join-Path $workspace 'public\resources\Didarian_Research_Template.docx'
$target = Join-Path $workspace 'public\resources\Didarian_Research_Template.doc'
$evidence = Join-Path $workspace 'docs\evidence\template'
New-Item -ItemType Directory -Path $evidence -Force | Out-Null
$word = $null
$document = $null
try {
    # Create a dedicated, hidden Word automation instance; never attach to user documents.
    $word = New-Object -ComObject Word.Application
    $word.Visible = $false
    $word.DisplayAlerts = 0
    $word.AutomationSecurity = 3
    $document = $word.Documents.Open($source, $false, $true)
    $document.SaveAs2($target, 0) # wdFormatDocument = genuine Word 97-2003 binary.
    $document.Close(0)
    $document = $null
    $document = $word.Documents.Open($target, $false, $true)
    $text = $document.Content.Text
    if ($text -notmatch '(?m)Template design in processing') {
        throw 'The converted DOC does not contain the requested sentence.'
    }
    if ($document.SaveFormat -ne 0) { throw 'Unexpected Word document format.' }
    $document.ExportAsFixedFormat((Join-Path $evidence 'Didarian_Research_Template.pdf'), 17)
    [ordered]@{
        verifiedAt = [DateTime]::UtcNow.ToString('o')
        reader = 'Microsoft Word COM'
        wordVersion = $word.Version
        file = 'public/resources/Didarian_Research_Template.doc'
        saveFormat = $document.SaveFormat
        pages = $document.ComputeStatistics(2)
        content = $text.Trim()
        bytes = (Get-Item -LiteralPath $target).Length
        sha256 = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLower()
        signature = ([BitConverter]::ToString([IO.File]::ReadAllBytes($target)[0..7])).Replace('-', '')
        storageUpload = 'Not performed: no selected reachable Supabase project.'
    } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $evidence 'verification.json') -Encoding utf8
    Write-Output 'Generated and reopened genuine Word DOC; exact requested text verified.'
}
finally {
    if ($null -ne $document) { $document.Close(0) }
    if ($null -ne $word) { $word.Quit(0) }
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
}
