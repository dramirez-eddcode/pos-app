# Dumps selected tables of an Access .mdb to JSON files.
# Usage: powershell -File mdb-dump.ps1 -Mdb <path> -Password <pwd> -OutDir <dir>
# Tablas exportadas: EMPRESA, TIPOUSUARIO, USUARIO, PRODUCTO, CADUCIDAD

param(
    [Parameter(Mandatory = $true)][string]$Mdb,
    [Parameter(Mandatory = $true)][string]$Password,
    [Parameter(Mandatory = $true)][string]$OutDir
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $Mdb)) { throw "MDB no encontrado: $Mdb" }
New-Item -ItemType Directory -Path $OutDir -Force | Out-Null

# Choose an installed ACE OLE DB provider
$providers = (New-Object System.Data.OleDb.OleDbEnumerator).GetElements() |
    Select-Object -ExpandProperty SOURCES_NAME
$provider = @('Microsoft.ACE.OLEDB.16.0', 'Microsoft.ACE.OLEDB.12.0') |
    Where-Object { $providers -contains $_ } | Select-Object -First 1
if (-not $provider) { throw "No hay driver ACE OLEDB instalado (12.0 o 16.0)" }

$cs = "Provider=$provider;Data Source=$Mdb;Jet OLEDB:Database Password=$Password;"
$conn = New-Object System.Data.OleDb.OleDbConnection $cs
$conn.Open()

function Read-Table {
    param($conn, [string]$sql)
    $cmd = $conn.CreateCommand()
    $cmd.CommandText = $sql
    $rd = $cmd.ExecuteReader()
    $cols = @()
    for ($i = 0; $i -lt $rd.FieldCount; $i++) { $cols += $rd.GetName($i) }
    $rows = New-Object System.Collections.ArrayList
    while ($rd.Read()) {
        $row = [ordered]@{}
        for ($i = 0; $i -lt $rd.FieldCount; $i++) {
            $v = $rd.GetValue($i)
            if ($v -is [System.DBNull]) { $v = $null }
            elseif ($v -is [datetime]) { $v = $v.ToString("yyyy-MM-ddTHH:mm:ss.fffZ") }
            $row[$cols[$i]] = $v
        }
        [void]$rows.Add([pscustomobject]$row)
    }
    $rd.Close()
    return , $rows
}

function Save-Json {
    param([string]$path, $data)
    # -Compress para archivos compactos; -Depth 10 para no truncar
    $json = ConvertTo-Json -InputObject $data -Depth 10 -Compress
    # utf8 SIN BOM para compatibilidad con Node
    $utf8 = New-Object System.Text.UTF8Encoding $false
    [System.IO.File]::WriteAllText($path, $json, $utf8)
}

$tables = @{
    empresa     = "SELECT * FROM EMPRESA"
    tipousuario = "SELECT ID_TIPOUSUARIO, NOMBRE_tipousuario FROM TIPOUSUARIO"
    usuario     = "SELECT ID_USUARIO, LOGIN_USUARIO, PASSWORD_USUARIO, ID_TIPOUSUARIO, NOMBRE_USUARIO, CANCELA_USUARIO FROM USUARIO"
    producto    = "SELECT ID_PRODUCTO, CODIGO_PRODUCTO, NOMBRE_PRODUCTO, SUSTANCIA_PRODUCTO, PRECIO_PRODUCTO, COSTO_PRODUCTO, ID_LABORATORIO, MAX_PRODUCTO, MIN_PRODUCTO, IVA_PRODUCTO, ESTATUS_PRODUCTO FROM PRODUCTO"
    # Sólo lotes con saldo pendiente (arranque limpio)
    caducidad   = "SELECT ID_CADUCIDAD, CODIGO_PRODUCTO, TOTAL_CADUCIDAD, SALDO_CADUCIDAD, FECHA_CADUCIDAD FROM CADUCIDAD WHERE SALDO_CADUCIDAD > 0"
}

$summary = [ordered]@{}
foreach ($name in $tables.Keys) {
    $data = Read-Table -conn $conn -sql $tables[$name]
    $path = Join-Path $OutDir "$name.json"
    Save-Json -path $path -data $data
    $summary[$name] = $data.Count
    Write-Host ("  [OK] {0,-12} {1,8} filas -> {2}" -f $name, $data.Count, $path)
}

$conn.Close()

Write-Host ""
Write-Host "Resumen del dump:"
$summary.GetEnumerator() | ForEach-Object { Write-Host ("  {0,-12} {1}" -f $_.Key, $_.Value) }
