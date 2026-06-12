Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

# ── Resolve base directory (works for both .ps1 and .exe) ──
$baseDir = $PSScriptRoot
if (-not $baseDir) {
    $baseDir = [System.IO.Path]::GetDirectoryName([System.Diagnostics.Process]::GetCurrentProcess().MainModule.FileName)
}
if (-not $baseDir) {
    $baseDir = [System.IO.Directory]::GetCurrentDirectory()
}

$botDir = $baseDir
$lavalinkDir = Join-Path (Split-Path $botDir) "PinPlay-Lavalink"
$lavalinkJar = Join-Path $lavalinkDir "Lavalink.jar"

# ── State ──
$script:lavalinkProc = $null
$script:botProc = $null
$script:pendingLogs = [System.Collections.ArrayList]::Synchronized([System.Collections.ArrayList]::new())

# ── Theme: Ocean Blue + Soft Pink ──
$bgDeep       = [System.Drawing.Color]::FromArgb(8, 12, 24)
$bgCard       = [System.Drawing.Color]::FromArgb(16, 24, 44)
$bgCardHover  = [System.Drawing.Color]::FromArgb(22, 34, 58)
$bgInput      = [System.Drawing.Color]::FromArgb(6, 10, 20)
$accentBlue   = [System.Drawing.Color]::FromArgb(100, 180, 230)
$accentPink   = [System.Drawing.Color]::FromArgb(210, 140, 165)
$accentTeal   = [System.Drawing.Color]::FromArgb(55, 145, 190)
$greenColor   = [System.Drawing.Color]::FromArgb(70, 210, 150)
$redColor     = [System.Drawing.Color]::FromArgb(235, 95, 115)
$yellowColor  = [System.Drawing.Color]::FromArgb(235, 195, 90)
$textMain     = [System.Drawing.Color]::FromArgb(215, 225, 242)
$textDim      = [System.Drawing.Color]::FromArgb(90, 110, 145)
$borderClr    = [System.Drawing.Color]::FromArgb(35, 50, 78)
$statusBg     = [System.Drawing.Color]::FromArgb(20, 30, 50)

# ── Form ──
$form = New-Object System.Windows.Forms.Form
$form.Text = "PinPlay Launcher"
$form.Size = New-Object System.Drawing.Size(840, 710)
$form.StartPosition = "CenterScreen"
$form.BackColor = $bgDeep
$form.ForeColor = $textMain
$form.FormBorderStyle = "FixedSingle"
$form.MaximizeBox = $false
$form.Font = New-Object System.Drawing.Font("Segoe UI", 9)

# Try to set icon
$icoPath = Join-Path $botDir "PinPlayLogo.ico"
try { if (Test-Path $icoPath) { $form.Icon = New-Object System.Drawing.Icon($icoPath) } } catch {}

# ── Logo Image ──
$picLogo = New-Object System.Windows.Forms.PictureBox
$picLogo.Location = New-Object System.Drawing.Point(24, 12)
$picLogo.Size = New-Object System.Drawing.Size(50, 50)
$picLogo.SizeMode = "Zoom"
$picLogo.BackColor = [System.Drawing.Color]::Transparent
$pngPath = Join-Path $botDir "PinPlayLogo.png"
try { if (Test-Path $pngPath) { $picLogo.Image = [System.Drawing.Image]::FromFile($pngPath) } } catch {}
$form.Controls.Add($picLogo)

# ── Title ──
$lblTitle = New-Object System.Windows.Forms.Label
$lblTitle.Text = "PinPlay Launcher"
$lblTitle.Font = New-Object System.Drawing.Font("Segoe UI", 20, [System.Drawing.FontStyle]::Bold)
$lblTitle.ForeColor = $accentBlue
$lblTitle.AutoSize = $true
$lblTitle.Location = New-Object System.Drawing.Point(82, 10)
$lblTitle.BackColor = [System.Drawing.Color]::Transparent
$form.Controls.Add($lblTitle)

$lblSub = New-Object System.Windows.Forms.Label
$lblSub.Text = "Manage Lavalink & Bot in one place"
$lblSub.Font = New-Object System.Drawing.Font("Segoe UI", 9)
$lblSub.ForeColor = $textDim
$lblSub.AutoSize = $true
$lblSub.Location = New-Object System.Drawing.Point(85, 46)
$lblSub.BackColor = [System.Drawing.Color]::Transparent
$form.Controls.Add($lblSub)

# ── Separator ──
$sep = New-Object System.Windows.Forms.Panel
$sep.Location = New-Object System.Drawing.Point(20, 72)
$sep.Size = New-Object System.Drawing.Size(790, 1)
$sep.BackColor = $borderClr
$form.Controls.Add($sep)

# ── Helper: styled button ──
function Make-Btn($text, $x, $y, $w, $h, $bg, $fg, $bdr) {
    $b = New-Object System.Windows.Forms.Button
    $b.Text = $text
    $b.Location = New-Object System.Drawing.Point($x, $y)
    $b.Size = New-Object System.Drawing.Size($w, $h)
    $b.BackColor = $bg
    $b.ForeColor = $fg
    $b.FlatStyle = "Flat"
    $b.FlatAppearance.BorderColor = $bdr
    $b.FlatAppearance.BorderSize = 1
    $b.FlatAppearance.MouseOverBackColor = $bgCardHover
    $b.Font = New-Object System.Drawing.Font("Segoe UI", 9, [System.Drawing.FontStyle]::Bold)
    $b.Cursor = "Hand"
    return $b
}

# ════════════════════════════════════════
# ── LAVALINK CARD ──
# ════════════════════════════════════════
$pnlLava = New-Object System.Windows.Forms.Panel
$pnlLava.Location = New-Object System.Drawing.Point(20, 86)
$pnlLava.Size = New-Object System.Drawing.Size(388, 85)
$pnlLava.BackColor = $bgCard
$form.Controls.Add($pnlLava)

$l1 = New-Object System.Windows.Forms.Label
$l1.Text = "Lavalink Server"
$l1.Font = New-Object System.Drawing.Font("Segoe UI", 12, [System.Drawing.FontStyle]::Bold)
$l1.ForeColor = $accentPink
$l1.Location = New-Object System.Drawing.Point(14, 8)
$l1.AutoSize = $true
$l1.BackColor = [System.Drawing.Color]::Transparent
$pnlLava.Controls.Add($l1)

$l2 = New-Object System.Windows.Forms.Label
$l2.Text = "Audio Engine  |  Port 2333"
$l2.Font = New-Object System.Drawing.Font("Segoe UI", 8)
$l2.ForeColor = $textDim
$l2.Location = New-Object System.Drawing.Point(16, 32)
$l2.AutoSize = $true
$l2.BackColor = [System.Drawing.Color]::Transparent
$pnlLava.Controls.Add($l2)

$lblLavaStatus = New-Object System.Windows.Forms.Label
$lblLavaStatus.Text = "STOPPED"
$lblLavaStatus.Location = New-Object System.Drawing.Point(260, 10)
$lblLavaStatus.Size = New-Object System.Drawing.Size(118, 24)
$lblLavaStatus.ForeColor = $textDim
$lblLavaStatus.Font = New-Object System.Drawing.Font("Segoe UI", 9, [System.Drawing.FontStyle]::Bold)
$lblLavaStatus.TextAlign = "MiddleCenter"
$lblLavaStatus.BackColor = $statusBg
$pnlLava.Controls.Add($lblLavaStatus)

$btnLavaStart = Make-Btn "Start" 14 54 110 25 $bgCard $greenColor $greenColor
$pnlLava.Controls.Add($btnLavaStart)
$btnLavaStop = Make-Btn "Stop" 132 54 110 25 $bgCard $redColor $redColor
$pnlLava.Controls.Add($btnLavaStop)

# ════════════════════════════════════════
# ── BOT CARD ──
# ════════════════════════════════════════
$pnlBot = New-Object System.Windows.Forms.Panel
$pnlBot.Location = New-Object System.Drawing.Point(422, 86)
$pnlBot.Size = New-Object System.Drawing.Size(388, 85)
$pnlBot.BackColor = $bgCard
$form.Controls.Add($pnlBot)

$b1 = New-Object System.Windows.Forms.Label
$b1.Text = "PinPlay Bot"
$b1.Font = New-Object System.Drawing.Font("Segoe UI", 12, [System.Drawing.FontStyle]::Bold)
$b1.ForeColor = $accentBlue
$b1.Location = New-Object System.Drawing.Point(14, 8)
$b1.AutoSize = $true
$b1.BackColor = [System.Drawing.Color]::Transparent
$pnlBot.Controls.Add($b1)

$b2 = New-Object System.Windows.Forms.Label
$b2.Text = "Discord Music Bot  |  Node.js"
$b2.Font = New-Object System.Drawing.Font("Segoe UI", 8)
$b2.ForeColor = $textDim
$b2.Location = New-Object System.Drawing.Point(16, 32)
$b2.AutoSize = $true
$b2.BackColor = [System.Drawing.Color]::Transparent
$pnlBot.Controls.Add($b2)

$lblBotStatus = New-Object System.Windows.Forms.Label
$lblBotStatus.Text = "STOPPED"
$lblBotStatus.Location = New-Object System.Drawing.Point(260, 10)
$lblBotStatus.Size = New-Object System.Drawing.Size(118, 24)
$lblBotStatus.ForeColor = $textDim
$lblBotStatus.Font = New-Object System.Drawing.Font("Segoe UI", 9, [System.Drawing.FontStyle]::Bold)
$lblBotStatus.TextAlign = "MiddleCenter"
$lblBotStatus.BackColor = $statusBg
$pnlBot.Controls.Add($lblBotStatus)

$btnBotStart = Make-Btn "Start" 14 54 110 25 $bgCard $greenColor $greenColor
$pnlBot.Controls.Add($btnBotStart)
$btnBotStop = Make-Btn "Stop" 132 54 110 25 $bgCard $redColor $redColor
$pnlBot.Controls.Add($btnBotStop)

# ════════════════════════════════════════
# ── QUICK ACTIONS ──
# ════════════════════════════════════════
$btnStartAll = Make-Btn "START ALL" 20 186 388 44 $accentTeal ([System.Drawing.Color]::White) $accentTeal
$btnStartAll.FlatAppearance.MouseOverBackColor = $accentBlue
$btnStartAll.Font = New-Object System.Drawing.Font("Segoe UI", 13, [System.Drawing.FontStyle]::Bold)
$form.Controls.Add($btnStartAll)

$btnStopAll = Make-Btn "STOP ALL" 422 186 388 44 $redColor ([System.Drawing.Color]::White) $redColor
$btnStopAll.FlatAppearance.MouseOverBackColor = [System.Drawing.Color]::FromArgb(195, 70, 90)
$btnStopAll.Font = New-Object System.Drawing.Font("Segoe UI", 13, [System.Drawing.FontStyle]::Bold)
$form.Controls.Add($btnStopAll)

# ════════════════════════════════════════
# ── LOG TABS ──
# ════════════════════════════════════════
$btnTabBot = Make-Btn "Bot Logs" 20 248 190 30 $accentTeal ([System.Drawing.Color]::White) $accentTeal
$form.Controls.Add($btnTabBot)

$btnTabLava = Make-Btn "Lavalink Logs" 216 248 190 30 $bgCard $textMain $borderClr
$form.Controls.Add($btnTabLava)

$btnCopyLog = Make-Btn "Copy Logs" 620 248 95 30 $bgCard $accentBlue $accentBlue
$form.Controls.Add($btnCopyLog)

$btnClearLog = Make-Btn "Clear" 720 248 90 30 $bgCard $accentPink $accentPink
$form.Controls.Add($btnClearLog)

# ════════════════════════════════════════
# ── LOG BOX ──
# ════════════════════════════════════════
$txtLog = New-Object System.Windows.Forms.RichTextBox
$txtLog.Location = New-Object System.Drawing.Point(20, 286)
$txtLog.Size = New-Object System.Drawing.Size(790, 370)
$txtLog.BackColor = $bgInput
$txtLog.ForeColor = $textMain
$txtLog.Font = New-Object System.Drawing.Font("Consolas", 9.5)
$txtLog.ReadOnly = $true
$txtLog.BorderStyle = "None"
$txtLog.ScrollBars = "Vertical"
$txtLog.WordWrap = $true
$form.Controls.Add($txtLog)

# ════════════════════════════════════════
# ── INTERNAL STATE ──
# ════════════════════════════════════════
$script:currentTab = "bot"
$script:botLogs = [System.Collections.ArrayList]::new()
$script:lavaLogs = [System.Collections.ArrayList]::new()

function Update-Status($label, $st) {
    switch ($st) {
        "stopped"  { $label.Text = "STOPPED";  $label.ForeColor = $textDim }
        "starting" { $label.Text = "STARTING"; $label.ForeColor = $yellowColor }
        "running"  { $label.Text = "RUNNING";  $label.ForeColor = $greenColor }
        "error"    { $label.Text = "ERROR";    $label.ForeColor = $redColor }
    }
}

function Queue-Log($source, $text) {
    $script:pendingLogs.Add(@{ source = $source; text = $text; time = (Get-Date).ToString("HH:mm:ss") }) | Out-Null
}

function Process-PendingLogs {
    if ($script:pendingLogs.Count -eq 0) { return }
    $snap = $script:pendingLogs.ToArray()
    $script:pendingLogs.Clear()

    foreach ($e in $snap) {
        $src = $e.source
        $txt = $e.text
        $tm = $e.time
        $lines = $txt -split "`n" | Where-Object { $_.Trim() }
        foreach ($ln in $lines) {
            $fmt = "[$tm] $ln"
            if ($src -eq "bot") { $script:botLogs.Add($fmt) | Out-Null }
            else { $script:lavaLogs.Add($fmt) | Out-Null }

            if ($src -eq "lavalink" -and ($ln -match "Lavalink is ready|Started Launcher")) { Update-Status $lblLavaStatus "running" }
            if ($src -eq "bot" -and $ln -match "Logged in as") { Update-Status $lblBotStatus "running" }

            if ($script:currentTab -eq $src) {
                $clr = $textMain
                if ($ln -match "error|fail") { $clr = $redColor }
                elseif ($ln -match "warn") { $clr = $yellowColor }
                elseif ($ln -match "ready|Started|Logged in") { $clr = $greenColor }
                elseif ($ln.StartsWith(">>>")) { $clr = $accentBlue }

                $txtLog.SelectionStart = $txtLog.TextLength
                $txtLog.SelectionColor = $clr
                $txtLog.AppendText("$fmt`n")
            }
        }
    }
    $txtLog.ScrollToCaret()
}

function Show-Tab($tab) {
    $script:currentTab = $tab
    $txtLog.Clear()
    $list = if ($tab -eq "bot") { $script:botLogs } else { $script:lavaLogs }
    foreach ($item in $list) { $txtLog.AppendText("$item`n") }
    $txtLog.ScrollToCaret()

    if ($tab -eq "bot") {
        $btnTabBot.BackColor = $accentTeal; $btnTabBot.ForeColor = [System.Drawing.Color]::White; $btnTabBot.FlatAppearance.BorderColor = $accentTeal
        $btnTabLava.BackColor = $bgCard; $btnTabLava.ForeColor = $textMain; $btnTabLava.FlatAppearance.BorderColor = $borderClr
    } else {
        $btnTabLava.BackColor = $accentTeal; $btnTabLava.ForeColor = [System.Drawing.Color]::White; $btnTabLava.FlatAppearance.BorderColor = $accentTeal
        $btnTabBot.BackColor = $bgCard; $btnTabBot.ForeColor = $textMain; $btnTabBot.FlatAppearance.BorderColor = $borderClr
    }
}

function Start-Lavalink {
    if ($script:lavalinkProc -and !$script:lavalinkProc.HasExited) { return }
    if (!(Test-Path $lavalinkJar)) {
        Queue-Log "lavalink" ">>> ERROR: Lavalink.jar not found at $lavalinkJar"
        Update-Status $lblLavaStatus "error"
        return
    }
    Update-Status $lblLavaStatus "starting"
    Queue-Log "lavalink" ">>> Starting Lavalink..."

    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = "java"
    $psi.Arguments = "-jar Lavalink.jar"
    $psi.WorkingDirectory = $lavalinkDir
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.CreateNoWindow = $true

    $p = New-Object System.Diagnostics.Process
    $p.StartInfo = $psi
    $p.EnableRaisingEvents = $true
    Register-ObjectEvent -InputObject $p -EventName OutputDataReceived -Action { if ($EventArgs.Data) { Queue-Log "lavalink" $EventArgs.Data } } | Out-Null
    Register-ObjectEvent -InputObject $p -EventName ErrorDataReceived -Action { if ($EventArgs.Data) { Queue-Log "lavalink" $EventArgs.Data } } | Out-Null
    Register-ObjectEvent -InputObject $p -EventName Exited -Action { Queue-Log "lavalink" ">>> Lavalink exited" } | Out-Null

    $p.Start() | Out-Null
    $p.BeginOutputReadLine()
    $p.BeginErrorReadLine()
    $script:lavalinkProc = $p
}

function Stop-Lavalink {
    if ($script:lavalinkProc -and !$script:lavalinkProc.HasExited) {
        Queue-Log "lavalink" ">>> Stopping Lavalink..."
        try { $script:lavalinkProc.Kill() } catch {}
        $script:lavalinkProc = $null
        Update-Status $lblLavaStatus "stopped"
    }
}

function Start-Bot {
    if ($script:botProc -and !$script:botProc.HasExited) { return }
    Update-Status $lblBotStatus "starting"
    Queue-Log "bot" ">>> Starting PinPlay Bot..."

    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = "node"
    $psi.Arguments = "src/index.js"
    $psi.WorkingDirectory = $botDir
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.CreateNoWindow = $true
    $psi.EnvironmentVariables["FORCE_COLOR"] = "0"

    $p = New-Object System.Diagnostics.Process
    $p.StartInfo = $psi
    $p.EnableRaisingEvents = $true
    Register-ObjectEvent -InputObject $p -EventName OutputDataReceived -Action { if ($EventArgs.Data) { Queue-Log "bot" $EventArgs.Data } } | Out-Null
    Register-ObjectEvent -InputObject $p -EventName ErrorDataReceived -Action { if ($EventArgs.Data) { Queue-Log "bot" $EventArgs.Data } } | Out-Null
    Register-ObjectEvent -InputObject $p -EventName Exited -Action { Queue-Log "bot" ">>> Bot exited" } | Out-Null

    $p.Start() | Out-Null
    $p.BeginOutputReadLine()
    $p.BeginErrorReadLine()
    $script:botProc = $p
}

function Stop-Bot {
    if ($script:botProc -and !$script:botProc.HasExited) {
        Queue-Log "bot" ">>> Stopping Bot..."
        try { $script:botProc.Kill() } catch {}
        $script:botProc = $null
        Update-Status $lblBotStatus "stopped"
    }
}

# ── Timer ──
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 300
$timer.Add_Tick({
    Process-PendingLogs
    if ($script:lavalinkProc -and $script:lavalinkProc.HasExited) { Update-Status $lblLavaStatus "error"; $script:lavalinkProc = $null }
    if ($script:botProc -and $script:botProc.HasExited) { Update-Status $lblBotStatus "error"; $script:botProc = $null }
})

# ── Events ──
$btnLavaStart.Add_Click({ Start-Lavalink })
$btnLavaStop.Add_Click({ Stop-Lavalink })
$btnBotStart.Add_Click({ Start-Bot })
$btnBotStop.Add_Click({ Stop-Bot })

$btnStartAll.Add_Click({
    Start-Lavalink
    Queue-Log "bot" ">>> Waiting 15s for Lavalink to initialize..."
    $dt = New-Object System.Windows.Forms.Timer
    $dt.Interval = 15000
    $dt.Add_Tick({ Start-Bot; $this.Stop(); $this.Dispose() })
    $dt.Start()
})

$btnStopAll.Add_Click({ Stop-Bot; Stop-Lavalink })
$btnTabBot.Add_Click({ Show-Tab "bot" })
$btnTabLava.Add_Click({ Show-Tab "lavalink" })

$btnCopyLog.Add_Click({
    $t = $txtLog.Text
    if ($t) { [System.Windows.Forms.Clipboard]::SetText($t) } else { [System.Windows.Forms.Clipboard]::SetText(" ") }
    $btnCopyLog.Text = "Copied!"
    $rt = New-Object System.Windows.Forms.Timer; $rt.Interval = 2000
    $rt.Add_Tick({ $btnCopyLog.Text = "Copy Logs"; $this.Stop(); $this.Dispose() }); $rt.Start()
})

$btnClearLog.Add_Click({
    $txtLog.Clear()
    if ($script:currentTab -eq "bot") { $script:botLogs.Clear() } else { $script:lavaLogs.Clear() }
})

$form.Add_FormClosing({ $timer.Stop(); Stop-Bot; Stop-Lavalink })

# ── GO ──
$timer.Start()
Show-Tab "bot"
Queue-Log "bot" ">>> PinPlay Launcher ready. Click START ALL to begin."
[System.Windows.Forms.Application]::Run($form)
