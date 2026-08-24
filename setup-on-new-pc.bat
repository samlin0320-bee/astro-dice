@echo off
chcp 65001 >nul
title 占星骰子專案 - 新電腦一鍵安裝
color 0B

echo.
echo ============================================================
echo    占星骰子專案 - 在這台電腦一鍵取得
echo ============================================================
echo.
echo  這個腳本會做:
echo    1. 檢查 git 是否安裝
echo    2. 把 astro-dice 專案 clone 到 %%USERPROFILE%%\NotebookLM\
echo    3. (選填) 複製 Claude Code 對話紀錄
echo.
pause

REM ---------- 1. 檢查 git ----------
echo.
echo [1/3] 檢查 git...
where git >nul 2>nul
if errorlevel 1 (
    color 0C
    echo   [X] 找不到 git!
    echo.
    echo   請先安裝 Git for Windows:
    echo   https://git-scm.com/download/win
    echo.
    echo   安裝完後重新執行這個腳本。
    pause
    exit /b 1
)
for /f "tokens=*" %%v in ('git --version') do echo   [OK] %%v

REM ---------- 2. clone 專案 ----------
echo.
echo [2/3] 取得專案原始碼...
set TARGET=%USERPROFILE%\NotebookLM
if not exist "%TARGET%" mkdir "%TARGET%"
cd /d "%TARGET%"

if exist "%TARGET%\astro-dice\.git" (
    echo   專案已存在,改為更新到最新版...
    cd /d "%TARGET%\astro-dice"
    git pull
    if errorlevel 1 (
        echo   [!] git pull 失敗 ^(可能有本機修改未提交^)
    ) else (
        echo   [OK] 已更新到最新版
    )
) else (
    echo   從 GitHub 下載中...
    git clone https://github.com/samlin0320-bee/astro-dice
    if errorlevel 1 (
        color 0C
        echo   [X] clone 失敗! 檢查網路或 GitHub 權限。
        pause
        exit /b 1
    )
    echo   [OK] 專案已下載到: %TARGET%\astro-dice
)

REM ---------- 3. 對話紀錄 (選填) ----------
echo.
echo [3/3] Claude Code 對話紀錄 ^(選填^)
echo.
echo   要一併複製「骰子牌卡判讀」等對話紀錄嗎?
echo   ^(需要來源電腦的 .claude 資料夾,例如放在隨身碟或網路磁碟^)
echo.
set /p COPYCHAT="  複製對話紀錄? (Y/N): "
if /i "%COPYCHAT%"=="Y" (
    echo.
    set /p SRCDIR="  請貼上來源 .claude 資料夾路徑 (例 E:\claude-backup\.claude): "
    if exist "!SRCDIR!\projects" (
        echo   複製中...
        if not exist "%USERPROFILE%\.claude" mkdir "%USERPROFILE%\.claude"
        xcopy "!SRCDIR!\projects" "%USERPROFILE%\.claude\projects" /E /I /Y /Q
        echo   [OK] 對話紀錄已複製
        echo.
        echo   注意: 若也要 skills/排程,再複製這兩個資料夾:
        echo         !SRCDIR!\skills          到  %USERPROFILE%\.claude\skills
        echo         !SRCDIR!\scheduled-tasks 到  %USERPROFILE%\.claude\scheduled-tasks
        echo   ^(裡面可能含 API 金鑰,只在你信任的電腦這樣做^)
    ) else (
        echo   [!] 路徑不存在或不含 projects 資料夾,略過
    )
) else (
    echo   略過對話紀錄
)

REM ---------- 完成 ----------
echo.
color 0A
echo ============================================================
echo    完成!
echo ============================================================
echo.
echo  專案位置:
echo    %TARGET%\astro-dice
echo.
echo  下一步:
echo    1. 在這台裝 Claude Code ^(如果還沒^):
echo       https://claude.com/claude-code
echo    2. 開啟 Claude Code,把工作目錄設到:
echo       %TARGET%\astro-dice
echo    3. 線上網站任何裝置都能直接開:
echo       https://dices.3minstest.com/
echo.
echo  提醒: 改完 code 要同步回來,在專案資料夾執行:
echo    git add . ^&^& git commit -m "說明" ^&^& git push
echo.
set /p OPENIT="  現在開啟專案資料夾? (Y/N): "
if /i "%OPENIT%"=="Y" explorer "%TARGET%\astro-dice"
echo.
pause
