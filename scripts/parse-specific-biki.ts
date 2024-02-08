import fs from 'fs';
import { parseBikiCommandTemplate } from './docs/biki/parseBikiCommandTemplate';

async function main() {
    const fileName = process.argv[2];
    const file = await fs.promises.readFile(fileName);
    const contents = file.toString();

    const parsed = parseBikiCommandTemplate(contents);

    console.log(JSON.stringify(parsed, null, 2));
}

main().catch(console.error);
