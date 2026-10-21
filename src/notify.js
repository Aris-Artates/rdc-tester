import { spawn } from 'node:child_process';

/** One machine-readable line the UI picks out of the log to show the result card. */
export const summaryLine = obj => '__SUMMARY__ ' + JSON.stringify(obj);

/**
 * Windows pop-up notification (tray balloon), no extra install needed.
 * Silently does nothing on other systems or when QA_NOTIFY=off.
 */
export function notify(title, body) {
  if (process.platform !== 'win32' || /^off$/i.test(process.env.QA_NOTIFY || '')) return Promise.resolve();
  const esc = s => String(s).replace(/'/g, "''");
  const ps = `Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing;
$n = New-Object System.Windows.Forms.NotifyIcon; $n.Icon = [System.Drawing.SystemIcons]::Information; $n.Visible = $true;
$n.ShowBalloonTip(8000, '${esc(title)}', '${esc(body)}', [System.Windows.Forms.ToolTipIcon]::Info); Start-Sleep -Seconds 9; $n.Dispose()`;
  return new Promise(resolve => {
    const p = spawn('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', ps], { stdio: 'ignore', detached: true, windowsHide: true });
    p.unref();
    setTimeout(resolve, 300);
  });
}
