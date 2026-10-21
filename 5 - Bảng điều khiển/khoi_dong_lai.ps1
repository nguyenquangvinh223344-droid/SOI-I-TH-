# Khoi dong lai toan bo day chuyen (chay boi tac vu "QV Khoi dong lai", KHONG phai tien trinh con cua bang dieu khien).
# Thu tu: tat bang dieu khien + Motion Control -> doi tac vu "QV Chay day chuyen" ve trang thai Ready -> bat lai (co thu lai neu chua len).
Start-Sleep -Seconds 2
schtasks /end /tn "QV Chay day chuyen" | Out-Null
foreach ($port in 8765, 8800) {
  Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | ForEach-Object {
    Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue
  }
}
for ($i = 0; $i -lt 15; $i++) {
  if ((Get-ScheduledTask -TaskName "QV Chay day chuyen").State -ne "Running") { break }
  Start-Sleep -Seconds 1
}
Start-Sleep -Seconds 2
for ($try = 0; $try -lt 4; $try++) {
  schtasks /run /tn "QV Chay day chuyen" | Out-Null
  for ($i = 0; $i -lt 14; $i++) {
    Start-Sleep -Seconds 1
    if (Get-NetTCPConnection -LocalPort 8800 -State Listen -ErrorAction SilentlyContinue) { exit 0 }
  }
  schtasks /end /tn "QV Chay day chuyen" | Out-Null
  Start-Sleep -Seconds 2
}
