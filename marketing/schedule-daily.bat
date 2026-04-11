@echo off
REM MnemoPay Daily Marketing Automation
REM Scheduled via Windows Task Scheduler — runs every day at 9:00 AM
REM To install: schtasks /create /tn "MnemoPay-Daily" /tr "C:\Users\bizsu\Projects\mnemopay-sdk\marketing\schedule-daily.bat" /sc daily /st 09:00 /f

cd /d C:\Users\bizsu\Projects\mnemopay-sdk\marketing

echo [%date% %time%] Starting daily marketing run... >> logs\daily.log 2>&1

REM 1. Post 2 tweets from content bank
echo Running autopost... >> logs\daily.log 2>&1
node daily-marketing.js >> logs\daily.log 2>&1

REM 2. Send pending follow-up emails (Day 3 / Day 7 / Day 14)
echo Running email followup... >> logs\daily.log 2>&1
node email-followup.js >> logs\daily.log 2>&1

REM 3. Print CRM status to log
echo Running CRM report... >> logs\daily.log 2>&1
node crm.js next >> logs\daily.log 2>&1

echo [%date% %time%] Daily run complete. >> logs\daily.log 2>&1
