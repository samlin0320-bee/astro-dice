@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
title 備份 Claude 環境到隨身碟/資料夾
color 0E

echo.
echo ============================================================
echo    備份這台的 Claude 環境 ^(給別台電腦用^)
echo ============================================================
echo.
echo  會備份:
echo    projects\        對話紀錄 ^(骰子牌卡判讀等^)
echo    skills\          自訂技能 ^(multi-export 等^)
echo    scheduled-tasks\ 排程任務
echo    CLAUDE.md        全域偏好
echo.
echo  警告: skills 內可能含 API 金鑰,只備到你信任的裝置!
echo.

set /p DEST="  備份到哪裡? (例 E:\claude-backup): "
if "%DEST%"=="" (
    echo   未輸入路徑,取消。
    pause
    exit /b 1
)

set SRC=%USERPROFILE%\.claude
if not exist "%SRC%" (
    color 0C
    echo   [X] 找不到 %SRC%
    pause
    exit /b 1
)

set OUT=%DEST%\.claude
echo.
echo  來源: %SRC%
echo  目標: %OUT%
echo.
pause

if not exist "%OUT%" mkdir "%OUT%"

echo.
echo  [1/4] 複製對話紀錄 projects\ ...
if exist "%SRC%\projects" (
    xcopy "%SRC%\projects" "%OUT%\projects" /E /I /Y /Q
    echo        [OK]
) else echo        [略過] 無 projects

echo  [2/4] 複製 skills\ ...
if exist "%SRC%\skills" (
    xcopy "%SRC%\skills" "%OUT%\skills" /E /I /Y /Q
    echo        [OK]
) else echo        [略過] 無 skills

echo  [3/4] 複製 scheduled-tasks\ ...
if exist "%SRC%\scheduled-tasks" (
    xcopy "%SRC%\scheduled-tasks" "%OUT%\scheduled-tasks" /E /I /Y /Q
    echo        [OK]
) else echo        [略過] 無 scheduled-tasks

echo  [4/4] 複製 CLAUDE.md ...
if exist "%SRC%\CLAUDE.md" (
    copy /Y "%SRC%\CLAUDE.md" "%OUT%\CLAUDE.md" >nul
    echo        [OK]
) else echo        [略過] 無 CLAUDE.md

REM 順手把安裝腳本也放進備份,別台直接雙擊
if exist "%~dp0setup-on-new-pc.bat" (
    copy /Y "%~dp0setup-on-new-pc.bat" "%DEST%\setup-on-new-pc.bat" >nul
    echo.
    echo  已附上 setup-on-new-pc.bat ^(別台雙擊即可安裝專案^)
)

echo.
color 0A
echo ============================================================
echo    備份完成!
echo ============================================================
echo.
echo  備份位置: %OUT%
echo.
echo  在別台電腦要用時:
echo    1. 雙擊 %DEST%\setup-on-new-pc.bat
echo    2. 問到「複製對話紀錄」選 Y
echo    3. 貼上路徑: %OUT%
echo.
set /p OPENIT="  開啟備份資料夾? (Y/N): "
if /i "%OPENIT%"=="Y" explorer "%OUT%"
echo.
pause
