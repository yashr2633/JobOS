param([Parameter(Mandatory)][string]$InputDirectory)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem

function Read-WorkbookXml($archive, [string]$entryName) {
  $entry = $archive.GetEntry($entryName)
  if (!$entry) { return $null }
  $reader = [IO.StreamReader]::new($entry.Open())
  try { return [xml]$reader.ReadToEnd() }
  finally { $reader.Dispose() }
}

function Read-Cell($cell, $strings) {
  $type = $cell.GetAttribute('t')
  $raw = $cell.SelectSingleNode("*[local-name()='v']")
  if ($type -eq 's' -and $raw) { return $strings[[int]$raw.InnerText] }
  if ($type -eq 'inlineStr') { return $cell.SelectSingleNode("*[local-name()='is']").InnerText }
  if ($raw) { return $raw.InnerText }
  return ''
}

$root = (Resolve-Path -LiteralPath $InputDirectory).Path
$sources = @(
  @{File='sheet-2.xlsx'; Source='HR_Lists'; Header=1; Name='C'; Email='D'; Title='E'; Company='F'},
  @{File='sheet-1.xlsx'; Source='HR & Recruiter Outreach Database'; Header=3; Name='D'; Email='C'; Title=''; Company='B'}
)
$contacts = [ordered]@{}
$audit = @()
foreach ($source in $sources) {
  $zip = [IO.Compression.ZipFile]::OpenRead((Join-Path $root $source.File))
  try {
    $shared = Read-WorkbookXml $zip 'xl/sharedStrings.xml'
    $strings = if ($shared) { @($shared.DocumentElement.ChildNodes | ForEach-Object { $_.InnerText }) } else { @() }
    $sheet = Read-WorkbookXml $zip 'xl/worksheets/sheet1.xml'
    $valid = 0
    $withoutCompany = 0
    $duplicate = 0
    foreach ($row in $sheet.SelectNodes("//*[local-name()='sheetData']/*[local-name()='row']")) {
      if ([int]$row.GetAttribute('r') -le $source.Header) { continue }
      $fields = @{}
      foreach ($cell in $row.ChildNodes) {
        if ($cell.LocalName -ne 'c') { continue }
        $column = $cell.GetAttribute('r') -replace '\d+$',''
        if ($column -notin @($source.Name, $source.Email, $source.Company, $source.Title)) { continue }
        $fields[$column] = ([string](Read-Cell $cell $strings)).Trim()
      }
      $email = ([string]$fields[$source.Email]).ToLowerInvariant()
      if ($email.Length -gt 254 -or $email -notmatch '^[a-z0-9.!#$%&*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}$') { continue }
      $valid++
      $company = [string]$fields[$source.Company]
      if (!$company -or $company.Length -gt 200 -or $company -match '@') { $withoutCompany++; continue }
      $name = [string]$fields[$source.Name]
      if ($name.Length -gt 160 -or $name -match '@|^(-|n/?a|unknown|not available)$') { $name = '' }
      $title = [string]$fields[$source.Title]
      if ($title.Length -gt 200 -or $title -match '@') { $title = '' }
      if ($contacts.Contains($email)) {
        $duplicate++
        $existing = $contacts[$email]
        if (!$existing.name -and $name) { $existing.name = $name }
        if (!$existing.title -and $title) { $existing.title = $title }
        if ($existing.source -notlike "*$($source.Source)*") { $existing.source += "; " + $source.Source }
        continue
      }
      $contacts[$email] = @{
        email = $email
        name = if ($name) { $name } else { $null }
        company = $company
        title = if ($title) { $title } else { $null }
        source = $source.Source
      }
    }
    $audit += @{source=$source.Source; email_rows=$valid; missing_company=$withoutCompany; duplicate_rows=$duplicate}
  }
  finally { $zip.Dispose() }
}

$contacts.Values | ForEach-Object { ConvertTo-Json -InputObject $_ -Compress } |
  Set-Content -LiteralPath (Join-Path $root 'contacts.ndjson') -Encoding utf8
$summary = @{sources=$audit; unique_contacts=$contacts.Count; with_name=@($contacts.Values | Where-Object name).Count}
$summary | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $root 'counts.json') -Encoding utf8
$summary | ConvertTo-Json -Depth 4 -Compress
