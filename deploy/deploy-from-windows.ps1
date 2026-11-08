# Crafter: установка и обновление сервера прямо с вашего компьютера (Windows PowerShell).
# Запуск:  powershell -ExecutionPolicy Bypass -File deploy\deploy-from-windows.ps1
# Пароль сервера вводите ТОЛЬКО в окне SSH, когда оно спросит. Скрипт его не видит и нигде не сохраняет.

$ErrorActionPreference = 'Stop'
$repo = 'https://github.com/Rasswetik/Crafter.git'

if (-not (Get-Command ssh -ErrorAction SilentlyContinue)) {
    Write-Host 'Не найден ssh. Включите: Параметры -> Приложения -> Дополнительные компоненты -> OpenSSH-клиент.' -ForegroundColor Red
    exit 1
}

Write-Host ''
Write-Host '=== Crafter: сервер ===' -ForegroundColor Cyan
$ip = Read-Host 'IP сервера (например 72.56.86.131)'
if ($ip -notmatch '^[0-9A-Za-z\.\-:]+$') { Write-Host 'Некорректный адрес.' -ForegroundColor Red; exit 1 }
$user = Read-Host 'Пользователь [root]'
if ([string]::IsNullOrWhiteSpace($user)) { $user = 'root' }
if ($user -notmatch '^[a-z_][a-z0-9_-]*$') { Write-Host 'Некорректное имя пользователя.' -ForegroundColor Red; exit 1 }
$key = Read-Host 'Путь к SSH-ключу (Enter, если вход по паролю)'

Write-Host ''
Write-Host '1 - Установить Crafter на пустой сервер'
Write-Host '2 - Обновить код и перезапустить (после git push)'
Write-Host '3 - Показать логи приложения'
Write-Host '4 - Статус служб'
$choice = Read-Host 'Выберите действие [1]'
if ([string]::IsNullOrWhiteSpace($choice)) { $choice = '1' }

switch ($choice) {
    '1' { $remote = "apt-get update -y && apt-get install -y git && rm -rf /tmp/crafter-setup && git clone $repo /tmp/crafter-setup && bash /tmp/crafter-setup/deploy/setup.sh" }
    '2' { $remote = "sudo -u crafter git -C /opt/crafter pull --ff-only && sudo -u crafter /opt/crafter/.venv/bin/pip install -q -r /opt/crafter/requirements.txt && systemctl restart crafter && sleep 3 && curl -fsS http://127.0.0.1:5000/health && echo ' <- приложение работает'" }
    '3' { $remote = 'journalctl -u crafter -n 120 --no-pager' }
    '4' { $remote = 'systemctl status crafter nginx postgresql --no-pager' }
    default { Write-Host 'Неизвестный выбор.' -ForegroundColor Red; exit 1 }
}

$sshArgs = @('-t', '-o', 'StrictHostKeyChecking=accept-new', '-o', 'ServerAliveInterval=30')
if (-not [string]::IsNullOrWhiteSpace($key)) { $sshArgs += @('-i', $key) }
$sshArgs += @("$user@$ip", $remote)

Write-Host ''
Write-Host "Подключаюсь к $user@$ip. Когда спросит пароль, введите его (символы не отображаются) и нажмите Enter." -ForegroundColor Yellow
Write-Host ''
& ssh @sshArgs
$code = $LASTEXITCODE
Write-Host ''
if ($code -eq 0) {
    Write-Host 'Готово.' -ForegroundColor Green
} elseif ($code -eq 255) {
    Write-Host 'Не удалось подключиться (Permission denied / нет связи).' -ForegroundColor Red
    Write-Host 'Проверьте пароль root в панели Timeweb, либо укажите путь к SSH-ключу, либо используйте веб-консоль Timeweb.'
} else {
    Write-Host "Команда на сервере завершилась с кодом $code. Скопируйте последние строки вывода (без паролей и токенов) и пришлите мне." -ForegroundColor Red
}
