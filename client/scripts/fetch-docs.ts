import fetch from 'node-fetch'
import fs from 'fs'
import { join } from 'path';

const T_LIST_START = "class='oo-ui-inputWidget-input'>"
const T_LIST_END = "</textarea>"

async function loadAllFromCategory(category: string) {
    const listData = await fetch("https://community.bistudio.com/wiki/Special:Export/", {
        "headers": {
            "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9",
            "accept-language": "cs,en-GB;q=0.9,en;q=0.8",
            "cache-control": "no-cache",
            "content-type": "application/x-www-form-urlencoded",
            "pragma": "no-cache",
            "sec-ch-ua": "\"Google Chrome\";v=\"87\", \" Not;A Brand\";v=\"99\", \"Chromium\";v=\"87\"",
            "sec-ch-ua-mobile": "?0",
            "sec-fetch-dest": "document",
            "sec-fetch-mode": "navigate",
            "sec-fetch-site": "same-origin",
            "sec-fetch-user": "?1",
            "upgrade-insecure-requests": "1",
            "referrer": "https://community.bistudio.com/wiki/Special:Export/",
        },
        "body": `catname=Category%3A${category}&addcat=Add&pages=&curonly=1&wpDownload=1&title=Special%3AExport%2F`,
        "method": "POST",
    }).then(r => r.text());

    const listStart = listData.indexOf(T_LIST_START)
    if (listStart < 0) {
        throw new Error('Failed to find scripts list start')
    }

    const listEnd = listData.indexOf(T_LIST_END, listStart)
    if (listEnd < 0) {
        throw new Error('Failed to find scripts list end')
    }

    const scripts = listData.substring(listStart + T_LIST_START.length, listEnd)
        .trim()
        .replace(/\r/g, '')
        .split('\n')
        .filter(item => !item.startsWith('Category:'))
        .map(i => encodeURIComponent(i))

    console.log('Found', scripts.length, 'pages for category', category)

    const result = await fetch("https://community.bistudio.com/wiki/Special:Export/", {
        "headers": {
            "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9",
            "accept-language": "cs,en-GB;q=0.9,en;q=0.8",
            "cache-control": "no-cache",
            "content-type": "application/x-www-form-urlencoded",
            "pragma": "no-cache",
            "sec-ch-ua": "\"Google Chrome\";v=\"87\", \" Not;A Brand\";v=\"99\", \"Chromium\";v=\"87\"",
            "sec-ch-ua-mobile": "?0",
            "sec-fetch-dest": "document",
            "sec-fetch-mode": "navigate",
            "sec-fetch-site": "same-origin",
            "sec-fetch-user": "?1",
            "upgrade-insecure-requests": "1",
            "referrer": "https://community.bistudio.com/wiki/Special:Export/",
        },
        "body": `pages=${scripts.join('%0D%0A')}&curonly=1&wpDownload=1&title=Special%3AExport%2F`,
        "method": "POST"
    }).then(res => res.text());

    console.log('Successfully loaded', category)

    return result
}

async function main() {
    /*fs.writeFileSync(join(__dirname, '..', 'server', 'operatorsExport.xml'), await loadAllFromCategory('Scripting_Commands'))
    console.log('Saved', 'operatorsExport.xml')
    fs.writeFileSync(join(__dirname, '..', 'server', 'functionsExport.xml'), await loadAllFromCategory('Functions'))
    console.log('Saved', 'functionsExport.xml')*/
}

main().catch(console.error)