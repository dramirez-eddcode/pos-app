# Envía bytes crudos (ESC/POS) a una impresora Windows en modo RAW via Win32 spooler.
# Usa P/Invoke sobre winspool.drv para evitar que el driver reinterprete los bytes.
#
# Uso:
#   powershell -File print-raw.ps1 -Printer "EPSON TM-T20III Receipt" -File <ruta>
#
# El archivo debe contener los bytes binarios exactos a enviar.
# Devuelve código de salida 0 si OK, 1 si error.

param(
    [Parameter(Mandatory = $true)][string]$Printer,
    [Parameter(Mandatory = $true)][string]$File
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $File)) { Write-Error "Archivo no encontrado: $File"; exit 1 }

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public static class RawPrinter {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public class DocInfo1 {
        [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
        [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
        [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
    }

    [DllImport("winspool.Drv", EntryPoint = "OpenPrinterW", SetLastError = true, CharSet = CharSet.Unicode, ExactSpelling = true)]
    public static extern bool OpenPrinter([MarshalAs(UnmanagedType.LPWStr)] string szPrinter, out IntPtr hPrinter, IntPtr pd);

    [DllImport("winspool.Drv", EntryPoint = "ClosePrinter", SetLastError = true, ExactSpelling = true)]
    public static extern bool ClosePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "StartDocPrinterW", SetLastError = true, CharSet = CharSet.Unicode, ExactSpelling = true)]
    public static extern bool StartDocPrinter(IntPtr hPrinter, int level, [In, MarshalAs(UnmanagedType.LPStruct)] DocInfo1 di);

    [DllImport("winspool.Drv", EntryPoint = "EndDocPrinter", SetLastError = true, ExactSpelling = true)]
    public static extern bool EndDocPrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "StartPagePrinter", SetLastError = true, ExactSpelling = true)]
    public static extern bool StartPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "EndPagePrinter", SetLastError = true, ExactSpelling = true)]
    public static extern bool EndPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "WritePrinter", SetLastError = true, ExactSpelling = true)]
    public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, int dwCount, out int dwWritten);

    public static bool SendBytes(string printer, byte[] data) {
        IntPtr h;
        if (!OpenPrinter(printer, out h, IntPtr.Zero)) throw new System.ComponentModel.Win32Exception();
        try {
            var di = new DocInfo1 { pDocName = "Farmacias MS POS", pOutputFile = null, pDataType = "RAW" };
            if (!StartDocPrinter(h, 1, di)) throw new System.ComponentModel.Win32Exception();
            try {
                if (!StartPagePrinter(h)) throw new System.ComponentModel.Win32Exception();
                IntPtr ptr = Marshal.AllocCoTaskMem(data.Length);
                try {
                    Marshal.Copy(data, 0, ptr, data.Length);
                    int written;
                    if (!WritePrinter(h, ptr, data.Length, out written)) throw new System.ComponentModel.Win32Exception();
                    return written == data.Length;
                } finally {
                    Marshal.FreeCoTaskMem(ptr);
                    EndPagePrinter(h);
                }
            } finally {
                EndDocPrinter(h);
            }
        } finally {
            ClosePrinter(h);
        }
    }
}
"@

try {
    $bytes = [System.IO.File]::ReadAllBytes((Resolve-Path $File))
    $ok = [RawPrinter]::SendBytes($Printer, $bytes)
    if ($ok) {
        Write-Host "OK enviados $($bytes.Length) bytes a '$Printer'"
        exit 0
    } else {
        Write-Error "WritePrinter no envió todos los bytes"
        exit 1
    }
}
catch {
    Write-Error "ERROR: $($_.Exception.Message)"
    exit 1
}
