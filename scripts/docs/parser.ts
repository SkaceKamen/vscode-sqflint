import xmldoc from 'xmldoc';
import { WikiDocumentation } from '../../server/src/server';
import { parseBikiCommandTemplate } from './biki/parseBikiCommandTemplate';

export function parseDocument(doc: string, type: 'function' | 'command', results = {} as Record<string, WikiDocumentation>) {
    const document = new xmldoc.XmlDocument(doc);
    const pages = document.childrenNamed("page");

    const noInfo = [] as string[];

    for (const i in pages) {
        const page = pages[i];

        if (parseInt(page.childNamed("ns")?.val ?? '-1') == 0) {
            let title = page.childNamed("title")?.val;
            const text = page.valueWithPath("revision.text");

            if (!title || !text) {
                console.warn(`Skipping ${title} due to missing title or text`);
                continue;
            }

            title = title.replace(/ /g, '_');

            const data = parseBikiCommandTemplate(text);

            if (data.syntaxes.length === 0) {
                noInfo.push(title);
                continue;
            }

            results[title.toLowerCase()] = {
                title,
                type,
                description: data.description,
                syntaxes: data.syntaxes,
                compatibility: data.compatibility,
                source: 'core'
            };
        }
    }

    if (noInfo.length > 1) {
        console.log('No information for ' + noInfo.length + ' commands/functions. Example: ' + noInfo.slice(0, 3).join(','));
    }

    return results;
}