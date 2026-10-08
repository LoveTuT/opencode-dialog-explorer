param([Parameter(Mandatory = $true)][string]$Target)

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class ExplorerFocus {
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hwnd, int command);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
}
'@

Start-Process explorer.exe -ArgumentList ('"' + $Target + '"')
$shell = New-Object -ComObject Shell.Application
for ($i = 0; $i -lt 20; $i++) {
  Start-Sleep -Milliseconds 150
  foreach ($window in @($shell.Windows())) {
    try {
      if ($window.Document.Folder.Self.Path -ine $Target) { continue }
      $hwnd = [IntPtr]$window.HWND
      [void][ExplorerFocus]::ShowWindowAsync($hwnd, 9)
      [void][ExplorerFocus]::SetForegroundWindow($hwnd)
      exit
    } catch { continue }
  }
}
Write-Output $false
