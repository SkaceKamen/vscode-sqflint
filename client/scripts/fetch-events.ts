"use strict";
import fs from "fs";
import https from "https";
import { JSDOM } from "jsdom";

const sources = {
    units: {
        url: "https://community.bistudio.com/wiki/Arma_3:_Event_Handlers",
        cache: "cache/events-units.html",
    },
    ui: {
        url:
            "https://community.bistudio.com/wiki/User_Interface_Event_Handlers",
        cache: "cache/events-ui.html",
    },
};

const events = {};

fs.mkdirSync("cache", { recursive: true });

function parseEvents(filePath: string, type: string) {
    fs.readFile(filePath, (err, data) => {
        if (err) throw err;

        const doc = new JSDOM(data);
        Array.from(doc.window.document.querySelectorAll(".mw-headline"))
            .slice(2)
            .filter((i) => i.parentElement.tagName === "H4")
            .map((i) => {
                let name = i.textContent.trim();
                const totalParent =
                    i.parentElement.parentElement.nextElementSibling ||
                    i.parentElement.nextElementSibling;

                const description = totalParent.textContent.trim();
                let codeExample = totalParent;
                let current = totalParent;
                while (current) {
                    if (current.className.includes("mw-highlight")) {
                        codeExample = current;
                        break;
                    }
                    current = current.nextElementSibling;
                }

                let params = "";

                if (type !== 'ui') {
                    current = codeExample;
                    while (current) {
                        if (current.tagName === "UL") {
                            params = Array.from(current.querySelectorAll("li"))
                                .map((i) => `* ${i.textContent}`)
                                .join("\n");
                            break;
                        }

                        current = current.nextElementSibling;
                    }
                } else {
                    // UI events start with on for some reason
                    if (name.startsWith('on')) {
                        name = name.substr(2);
                    }

                    const code = codeExample.textContent;
                    const paramRegex = /"([^"]*)"/g;
                    let match: RegExpMatchArray;
                    while ((match = paramRegex.exec(code))) {
                        params += `* ${match[1]}\n`;
                    }
                }

                events[name.toLowerCase()] = {
                    id: name.toLowerCase(),
                    title: name,
                    description,
                    args: params,
                    type
                };
            });

        fs.writeFileSync(
            "server/definitions/events.json",
            JSON.stringify(events)
        );
    });
}

for (const type in sources) {
    const source = sources[type];
    if (!fs.existsSync(source.cache)) {
        const file = fs.createWriteStream(source.cache);
        https.get(source.url, (res) => {
            res.pipe(file);
            res.on("end", () => parseEvents(source.cache, type));
        });
    } else {
        parseEvents(source.cache, type);
    }
}
