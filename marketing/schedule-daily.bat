@echo off
REM MnemoPay Daily Marketing Automation
REM Scheduled via Windows Task Scheduler — runs every day at 9:00 AM

cd /d C:\Users\bizsu\Projects\mnemopay-sdk\marketing
if not exist logs mkdir logs

echo [%date% %time%] Starting daily marketing run... >> logs\daily.log 2>&1

REM 1. Post 2 tweets from content bank (--env-file loads .env natively in Node 20+)
echo Running autopost... >> logs\daily.log 2>&1
node --env-file=../.env daily-marketing.js >> logs\daily.log 2>&1

REM 2. Send pending follow-up emails (SEND mode)
echo Running email followup... >> logs\daily.log 2>&1
node --env-file=../.env email-followup.js send >> logs\daily.log 2>&1

REM 2b. Dev.to weekly publish (idempotent guard inside cron-devto.js)
echo Running Dev.to scheduler... >> logs\daily.log 2>&1
node --env-file=../.env cron-devto.js >> logs\daily.log 2>&1

REM 3. Print CRM status to log
echo Running CRM report... >> logs\daily.log 2>&1
node --env-file=../.env crm.js next >> logs\daily.log 2>&1

REM 4. SEO/GEO monitoring for all sites
echo Running SEO/GEO monitor... >> logs\daily.log 2>&1
node seo-geo-monitor.js >> logs\daily.log 2>&1

REM 5. YouTube Shorts upload (if any queued)
echo Running YouTube Shorts uploader... >> logs\daily.log 2>&1
cd /d C:\Users\bizsu\Projects\dele-video\scripts
python daily-shorts.py >> C:\Users\bizsu\Projects\mnemopay-sdk\marketing\logs\daily.log 2>&1
cd /d C:\Users\bizsu\Projects\mnemopay-sdk\marketing

echo [%date% %time%] Daily run complete. >> logs\daily.log 2>&1
